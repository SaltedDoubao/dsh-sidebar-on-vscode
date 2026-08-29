import { z } from 'zod'
import { DshClient, RpcBusinessError } from './dsh-client'
import type { HostInfo } from './host-manager'
import { UI_REQUESTS, type UiRequest, type UiRequestPayload, type UiRequestValue } from '../shared/ui-requests'
import type { HostFrame, MuxFrame } from './protocol/events'

export interface CapabilityMatrix {
  core: boolean
  sessions: boolean
  eventStreams: boolean
  workspace: boolean
  settings: boolean
  credentials: boolean
  modelConfiguration: boolean
  plugins: boolean
  agentPresets: boolean
  trajectory: boolean
  feedback: boolean
  deliverables: boolean
  sessionExport: boolean
  references: boolean
  workflowRun: boolean
  diagnostics: Record<string, string>
}

const hostDescriptionSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  attachedSessions: z.number(),
  canOpenPath: z.boolean(),
}).passthrough()

const sessionListSchema = z.object({ items: z.array(z.object({ sessionId: z.string() }).passthrough()) }).passthrough()

/** Stable, capability-aware facade used by the extension host and bridge. */
export class DshAdapter {
  private matrix: CapabilityMatrix | null = null
  private readonly recoveredListeners = new Set<() => void>()
  private wasDisconnected = false

  constructor(readonly transport: DshClient) {
    transport.onStatus((connected) => {
      if (!connected) {
        this.wasDisconnected = true
        return
      }
      if (this.wasDisconnected) {
        this.wasDisconnected = false
        void this.refreshAfterReconnect()
      }
    })
  }

  async connect(info: HostInfo): Promise<CapabilityMatrix> {
    await this.transport.connect(info)
    this.matrix = await this.detectCapabilities()
    return this.matrix
  }

  capabilities(): CapabilityMatrix {
    if (this.matrix === null) throw new Error('DSH capabilities have not been detected')
    return this.matrix
  }

  rpc<T = unknown>(method: string, payload?: unknown): Promise<T> {
    return this.transport.rpc<T>(method, payload)
  }

  rpcWithId<T = unknown>(method: string, payload: unknown, rpcId: string): Promise<T> {
    return this.transport.rpcWithId<T>(method, payload, rpcId)
  }

  callUi<K extends UiRequest>(method: K, payload: UiRequestPayload<K>): Promise<UiRequestValue<K>> {
    if (!(UI_REQUESTS as readonly string[]).includes(method)) {
      return Promise.reject(new Error(`UI operation is not allowed: ${String(method)}`))
    }
    return this.transport.rpc<UiRequestValue<K>>(method, payload)
  }

  onMuxEvent(cb: (frame: MuxFrame) => void): () => void {
    return this.transport.onMuxEvent(cb)
  }

  onHostEvent(cb: (frame: HostFrame) => void): () => void {
    return this.transport.onHostEvent(cb)
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    return this.transport.onStatus(cb)
  }

  onRecovered(cb: () => void): () => void {
    this.recoveredListeners.add(cb)
    return () => this.recoveredListeners.delete(cb)
  }

  async exportSession(sessionId: string): Promise<Response> {
    if (!this.capabilities().sessionExport) throw new Error('session export is unavailable on this Host')
    return this.transport.downloadSession(sessionId, true)
  }

  async dispose(): Promise<void> {
    await this.transport.dispose()
  }

  private async detectCapabilities(): Promise<CapabilityMatrix> {
    const diagnostics: Record<string, string> = {}
    const describe = await this.transport.rpc('host.describe', {})
    const hostOk = hostDescriptionSchema.safeParse(describe).success
    if (!hostOk) diagnostics.host = 'host.describe returned an incompatible core structure'

    let sessions = false
    try {
      sessions = sessionListSchema.safeParse(await this.transport.rpc('session.list', {})).success
    } catch (error) {
      diagnostics.sessions = message(error)
    }
    if (!sessions && diagnostics.sessions === undefined) diagnostics.sessions = 'session.list returned an incompatible structure'

    const workspace = await this.supports('workspace.list', {}, diagnostics)
    const settings = await this.supports('settings.describe', {}, diagnostics)
    const credentials = await this.supports('credentials.describe', { refs: [] }, diagnostics)
    const modelConfiguration = await this.supports('llm.providers', {}, diagnostics)
    const agentPresets = await this.supports('agentPreset.list', {}, diagnostics)
    const plugins = await this.supports('pluginInventory/list', { args: {} }, diagnostics)
    const feedback = await this.supports('messageFeedback/list', { args: { agentId: '__capability_probe__' } }, diagnostics)
    const fileRefs = await this.supports('fileReferences/list', { args: { agentId: '__capability_probe__', query: '' } }, diagnostics)
    const sessionRefs = await this.supports('sessionReferenceResolver/candidates', { args: { agentId: '__capability_probe__', query: '' } }, diagnostics)

    return {
      core: hostOk && sessions,
      sessions,
      eventStreams: true,
      workspace,
      settings,
      credentials,
      modelConfiguration,
      plugins,
      agentPresets,
      trajectory: sessions,
      feedback,
      deliverables: sessions,
      sessionExport: await this.supportsExport(diagnostics),
      references: fileRefs || sessionRefs,
      workflowRun: sessions,
      diagnostics,
    }
  }

  private async supports(method: string, payload: unknown, diagnostics: Record<string, string>): Promise<boolean> {
    try {
      await this.transport.rpc(method, payload)
      return true
    } catch (error) {
      // A business rejection proves the route and its envelope exist. Optional
      // feature probes intentionally use inert/invalid identifiers.
      if (error instanceof RpcBusinessError) return true
      diagnostics[method] = message(error)
      return false
    }
  }

  private async supportsExport(diagnostics: Record<string, string>): Promise<boolean> {
    const supported = await this.transport.supportsSessionExport()
    if (!supported) diagnostics['session.export'] = 'HEAD /api/session.export did not expose the official missing-sessionId contract'
    return supported
  }

  private async refreshAfterReconnect(): Promise<void> {
    try {
      this.matrix = await this.detectCapabilities()
      // Re-read authoritative baselines before telling UI layers to refresh.
      await Promise.allSettled([
        this.transport.rpc('session.list', {}),
        this.matrix.workspace ? this.transport.rpc('workspace.list', {}) : Promise.resolve(),
      ])
      for (const cb of this.recoveredListeners) cb()
    } catch {
      // The transport owns the next reconnect attempt; never fabricate state.
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
