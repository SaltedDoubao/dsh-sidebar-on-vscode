/**
 * Composer slice (owned by W4). Prompt sending, queue state, model selection
 * and the permission-mode selector. Queue state arrives through session/queue
 * mux frames; the model catalog rides session.models.
 * Contract: ARCHITECTURE.md section 5.2.
 */

import type { StateCreator } from 'zustand'
import type { MessageId, SessionId } from '../../extension/protocol/brand'
import type { HostFrame, MuxFrame } from '../../extension/protocol/events'
import type { HostDescription } from '../../extension/protocol/host'
import type {
  CommandDescriptor,
  CommandExecution,
  EncodedImageAttachment,
} from '../../extension/protocol/commands'
import type { PromptContentPart, QueueAction } from '../../extension/protocol/sessions'
import type { SessionModels } from '../../extension/protocol/sessions'
import type { PermissionSelectProjection } from '../../extension/protocol/projections'
import type { SkillEntry } from '../../extension/protocol/views'
import { rpc, setIdeContext } from '../bridge'
import type { Attachment, ModelInfo, QueuedMessage } from '../types'
import type { AppStore } from './index'

/** State + actions owned by the composer workflow. */
export interface ComposerSlice {
  /** Pending inbox snapshot of the active session (session/queue frames). */
  queue: QueuedMessage[]
  /** Flattened selectable models across provider groups. */
  models: ModelInfo[]
  /** Current model selection of the active session (provider + model + effort). */
  selectedModel: SessionModels['current'] | null
  /** Model chosen before any session exists; applied on the next session create. */
  pendingModelSelection: { provider: string; model: string; reasoningEffort?: string } | null
  /** Host-authoritative slash-command directory for catalogSessionId. */
  commands: readonly CommandDescriptor[]
  /** Host-authoritative skill directory; skills still invoke through session.prompt. */
  skills: readonly SkillEntry[]
  catalogSessionId: SessionId | null
  /** Host-computed permissions of the materialized active session. */
  permissions: PermissionSelectProjection | null
  /** Preset awaiting the host's authoritative projection update. */
  permissionSwitchingTo: string | null
  /** Last permission switch failure, rendered next to the selector. */
  permissionError: string | null
  /** Whether send-time IDE context injection is enabled (toggle chip). */
  ideContextEnabled: boolean

  /** Send a prompt; without an active session one is created first (Codex-style). */
  sendPrompt: (text: string, attachments: Attachment[]) => Promise<void>
  /** Refresh command + skill catalogs for a materialized session. */
  loadComposerCatalog: (sessionId: SessionId) => Promise<void>
  /** Invalidate command/skill catalogs on Host registry/preset events. */
  applyCatalogHostFrame: (frame: HostFrame) => void
  /** Interrupt the current turn of the active session. */
  cancel: () => Promise<void>
  /** Change the model route; without a session the choice is stashed as pending. */
  selectModel: (provider: string, model: string, reasoningEffort?: string) => Promise<void>
  /** Change the active session, or the next-session default when none is selected. */
  setPermissionPreset: (preset: string) => Promise<void>
  /** Toggle send-time IDE context injection (persisted as a VS Code setting). */
  setIdeContextEnabled: (enabled: boolean) => void
  /** Load the global model catalog (llm.models); session.models refines later. */
  loadGlobalModels: () => Promise<void>
  /**
   * Preselect the saved deployment default (host.describe echoes the last
   * selected model) so the chip is filled before any session exists.
   */
  loadDefaultModel: () => Promise<void>
  /** Load the model catalog + current selection of a session. */
  loadModels: (sessionId: SessionId) => Promise<void>
  /** Mutate one pending queue item (edit / remove / steer). */
  updateQueueItem: (itemId: MessageId, action: QueueAction) => Promise<void>
  /** Queue-frame handler: session/queue snapshots replace `queue` wholesale. */
  applyQueueFrame: (frame: MuxFrame) => void
}

/** Flatten one session/queue snapshot item into a QueuedMessage. */
function toQueuedMessage(item: { id: MessageId; placement: QueuedMessage['placement']; message: QueuedMessage['message'] }): QueuedMessage {
  const text = item.message.content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? (b.attachment.name ?? '[image]') : ''))
    .filter((t) => t !== '')
    .join('\n')
  return { id: item.id, placement: item.placement, text, message: item.message }
}

/** Reject malformed/legacy projection values instead of exposing a broken menu. */
function permissionProjection(value: unknown): PermissionSelectProjection | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { currentValue?: unknown; options?: unknown }
  if (typeof candidate.currentValue !== 'string' || !Array.isArray(candidate.options)) return null
  const options = candidate.options.filter((option): option is PermissionSelectProjection['options'][number] => {
    if (option === null || typeof option !== 'object') return false
    const row = option as { value?: unknown; name?: unknown; description?: unknown }
    return typeof row.value === 'string' && typeof row.name === 'string'
      && (row.description === undefined || typeof row.description === 'string')
  })
  return { currentValue: candidate.currentValue, options }
}

const PERMISSION_CONFIRM_TIMEOUT_MS = 10_000
let permissionConfirmTimer: ReturnType<typeof setTimeout> | null = null

function clearPermissionConfirmTimer(): void {
  if (permissionConfirmTimer !== null) clearTimeout(permissionConfirmTimer)
  permissionConfirmTimer = null
}

/** Parse only a leading slash token; unknown/malformed tokens never reach the model. */
export function leadingSlashName(text: string): string | null {
  if (!text.startsWith('/')) return null
  return /^\/([a-z0-9][\w-]*)(?=\s|$)/iu.exec(text)?.[1]?.toLowerCase() ?? ''
}

function encodedImages(attachments: readonly Attachment[]): EncodedImageAttachment[] {
  return attachments.map((attachment) => ({
    mediaType: attachment.mediaType,
    data: attachment.data,
    name: attachment.name,
  }))
}

async function executeCommandLine(
  sessionId: SessionId,
  line: string,
  attachments: readonly Attachment[] = [],
): Promise<CommandExecution> {
  const execution = await rpc<CommandExecution | undefined>('commands/execute', {
    args: { agentId: sessionId, line, images: encodedImages(attachments) },
  })
  if (execution === undefined) throw new Error(`unknown or malformed command: ${line}`)
  return execution
}

export const createComposerSlice: StateCreator<AppStore, [], [], ComposerSlice> = (set, get) => ({
  queue: [],
  models: [],
  selectedModel: null,
  pendingModelSelection: null,
  commands: [],
  skills: [],
  catalogSessionId: null,
  permissions: null,
  permissionSwitchingTo: null,
  permissionError: null,
  ideContextEnabled: false,

  sendPrompt: async (text, attachments) => {
    // Codex-style: typing before any session exists creates one on send.
    if (get().activeSessionId === null) await get().newChat()
    const sessionId = get().activeSessionId
    if (sessionId === null) throw new Error('no active session')
    const slashName = leadingSlashName(text)
    if (slashName !== null) {
      if (get().catalogSessionId !== sessionId) await get().loadComposerCatalog(sessionId)
      const command = get().commands.find((entry) => entry.name.toLowerCase() === slashName)
      if (command !== undefined) {
        if (attachments.length > 0 && command.input?.images !== true) {
          throw new Error(`/${command.name} does not accept image attachments; remove them first`)
        }
        const execution = await executeCommandLine(sessionId, text, attachments)
        // Match dsh WebUI admission semantics: an admitted command is cleared
        // and its handler outcome renders durably. Attachment errors retain the
        // images so the user can correct the submission.
        if (attachments.length > 0 && execution.result.kind === 'error') {
          throw new Error(execution.result.text)
        }
        get().touchSession(sessionId, Date.now())
        return
      }
      const skill = get().skills.find((entry) => entry.name.toLowerCase() === slashName)
      if (skill === undefined) throw new Error(`unknown or malformed command: ${text}`)
      // Skills intentionally continue through session.prompt; dsh-tool-skill
      // recognizes the whitespace-bounded /name token at the pre-step seam.
    }
    const content: PromptContentPart[] = [
      // Automatic IDE context is captured and attached by the extension host,
      // next to the session.prompt boundary. The Webview keeps user text pure.
      { type: 'text', text },
      ...attachments.map((a): PromptContentPart => ({ type: 'image', mediaType: a.mediaType, data: a.data, name: a.name })),
    ]
    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content,
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    // Sending a prompt makes its session the most recent one: bump and re-sort
    // immediately (the user/message event confirms with the host time later).
    get().touchSession(sessionId, Date.now())
  },

  loadComposerCatalog: async (sessionId) => {
    const [commands, skillCatalog] = await Promise.all([
      rpc<readonly CommandDescriptor[]>('commands/list', { args: { agentId: sessionId } }),
      rpc<{ skills: readonly SkillEntry[] }>('skill.list', { sessionId }),
    ])
    if (get().activeSessionId === sessionId) {
      set({ commands, skills: skillCatalog.skills, catalogSessionId: sessionId })
    }
  },

  applyCatalogHostFrame: (frame) => {
    if (frame.type !== 'host/remote-event') return
    if (frame.event !== 'commands/change' && frame.event !== 'agent-preset/selected') return
    const sessionId = get().activeSessionId
    if (sessionId === null) return
    set({ commands: [], skills: [], catalogSessionId: null })
    void get().loadComposerCatalog(sessionId).catch(() => undefined)
  },

  cancel: async () => {
    const sessionId = get().activeSessionId
    if (sessionId === null) return
    await rpc('session.cancel', { sessionId })
  },

  selectModel: async (provider, model, reasoningEffort) => {
    const sessionId = get().activeSessionId
    if (sessionId === null) {
      // No session yet: stash the choice; newChat applies it after create.
      set({ pendingModelSelection: { provider, model, reasoningEffort }, selectedModel: { provider, model, reasoningEffort } })
      return
    }
    const { selected } = await rpc<{ selected: SessionModels['current'] }>('session.selectModel', {
      sessionId,
      provider,
      model,
      reasoningEffort,
    })
    set({ selectedModel: selected })
  },

  setPermissionPreset: async (preset) => {
    const sessionId = get().activeSessionId
    if (get().permissionSwitchingTo !== null) return
    if (sessionId === null) {
      const mode = preset === 'danger-full-access' || preset === 'full-access'
        ? 'full-access'
        : preset === 'read-only' || preset === 'workspace-write'
          ? preset
          : null
      if (mode === null) return
      set({ permissionSwitchingTo: preset, permissionError: null })
      try {
        // permission.defaultPreset is resolved by the host during session.create.
        await get().setUiPref('permissionMode', mode)
        set({ permissionSwitchingTo: null })
      } catch (error) {
        set({
          permissionSwitchingTo: null,
          permissionError: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      return
    }
    if (get().permissions === null) return
    set({ permissionSwitchingTo: preset, permissionError: null })
    try {
      clearPermissionConfirmTimer()
      const execution = await executeCommandLine(sessionId, `/permission ${preset}`)
      // The Host may broadcast command/run + command/done before returning the
      // execution receipt. Mark the lifecycle by id as non-conversational and
      // remove any node that raced ahead of this response.
      get().suppressCommand(execution.commandId)
      if (execution.result.kind === 'error') throw new Error(execution.result.text)
      // Do not update the selection optimistically. The pushed permissions
      // projection below is the authoritative confirmation.
      if (get().permissionSwitchingTo !== preset) return
      permissionConfirmTimer = setTimeout(() => {
        void (async () => {
          try {
            const page = await rpc<{ projections?: { values?: { permissions?: unknown } } }>('session.history', { sessionId })
            if (get().activeSessionId !== sessionId || get().permissionSwitchingTo !== preset) return
            const projection = permissionProjection(page.projections?.values?.permissions)
            if (projection?.currentValue === preset) {
              set({ permissions: projection, permissionSwitchingTo: null, permissionError: null })
              return
            }
            set({
              ...(projection === null ? {} : { permissions: projection }),
              permissionSwitchingTo: null,
              permissionError: get().uiPrefs.language === 'zh'
                ? `权限切换未确认；主机当前值为 ${projection?.currentValue ?? '未知'}。`
                : `Permission switch was not confirmed; the Host reports ${projection?.currentValue ?? 'an unknown value'}.`,
            })
          } catch (error) {
            if (get().activeSessionId === sessionId && get().permissionSwitchingTo === preset) {
              set({
                permissionSwitchingTo: null,
                permissionError: error instanceof Error ? error.message : String(error),
              })
            }
          } finally {
            permissionConfirmTimer = null
          }
        })()
      }, PERMISSION_CONFIRM_TIMEOUT_MS)
    } catch (error) {
      clearPermissionConfirmTimer()
      set({
        permissionSwitchingTo: null,
        permissionError: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },

  setIdeContextEnabled: (enabled) => {
    setIdeContext(enabled)
    set({ ideContextEnabled: enabled })
  },

  loadGlobalModels: async () => {
    const catalog = await rpc<{ groups: SessionModels['groups'] }>('llm.models', {})
    const models: ModelInfo[] = catalog.groups.flatMap((group) =>
      group.models.map((m) => ({
        provider: group.id,
        providerName: group.name,
        id: m.id,
        name: m.name,
        description: m.description,
        reasoning: m.reasoning,
      })),
    )
    // Global catalog fills the selector only until a session refines it.
    if (get().activeSessionId === null) set({ models })
  },

  loadDefaultModel: async () => {
    const desc = await rpc<HostDescription>('host.describe', {})
    if (desc.provider === undefined || desc.model === undefined) return
    // Never override a choice the user already made this run.
    if (get().selectedModel !== null || get().pendingModelSelection !== null) return
    set({ selectedModel: { provider: desc.provider, model: desc.model } })
  },

  loadModels: async (sessionId) => {
    const catalog = await rpc<SessionModels>('session.models', { sessionId })
    const models: ModelInfo[] = catalog.groups.flatMap((group) =>
      group.models.map((m) => ({
        provider: group.id,
        providerName: group.name,
        id: m.id,
        name: m.name,
        description: m.description,
        reasoning: m.reasoning,
      })),
    )
    set({ models, selectedModel: catalog.current })
  },

  updateQueueItem: async (itemId, action) => {
    const sessionId = get().activeSessionId
    if (sessionId === null) return
    await rpc('session.updateQueue', { sessionId, itemId, action })
    // The authoritative session/queue frame refreshes `queue`.
  },

  applyQueueFrame: (frame) => {
    if (frame.type === 'session/projection' && frame.sessionId === get().activeSessionId && frame.key === 'permissions') {
      const projection = permissionProjection(frame.value)
      const pending = get().permissionSwitchingTo
      if (pending !== null && projection?.currentValue === pending) {
        clearPermissionConfirmTimer()
        set({ permissions: projection, permissionSwitchingTo: null, permissionError: null })
      } else {
        set({ permissions: projection, ...(pending === null ? { permissionError: null } : {}) })
      }
      return
    }
    if (frame.type !== 'session/queue') return
    if (frame.sessionId !== get().activeSessionId) return
    set({ queue: frame.items.map(toQueuedMessage) })
  },
})
