/**
 * Combined application store (owned by the contract skeleton; W2-W6 each own
 * one slice file). Merges the slices and holds the root connection state plus
 * initialize(), the single place where bridge subscriptions fan frames out to
 * the per-slice handlers:
 *   mux  -> conversation.applyMuxFrame / overlay.applyOverlayFrame /
 *           composer.applyQueueFrame / sessions.applyProjectionFrame
 *   host -> sessions.applyHostFrame
 * Slices never subscribe to the bridge themselves.
 */

import { create } from 'zustand'
import type { HostFrame, MuxFrame } from '../../extension/protocol/events'
import type { CapabilityMatrix } from '../../extension/capabilities'
import type { HostStatus, InitPayload, WorkspaceRoot } from '../../shared/bridge'
import { exportSession, onCommand, onEvent, onHostStatus, onWorkspaceChanged, setActiveSession, waitInit } from '../bridge'
import { createComposerSlice, type ComposerSlice } from './composer'
import { createConversationSlice, type ConversationSlice } from './conversation'
import { createGoalSlice, type GoalSlice } from './goal'
import { createOverlaySlice, type OverlaySlice } from './overlay'
import { createSessionsSlice, type SessionsSlice } from './sessions'
import { createSettingsSlice, type SettingsSlice } from './settings'

/** Root state owned by the skeleton itself (connection facts + bootstrap). */
export interface RootSlice {
  /** Current workspace root; the session ownership anchor. */
  cwd: string
  /** dsh host version reported by host.describe. */
  hostVersion: string
  hostStatus: HostStatus
  /** True once the init payload arrived. */
  initialized: boolean
  workspaceRoots: WorkspaceRoot[]
  selectedWorkspaceUri?: string
  capabilities: CapabilityMatrix | null

  /** Bootstrap: wait for init, install sessions, wire event/status/command fan-out. */
  initialize: () => Promise<void>
  /** Install one authoritative dsh/VS Code baseline. */
  applyInitPayload: (payload: InitPayload, resetSelection?: boolean) => void
}

/** The full store: root slice + the six workflow-owned slices. */
export type AppStore = RootSlice & SessionsSlice & ConversationSlice & ComposerSlice & OverlaySlice & SettingsSlice & GoalSlice

export const useAppStore = create<AppStore>()((...a) => {
  const [, get] = a
  return {
    cwd: '',
    hostVersion: '',
    hostStatus: 'starting',
    initialized: false,
    workspaceRoots: [],
    capabilities: null,

    applyInitPayload: (payload, resetSelection = true) => {
      if (resetSelection) {
        setActiveSession(null)
        get().clearConversation()
        get().resetGoal()
      }
      useAppStore.setState({
        cwd: payload.cwd,
        hostVersion: payload.hostVersion,
        workspaceRoots: payload.workspaceRoots,
        selectedWorkspaceUri: payload.selectedWorkspaceUri,
        capabilities: payload.capabilities,
        ideContextEnabled: payload.ideContextEnabled,
        uiPrefs: {
          ...get().uiPrefs,
          language: payload.vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en',
        },
        ...(resetSelection ? { activeSessionId: null } : {}),
        hostStatus: 'ready',
      })
      get().initSessions(payload.sessions)
      get().initWorkspaces(payload.workspaces, payload.archivedSessionIds)
    },

    initialize: async () => {
      if (get().initialized) return
      // Fan-out subscriptions first so no frame is lost while init is in flight.
      onEvent((channel, frame) => {
        if (channel === 'mux') {
          const mux = frame as MuxFrame
          get().applyMuxFrame(mux)
          get().applyOverlayFrame(mux)
          get().applyQueueFrame(mux)
          get().applyProjectionFrame(mux)
        } else {
          get().applyHostFrame(frame as HostFrame)
        }
      })
      onHostStatus((status) => {
        useAppStore.setState({ hostStatus: status })
      })
      onCommand((command) => {
        if (command === 'newChat') void get().newChat()
        else {
          const active = get().activeSessionId
          if (active !== null) exportSession(active)
        }
      })
      const applyWorkspace = (payload: InitPayload): void => {
        get().applyInitPayload(payload)
      }
      onWorkspaceChanged(applyWorkspace)
      const init = await waitInit()
      get().applyInitPayload(init, false)
      useAppStore.setState({ initialized: true })
      // Replay answerable overlays that arrived while the webview was hidden
      // (a disposed sidebar webview is re-resolved on show): select the
      // session holding the pending question/approval, then install the state
      // so the takeover panel re-appears and the stuck session can be answered.
      const overlays = init.pendingOverlays ?? []
      const firstOverlay = overlays[0]
      if (overlays.length > 0 && firstOverlay !== undefined) {
        const target = overlays.find((o) => o.kind === 'question') ?? firstOverlay
        if (useAppStore.getState().sessions.some((s) => s.sessionId === target.frame.sessionId)) {
          await get().selectSession(target.frame.sessionId)
        }
        get().applyOverlays(overlays)
      }
      // Populate the model selector even before any session is selected.
      void get().loadGlobalModels().catch(() => undefined)
      // Preselect the last used model (saved host-side as the default).
      void get().loadDefaultModel().catch(() => undefined)
      // Load the default used for future sessions. Current-session access is
      // independently driven by that session's permissions projection.
      void get().syncPermissionDefault().catch(() => undefined)
      // DSH locale/theme are authoritative. The init language is only the
      // temporary fallback while this settings baseline is in flight.
      void get().loadSettings().catch(() => undefined)
    },

    ...createSessionsSlice(...a),
    ...createConversationSlice(...a),
    ...createComposerSlice(...a),
    ...createOverlaySlice(...a),
    ...createSettingsSlice(...a),
    ...createGoalSlice(...a),
  }
})
