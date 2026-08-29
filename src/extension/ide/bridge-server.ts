import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import * as vscode from 'vscode'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'
import {
  IDE_PROTOCOL_VERSION,
  idePositionSchema,
  jsonRpcRequestSchema,
  type IdeInfo,
  type IdeRpcMethod,
} from '../../shared/ide-protocol'
import { IdeContextProvider } from './context-provider'
import { IdeDiagnosticsProvider } from './diagnostics-provider'
import { IdeDiffProvider } from './diff-provider'
import { IdeDiscoveryPublisher } from './discovery'
import { parseAllowedUri } from './resource-policy'

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
const AUTH_HEADER = 'x-agent-ide-authorization'

const methodParams = {
  'ide/describe': z.object({}).passthrough(),
  'ide/getContext': z.object({ snapshotId: z.string().uuid().optional() }),
  'ide/getWorkspaceFolders': z.object({}).passthrough(),
  'ide/getDiagnostics': z.object({ uri: z.string().optional() }),
  'ide/openFile': z.object({ uri: z.string().min(1), position: idePositionSchema.optional() }),
  'ide/showDiff': z.object({
    uri: z.string().min(1),
    original: z.string(),
    modified: z.string(),
    title: z.string().max(300).optional(),
  }),
} satisfies Record<IdeRpcMethod, z.ZodType>

/** Loopback-only, authenticated IDE JSON-RPC service for DSH Runtime plugins. */
export class IdeBridgeServer implements vscode.Disposable {
  private server: ReturnType<typeof createServer> | null = null
  private sockets: WebSocketServer | null = null
  private discovery: IdeDiscoveryPublisher | null = null
  private readonly diagnostics = new IdeDiagnosticsProvider()
  private readonly diff = new IdeDiffProvider()
  private readonly subscriptions: vscode.Disposable[] = []
  private authToken = ''
  private started = false

  constructor(
    readonly contextProvider: IdeContextProvider,
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly log: (line: string) => void,
  ) {}

  async start(): Promise<void> {
    if (this.started) return
    this.authToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const server = createServer((_request, response) => {
      response.writeHead(404).end()
    })
    const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })
    server.on('upgrade', (request, socket, head) => {
      if (!this.authorized(request)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client, request))
    })
    sockets.on('connection', (socket) => {
      socket.on('message', (data, binary) => {
        if (binary) {
          socket.close(1003, 'JSON text frames only')
          return
        }
        void this.handleFrame(socket, data.toString())
      })
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('IDE Bridge did not acquire a TCP port')
    this.server = server
    this.sockets = sockets
    this.started = true
    this.discovery = new IdeDiscoveryPublisher(this.log)
    await this.discovery.start(this.describe(), address.port, this.authToken)
    this.installNotifications()
    this.log(`[ide-bridge] listening on 127.0.0.1:${String(address.port)} instance=${this.contextProvider.instanceId}`)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose()
    await this.discovery?.dispose()
    this.discovery = null
    for (const client of this.sockets?.clients ?? []) client.terminate()
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve())
    this.sockets?.close()
    this.sockets = null
    this.server = null
    this.authToken = ''
    this.log('[ide-bridge] stopped')
  }

  dispose(): void {
    void this.stop()
    this.diff.dispose()
    this.contextProvider.dispose()
  }

  isStarted(): boolean {
    return this.started
  }

  async refreshDiscovery(): Promise<void> {
    await this.discovery?.update(this.describe())
  }

  private describe(): IdeInfo {
    const workspace = this.contextProvider.workspaceContext()
    const packageJson = this.extensionContext.extension.packageJSON as { version?: unknown }
    return {
      protocolVersion: IDE_PROTOCOL_VERSION,
      instanceId: this.contextProvider.instanceId,
      ide: 'vscode',
      ideVersion: vscode.version,
      extensionVersion: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0',
      capabilities: {
        context: true,
        selection: true,
        diagnostics: true,
        diff: true,
        openFile: true,
        notebook: false,
        debugger: false,
      },
      workspaceFolders: workspace.roots.map((root) => root.uri),
      ...(workspace.selectedRootUri === undefined ? {} : { selectedWorkspaceUri: workspace.selectedRootUri }),
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const candidate = request.headers[AUTH_HEADER]
    if (typeof candidate !== 'string') return false
    const expected = Buffer.from(this.authToken)
    const actual = Buffer.from(candidate)
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
  }

  private async handleFrame(socket: WebSocket, raw: string): Promise<void> {
    let input: unknown
    try {
      input = JSON.parse(raw)
    } catch {
      this.sendError(socket, null, -32700, 'Parse error')
      return
    }
    const request = jsonRpcRequestSchema.safeParse(input)
    if (!request.success) {
      this.sendError(socket, null, -32600, 'Invalid Request')
      return
    }
    const method = request.data.method as IdeRpcMethod
    const schema = methodParams[method]
    if (schema === undefined) {
      this.sendError(socket, request.data.id, -32601, 'Method not found')
      return
    }
    const params = schema.safeParse(request.data.params ?? {})
    if (!params.success) {
      this.sendError(socket, request.data.id, -32602, 'Invalid params')
      return
    }
    try {
      const result = await this.dispatch(method, params.data as Record<string, unknown>)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.data.id, result }))
    } catch (error) {
      this.sendError(socket, request.data.id, -32000, error instanceof Error ? error.message : String(error))
    }
  }

  private async dispatch(method: IdeRpcMethod, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'ide/describe') return this.describe()
    if (method === 'ide/getWorkspaceFolders') return this.contextProvider.workspaceContext()
    if (method === 'ide/getContext') {
      const id = params['snapshotId']
      if (typeof id !== 'string') return this.contextProvider.capture()
      const snapshot = this.contextProvider.get(id)
      if (snapshot === undefined) throw new Error('IDE context snapshot is missing or expired')
      return snapshot
    }
    if (method === 'ide/getDiagnostics') return this.diagnostics.get(typeof params['uri'] === 'string' ? params['uri'] : undefined)
    if (method === 'ide/openFile') {
      const uri = parseAllowedUri(String(params['uri']))
      const document = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(document, { preview: true })
      const position = params['position'] as { line: number; character: number } | undefined
      if (position !== undefined) {
        const target = new vscode.Position(position.line, position.character)
        editor.selection = new vscode.Selection(target, target)
        editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      }
      return { opened: true }
    }
    await this.diff.show(String(params['uri']), String(params['original']), String(params['modified']), typeof params['title'] === 'string' ? params['title'] : undefined)
    return { shown: true }
  }

  private installNotifications(): void {
    const refreshDiscovery = (): void => { void this.discovery?.update(this.describe()) }
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        refreshDiscovery()
        this.notify('ide/workspaceChanged', this.contextProvider.workspaceContext())
      }),
      vscode.workspace.onDidSaveTextDocument((document) => this.notify('ide/documentSaved', { uri: document.uri.toString() })),
      vscode.languages.onDidChangeDiagnostics((event) => this.notify('ide/diagnosticsChanged', { uris: event.uris.map((uri) => uri.toString()) })),
    )
  }

  private notify(method: string, params: unknown): void {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params })
    for (const client of this.sockets?.clients ?? []) if (client.readyState === WebSocket.OPEN) client.send(frame)
  }

  private sendError(socket: WebSocket, id: string | number | null, code: number, message: string): void {
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
  }
}
