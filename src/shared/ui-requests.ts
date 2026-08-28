import type { RpcMethodMap } from '../extension/protocol/rpc-map'

/**
 * Operations the Webview is allowed to ask the extension host to perform.
 * This is intentionally a closed subset of the DSH surface. Privileged path
 * opening, downloads, Host lifecycle, and VS Code APIs have dedicated bridge
 * messages so an arbitrary string can never reach them.
 */
export interface UiRequestMap extends Pick<RpcMethodMap,
  | 'session.list'
  | 'session.search'
  | 'session.create'
  | 'session.history'
  | 'session.models'
  | 'session.selectModel'
  | 'session.rename'
  | 'session.fork'
  | 'session.prompt'
  | 'session.attachment'
  | 'session.updateQueue'
  | 'session.cancel'
  | 'subagent.list'
  | 'subagent.history'
  | 'subagent.prompt'
  | 'subagent.interrupt'
  | 'host.describe'
  | 'workspace.create'
  | 'workspace.archiveSession'
  | 'skill.list'
  | 'goal.create'
  | 'goal.edit'
  | 'goal.pause'
  | 'goal.resume'
  | 'goal.complete'
  | 'goal.clear'
  | 'settings.describe'
  | 'settings.update'
  | 'settings.replace'
  | 'settings.mutate'
  | 'credentials.describe'
  | 'credentials.set'
  | 'credentials.unset'
  | 'llm.providers'
  | 'llm.models'
  | 'llm.discoverModels'
> {
  'agentPreset.list': { payload: Record<string, never>; value: unknown }
  'agentPreset.select': { payload: { sessionId: string; agentPreset: string }; value: unknown }
  'agentPreset.read': { payload: { agentPreset: string }; value: unknown }
  'agentPreset.copy': { payload: { from: string; agentPreset: string; name?: string }; value: unknown }
  'agentPreset.openDocument': { payload: { agentPreset: string }; value: unknown }
  'agentPreset.remove': { payload: { agentPreset: string }; value: unknown }
  'pluginInventory/list': { payload: { args: Record<string, never> }; value: unknown }
  'messageFeedback/list': { payload: { args: Record<string, unknown> }; value: unknown }
  'messageFeedback/put': { payload: { args: Record<string, unknown> }; value: unknown }
  'messageFeedback/delete': { payload: { args: Record<string, unknown> }; value: unknown }
  'fileReferences/list': { payload: { args: Record<string, unknown> }; value: unknown }
  'sessionReferenceResolver/candidates': { payload: { args: Record<string, unknown> }; value: unknown }
}

export type UiRequest = keyof UiRequestMap
export type UiRequestPayload<K extends UiRequest> = UiRequestMap[K]['payload']
export type UiRequestValue<K extends UiRequest> = UiRequestMap[K]['value']

export const UI_REQUESTS = [
  'session.list', 'session.search', 'session.create', 'session.history', 'session.models',
  'session.selectModel', 'session.rename', 'session.fork', 'session.prompt',
  'session.attachment', 'session.updateQueue', 'session.cancel',
  'subagent.list', 'subagent.history', 'subagent.prompt', 'subagent.interrupt',
  'host.describe',
  'workspace.create', 'workspace.archiveSession', 'skill.list',
  'goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear',
  'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate',
  'credentials.describe', 'credentials.set', 'credentials.unset',
  'llm.providers', 'llm.models', 'llm.discoverModels',
  'agentPreset.list', 'agentPreset.select', 'agentPreset.read', 'agentPreset.copy',
  'agentPreset.openDocument', 'agentPreset.remove',
  'pluginInventory/list', 'messageFeedback/list', 'messageFeedback/put',
  'messageFeedback/delete', 'fileReferences/list', 'sessionReferenceResolver/candidates',
] as const satisfies readonly UiRequest[]
