/**
 * Composer slice (owned by W4). Prompt sending, queue state, model selection
 * and the permission-mode selector. Queue state arrives through session/queue
 * mux frames; the model catalog rides session.models.
 * Contract: ARCHITECTURE.md section 5.2.
 */

import type { StateCreator } from 'zustand'
import type { MessageId, SessionId } from '../../extension/protocol/brand'
import type { MuxFrame } from '../../extension/protocol/events'
import type { HostDescription } from '../../extension/protocol/host'
import type { PromptContentPart, QueueAction } from '../../extension/protocol/sessions'
import type { SessionModels } from '../../extension/protocol/sessions'
import type { PermissionSelectProjection } from '../../extension/protocol/projections'
import { fetchIdeContent, rpc, setIdeContext } from '../bridge'
import { formatIdeInsert, hasIdeBlock } from '../ide-insert'
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

/**
 * Send-time IDE context enrichment: when the active editor holds a non-empty
 * selection, the selection is appended as a formatted code block; with no
 * selection the ACTIVE FILE PATH is attached as lightweight context (the
 * model can read the file itself with tools). Skipped when the draft already
 * carries an inserted IDE block. Best-effort — any failure (no editor,
 * timeout) silently leaves the prompt untouched.
 * @param text - the draft text.
 * @returns the prompt text, enriched when editor context is available.
 */
async function enrichWithIdeContext(text: string, enabled: boolean): Promise<string> {
  if (!enabled || hasIdeBlock(text)) return text
  let content
  try {
    content = await fetchIdeContent('selection')
  } catch {
    return text
  }
  if (content.error !== undefined) return text
  if (content.fromSelection === true && content.text.trim() !== '') {
    const block = formatIdeInsert('selection', content.text, content.path)
    return text.trim() === '' ? block : `${text.trim()}\n\n${block}`
  }
  // No selection: the payload still carries the active file path (the
  // 'selection' kind falls back to the whole document); attach only the path.
  if (content.path !== undefined) {
    const block = `### 当前文件：${content.path}`
    return text.trim() === '' ? block : `${text.trim()}\n\n${block}`
  }
  return text
}

export const createComposerSlice: StateCreator<AppStore, [], [], ComposerSlice> = (set, get) => ({
  queue: [],
  models: [],
  selectedModel: null,
  pendingModelSelection: null,
  permissions: null,
  permissionSwitchingTo: null,
  permissionError: null,
  ideContextEnabled: false,

  sendPrompt: async (text, attachments) => {
    // Codex-style: typing before any session exists creates one on send.
    if (get().activeSessionId === null) await get().newChat()
    const sessionId = get().activeSessionId
    if (sessionId === null) throw new Error('no active session')
    // A prompt whose content is exactly one text block starting with `/` is a
    // slash command the HOST executes (goal/compact/plan...); IDE context must
    // not be appended or the host rejects it as an unknown command.
    const prompt = text.startsWith('/')
      ? text
      : await enrichWithIdeContext(text, get().ideContextEnabled)
    const content: PromptContentPart[] = [
      { type: 'text', text: prompt },
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
      const result = await rpc<{ accepted: true; command?: { kind: 'success'; text?: string } }>('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: `/permission ${preset}` }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (result.command === undefined) throw new Error(get().uiPrefs.language === 'zh' ? '当前主机未识别权限命令。' : 'The host did not recognize the permission command.')
      // Do not update the selection optimistically. The pushed permissions
      // projection below is the authoritative confirmation.
    } catch (error) {
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
      set({ permissions: permissionProjection(frame.value), permissionSwitchingTo: null, permissionError: null })
      return
    }
    if (frame.type !== 'session/queue') return
    if (frame.sessionId !== get().activeSessionId) return
    set({ queue: frame.items.map(toQueuedMessage) })
  },
})
