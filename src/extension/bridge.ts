import * as path from 'node:path'
import * as vscode from 'vscode'
import { z } from 'zod'
import type { DshAdapter } from './capabilities'
import type { HostManager, HostInfo } from './host-manager'
import type {
  ExtensionMessage,
  IdeContentKind,
  IdeContentPayload,
  InitPayload,
  SessionMeta,
  WebviewMessage,
  WorkspaceRoot,
} from '../shared/bridge'
import { UI_REQUESTS, type UiRequest } from '../shared/ui-requests'
import type { SessionSummary } from './protocol/sessions'
import type { SessionId } from './protocol/brand'
import { OverlayRetention } from './overlay-retention'

const SELECTED_ROOT_KEY = 'deepseekHarness.selectedWorkspaceUri'
const recordSchema = z.record(z.string(), z.unknown())
// `respond` has two independently validated variants, so this is a regular
// closed union rather than a discriminatedUnion (Zod rejects duplicate outer
// discriminator values at runtime).
const inboundSchema = z.union([
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('rpc'), id: z.string().min(1).max(200), method: z.enum(UI_REQUESTS), params: z.unknown().optional() }),
  z.object({ type: z.literal('respond'), kind: z.literal('approval'), approvalId: z.string(), decision: z.enum(['allow-once', 'refuse']) }),
  z.object({ type: z.literal('respond'), kind: z.literal('question'), sessionId: z.string(), answers: z.array(recordSchema) }),
  z.object({ type: z.literal('ide-request'), kind: z.enum(['selection', 'active-file']), id: z.string().optional() }),
  z.object({ type: z.literal('select-workspace'), uri: z.string() }),
  z.object({ type: z.literal('open-folder') }),
  z.object({ type: z.literal('export-session'), sessionId: z.string() }),
  z.object({ type: z.literal('open-file'), path: z.string() }),
  z.object({ type: z.literal('open-external'), href: z.string() }),
  z.object({ type: z.literal('set-ide-context'), enabled: z.boolean() }),
  z.object({ type: z.literal('active-session'), sessionId: z.string().nullable() }),
])

/** Secure, validated message bridge shared by the sidebar and full panel. */
export class Bridge {
  private hostInfo: HostInfo | null = null
  private starting: Promise<void> | null = null
  private readonly overlays = new OverlayRetention()
  private readonly webviews = new Set<vscode.Webview>()
  private readonly foregroundSessions = new Map<vscode.Webview, string | null>()
  private readonly runningSessions = new Set<string>()

  constructor(
    private readonly adapter: DshAdapter,
    private readonly host: HostManager,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.adapter.onMuxEvent((frame) => this.overlays.record(frame))
    this.adapter.onHostEvent((frame) => this.handleCompletionNotification(frame))
    this.adapter.onRecovered(() => {
      for (const webview of this.webviews) void this.sendInit(webview, 'workspace-changed')
    })
  }

  attach(webview: vscode.Webview): vscode.Disposable {
    this.webviews.add(webview)
    this.foregroundSessions.set(webview, null)
    const disposables: vscode.Disposable[] = [
      webview.onDidReceiveMessage((raw: unknown) => {
        const parsed = inboundSchema.safeParse(raw)
        if (!parsed.success) {
          this.host.log(`[bridge] rejected malformed webview message: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
          return
        }
        void this.handleMessage(webview, parsed.data as WebviewMessage)
      }),
      new vscode.Disposable(this.adapter.onMuxEvent((frame) => this.post(webview, { type: 'event', channel: 'mux', frame }))),
      new vscode.Disposable(this.adapter.onHostEvent((frame) => this.post(webview, { type: 'event', channel: 'host', frame }))),
      new vscode.Disposable(this.adapter.onStatus((connected) => {
        this.post(webview, { type: 'host-status', status: connected ? 'ready' : 'down' })
      })),
    ]
    return vscode.Disposable.from(...disposables, new vscode.Disposable(() => {
      this.webviews.delete(webview)
      this.foregroundSessions.delete(webview)
    }))
  }

  postCommand(command: 'newChat' | 'openSettings' | 'exportSession', targets: Iterable<vscode.Webview>): void {
    for (const webview of targets) this.post(webview, { type: 'command', command })
  }

  postIdeContent(kind: IdeContentKind, targets: Iterable<vscode.Webview>): void {
    for (const webview of targets) this.handleIdeRequest(webview, kind)
  }

  async restart(): Promise<void> {
    await this.adapter.dispose()
    await this.host.restart()
    this.hostInfo = null
    this.starting = null
    for (const webview of this.webviews) void this.sendInit(webview, 'workspace-changed')
  }

  async stop(): Promise<void> {
    await this.adapter.dispose()
    await this.host.stopOwned()
    this.hostInfo = null
    this.starting = null
    for (const webview of this.webviews) this.post(webview, { type: 'host-status', status: 'down' })
  }

  private async handleMessage(webview: vscode.Webview, message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendInit(webview, 'init')
        break
      case 'rpc':
        await this.handleRpc(webview, message.id, message.method, message.params)
        break
      case 'respond':
        await this.handleRespond(message)
        break
      case 'ide-request':
        this.handleIdeRequest(webview, message.kind, message.id)
        break
      case 'select-workspace':
        await this.selectWorkspace(webview, message.uri)
        break
      case 'open-folder':
        await vscode.commands.executeCommand('vscode.openFolder')
        break
      case 'export-session':
        await this.exportSession(message.sessionId)
        break
      case 'open-file':
        await this.openWorkspaceFile(message.path)
        break
      case 'open-external':
        await this.openExternal(message.href)
        break
      case 'set-ide-context':
        await vscode.workspace.getConfiguration('deepseekHarness').update(
          'ideContext.enabled', message.enabled, vscode.ConfigurationTarget.Global,
        )
        break
      case 'active-session':
        this.foregroundSessions.set(webview, message.sessionId)
        break
    }
  }

  private async handleRespond(message: Extract<WebviewMessage, { type: 'respond' }>): Promise<void> {
    try {
      if (message.kind === 'approval') {
        await this.adapter.transport.resolveApprovalByApprovalId(message.approvalId, message.decision)
      } else {
        await this.adapter.transport.answerQuestionBySessionId(message.sessionId, message.answers)
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`DeepSeek Harness response failed: ${errorMessage(error)}`)
    }
  }

  private async sendInit(webview: vscode.Webview, type: 'init' | 'workspace-changed'): Promise<void> {
    try {
      await this.ensureStarted(webview)
      const payload = await this.buildInitPayload()
      this.post(webview, { type, ...payload })
    } catch (error) {
      this.post(webview, { type: 'host-status', status: 'down' })
      this.host.log(`[bridge] initialization failed: ${errorMessage(error)}`)
      void vscode.window.showErrorMessage(`DeepSeek Harness initialization failed: ${errorMessage(error)}`)
    }
  }

  private async buildInitPayload(): Promise<InitPayload> {
    const description = await this.adapter.rpc<{ version: string }>('host.describe', {})
    const roots = this.workspaceRoots()
    const selected = this.selectedRoot(roots)
    const list = await this.adapter.rpc<{ items: SessionSummary[] }>('session.list', {})
    const capabilities = this.adapter.capabilities()
    let selectedSessionIds: Set<string> | undefined
    let archived = new Set<string>()

    if (selected !== undefined && capabilities.workspace) {
      try {
        const workspaces = await this.adapter.rpc<{
          items: Array<{ path: string; sessionIds: SessionId[] }>
          archivedSessionIds: SessionId[]
        }>('workspace.list', {})
        archived = new Set(workspaces.archivedSessionIds)
        const match = workspaces.items.find((item) => samePath(item.path, selected.path))
        if (match !== undefined) selectedSessionIds = new Set(match.sessionIds)
      } catch (error) {
        this.host.log(`[bridge] workspace baseline unavailable: ${errorMessage(error)}`)
      }
    }

    const sessions = selected === undefined
      ? []
      : list.items
          .filter((summary) => !archived.has(summary.sessionId))
          .filter((summary) => selectedSessionIds !== undefined
            ? selectedSessionIds.has(summary.sessionId)
            : summary.cwd === undefined || samePath(summary.cwd, selected.path))
          .map(toSessionMeta)

    return {
      cwd: selected?.path ?? '',
      hostVersion: description.version,
      vscodeLanguage: vscode.env.language,
      sessions,
      workspaceRoots: roots,
      ...(selected === undefined ? {} : { selectedWorkspaceUri: selected.uri }),
      capabilities,
      ideContextEnabled: vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('ideContext.enabled', false),
      pendingOverlays: this.overlays.replay().filter((overlay) => sessions.some((session) => session.sessionId === overlay.frame.sessionId)),
    }
  }

  private async handleRpc(webview: vscode.Webview, id: string, method: UiRequest, params: unknown): Promise<void> {
    try {
      const scoped = this.scopeRequest(method, params)
      const result = await this.adapter.callUi(method, scoped as never)
      this.post(webview, { type: 'rpc-result', id, result })
    } catch (error) {
      this.post(webview, { type: 'rpc-result', id, error: errorMessage(error) })
    }
  }

  /** Enforce workspace ownership on requests that can introduce paths. */
  private scopeRequest(method: UiRequest, params: unknown): unknown {
    const selected = this.selectedRoot(this.workspaceRoots())
    if (method === 'workspace.create') {
      if (selected === undefined) throw new Error('Open a folder before creating a conversation')
      return { path: selected.path }
    }
    if (method === 'session.create') {
      if (selected === undefined) throw new Error('Open a folder before creating a conversation')
      const incoming = recordSchema.parse(params ?? {})
      // A workspaceId returned by workspace.create is safe to retain. The cwd
      // fallback is always replaced with the selected VS Code root.
      if (typeof incoming['workspaceId'] === 'string') return { workspaceId: incoming['workspaceId'], ...(typeof incoming['agentPreset'] === 'string' ? { agentPreset: incoming['agentPreset'] } : {}) }
      return { cwd: selected.path, ...(typeof incoming['agentPreset'] === 'string' ? { agentPreset: incoming['agentPreset'] } : {}) }
    }
    return params ?? {}
  }

  private async ensureStarted(webview: vscode.Webview): Promise<void> {
    if (this.hostInfo !== null) return
    this.starting ??= (async () => {
      this.post(webview, { type: 'host-status', status: 'starting' })
      const info = await this.host.ensureHost()
      const matrix = await this.adapter.connect(info)
      if (!matrix.core) {
        throw new Error(`Host core protocol is incompatible: ${Object.values(matrix.diagnostics).join('; ')}`)
      }
      this.hostInfo = info
    })().catch((error) => {
      this.starting = null
      throw error
    })
    await this.starting
  }

  private workspaceRoots(): WorkspaceRoot[] {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      uri: folder.uri.toString(),
      name: folder.name,
      path: folder.uri.fsPath,
    }))
  }

  private selectedRoot(roots: WorkspaceRoot[]): WorkspaceRoot | undefined {
    const saved = this.context.workspaceState.get<string>(SELECTED_ROOT_KEY)
    return roots.find((root) => root.uri === saved) ?? roots[0]
  }

  private async selectWorkspace(webview: vscode.Webview, uri: string): Promise<void> {
    const root = this.workspaceRoots().find((entry) => entry.uri === uri)
    if (root === undefined) throw new Error('The selected workspace root is no longer open')
    await this.context.workspaceState.update(SELECTED_ROOT_KEY, uri)
    await this.sendInit(webview, 'workspace-changed')
  }

  private handleIdeRequest(webview: vscode.Webview, kind: IdeContentKind, id?: string): void {
    const editor = vscode.window.activeTextEditor
    const reply = (payload: Omit<IdeContentPayload, 'kind' | 'id'>): void => {
      this.post(webview, { type: 'ide-content', kind, ...payload, ...(id === undefined ? {} : { id }) })
    }
    if (editor === undefined) {
      reply({ text: '', error: 'No active editor' })
      return
    }
    const selectedRoot = this.selectedRoot(this.workspaceRoots())
    if (selectedRoot !== undefined && !isInside(selectedRoot.path, editor.document.uri.fsPath)) {
      reply({ text: '', error: 'The active file is outside the selected workspace root' })
      return
    }
    const fromSelection = kind === 'selection' && !editor.selection.isEmpty
    // An empty selection carries only a path. It deliberately does not attach
    // the whole file, which could silently consume a large context window.
    if (!fromSelection) {
      reply({ text: '', path: editor.document.uri.fsPath, fromSelection: false })
      return
    }
    const text = editor.document.getText(editor.selection)
    reply({ text, path: editor.document.uri.fsPath, fromSelection: true })
  }

  private async exportSession(sessionId: SessionId): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`deepseek-session-${sessionId}.zip`),
      filters: { 'ZIP archive': ['zip'] },
      saveLabel: 'Export Session',
    })
    if (target === undefined) return
    const response = await this.adapter.exportSession(sessionId)
    await vscode.workspace.fs.writeFile(target, new Uint8Array(await response.arrayBuffer()))
    void vscode.window.showInformationMessage('DeepSeek Harness session exported')
  }

  private async openWorkspaceFile(candidate: string): Promise<void> {
    const selected = this.selectedRoot(this.workspaceRoots())
    if (selected === undefined) throw new Error('No workspace root is selected')
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(selected.path, candidate)
    if (!isInside(selected.path, resolved)) throw new Error('Refusing to open a file outside the selected workspace')
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved))
    await vscode.window.showTextDocument(document, { preview: true })
  }

  private async openExternal(href: string): Promise<void> {
    const uri = vscode.Uri.parse(href, true)
    if (uri.scheme !== 'https' && uri.scheme !== 'http') throw new Error('Only HTTP(S) links may be opened')
    await vscode.env.openExternal(uri)
  }

  private handleCompletionNotification(frame: import('./protocol/events').HostFrame): void {
    if (frame.type !== 'host/session-status') return
    if (frame.running) {
      this.runningSessions.add(frame.sessionId)
      return
    }
    const completed = this.runningSessions.delete(frame.sessionId)
    if (!completed) return
    const enabled = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('notifications.onCompletion', false)
    if (!enabled || [...this.foregroundSessions.values()].includes(frame.sessionId)) return
    void vscode.window.showInformationMessage(`DeepSeek Harness 后台会话已完成：${frame.sessionId}`)
  }

  private post(webview: vscode.Webview, message: ExtensionMessage): void {
    void webview.postMessage(message).then(undefined, () => undefined)
  }
}

function toSessionMeta(summary: SessionSummary): SessionMeta {
  const title = summary.projections?.values.title
  return {
    sessionId: summary.sessionId,
    title: typeof title === 'string' ? title : null,
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    parentSessionId: summary.parentSessionId,
    origin: summary.origin,
    cwd: summary.cwd,
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).localeCompare(path.resolve(b), undefined, { sensitivity: process.platform === 'win32' ? 'accent' : 'variant' }) === 0
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
