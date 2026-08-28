/** Session and dsh Workspace navigation state. */

import type { StateCreator } from 'zustand'
import type { SessionId, WorkspaceId } from '../../extension/protocol/brand'
import type { HostFrame, MuxFrame } from '../../extension/protocol/events'
import type { WorkspaceView } from '../../extension/protocol/views'
import { addWorkspace as pickAndAddWorkspace, rpc, setActiveSession } from '../bridge'
import type { SessionMeta } from '../types'
import type { AppStore } from './index'

export type SessionGroupBy = 'workspace' | 'flat'
export type SessionOrderBy = 'manual' | 'updated'

export interface WorkspaceViewPrefs {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  groupExpansion: Record<string, boolean>
  sessionOrderByAccount: Record<string, string[]>
}

const VIEW_PREFS_KEY = 'deepseekHarness.workspaceView.v1'
const DEFAULT_VIEW_PREFS: WorkspaceViewPrefs = {
  groupBy: 'workspace',
  orderBy: 'updated',
  groupExpansion: {},
  sessionOrderByAccount: {},
}

function readViewPrefs(): WorkspaceViewPrefs {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_VIEW_PREFS }
    const parsed = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) ?? 'null') as Partial<WorkspaceViewPrefs> | null
    if (parsed === null) return { ...DEFAULT_VIEW_PREFS }
    return {
      groupBy: parsed.groupBy === 'flat' ? 'flat' : 'workspace',
      orderBy: parsed.orderBy === 'manual' ? 'manual' : 'updated',
      groupExpansion: parsed.groupExpansion !== null && typeof parsed.groupExpansion === 'object' ? parsed.groupExpansion : {},
      sessionOrderByAccount: parsed.sessionOrderByAccount !== null && typeof parsed.sessionOrderByAccount === 'object'
        ? parsed.sessionOrderByAccount : {},
    }
  } catch {
    return { ...DEFAULT_VIEW_PREFS }
  }
}

function writeViewPrefs(prefs: WorkspaceViewPrefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // A disabled Webview storage backend must not break navigation.
  }
}

function samePath(a: string, b: string): boolean {
  const normalized = (value: string): string => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
  return normalized(a) === normalized(b)
}

function reorderByIds<T extends { workspaceId: WorkspaceId }>(items: T[], ids: readonly WorkspaceId[]): T[] {
  const byId = new Map(items.map((item) => [item.workspaceId, item]))
  return [...ids.flatMap((id) => byId.get(id) ?? []), ...items.filter((item) => !ids.includes(item.workspaceId))]
}

export interface SessionsSlice {
  sessions: SessionMeta[]
  activeSessionId: SessionId | null
  workspaces: WorkspaceView[]
  archivedSessionIds: SessionId[]
  workspaceViewPrefs: WorkspaceViewPrefs

  initSessions: (all: SessionMeta[]) => void
  initWorkspaces: (workspaces: WorkspaceView[], archivedSessionIds: SessionId[]) => void
  selectSession: (id: SessionId) => Promise<void>
  newChat: (workspaceId?: WorkspaceId) => Promise<void>
  addDshWorkspace: () => Promise<void>
  renameSession: (id: SessionId, title: string) => Promise<void>
  deleteSession: (id: SessionId) => Promise<void>
  forkSession: (id: SessionId, atSeq?: number) => Promise<void>
  renameWorkspace: (id: WorkspaceId, title: string) => Promise<void>
  deleteWorkspace: (id: WorkspaceId) => Promise<void>
  insertWorkspaceBefore: (id: WorkspaceId, before?: WorkspaceId) => Promise<void>
  insertSessionBefore: (workspaceId: WorkspaceId, id: SessionId, before?: SessionId) => Promise<void>
  setSessionGroupBy: (value: SessionGroupBy) => void
  setSessionOrderBy: (value: SessionOrderBy) => void
  setWorkspaceExpanded: (key: string, expanded: boolean) => void
  setLocalSessionOrder: (key: string, ids: SessionId[]) => void
  touchSession: (id: SessionId, at?: number) => void
  applyHostFrame: (frame: HostFrame) => void
  applyProjectionFrame: (frame: MuxFrame) => void
}

export const createSessionsSlice: StateCreator<AppStore, [], [], SessionsSlice> = (set, get) => ({
  sessions: [],
  activeSessionId: null,
  workspaces: [],
  archivedSessionIds: [],
  workspaceViewPrefs: readViewPrefs(),

  initSessions: (all) => {
    const archived = new Set(get().archivedSessionIds)
    const visible = all.filter((session) => !archived.has(session.sessionId))
    visible.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ sessions: visible })
  },

  initWorkspaces: (workspaces, archivedSessionIds) => {
    const retained = new Set([...workspaces.map((workspace) => workspace.workspaceId as string), '__ungrouped__', '__flat__'])
    const current = get().workspaceViewPrefs
    const prefs: WorkspaceViewPrefs = {
      ...current,
      groupExpansion: Object.fromEntries(Object.entries(current.groupExpansion).filter(([key]) => retained.has(key))),
      sessionOrderByAccount: Object.fromEntries(Object.entries(current.sessionOrderByAccount).filter(([key]) => retained.has(key))),
    }
    writeViewPrefs(prefs)
    set({
      workspaces: workspaces.map((workspace) => ({ ...workspace, sessionIds: [...workspace.sessionIds] })),
      archivedSessionIds: [...archivedSessionIds],
      workspaceViewPrefs: prefs,
      sessions: get().sessions.filter((session) => !archivedSessionIds.includes(session.sessionId)),
    })
  },

  selectSession: async (id) => {
    const markRead = get().sessions.map((session) => session.sessionId === id ? { ...session, unread: false } : session)
    if (get().activeSessionId === id) {
      setActiveSession(id)
      set({ sessions: markRead })
      void get().loadSubagents(id).catch(() => undefined)
      return
    }
    set({ activeSessionId: id, sessions: markRead })
    setActiveSession(id)
    get().clearConversation()
    get().refreshActiveOverlay()
    const workspace = get().workspaces.find((item) => item.sessionIds.includes(id))
    if (workspace !== undefined && get().workspaceViewPrefs.groupExpansion[workspace.workspaceId] !== true) {
      get().setWorkspaceExpanded(workspace.workspaceId, true)
    }
    await Promise.all([get().loadHistory(id), get().loadModels(id)])
    void get().loadSubagents(id).catch(() => undefined)
  },

  newChat: async (requestedWorkspaceId) => {
    const activeId = get().activeSessionId
    const active = get().sessions.find((session) => session.sessionId === activeId)
    const activeWorkspace = activeId === null ? undefined : get().workspaces.find((workspace) => workspace.sessionIds.includes(activeId))
    const matchingRoot = get().workspaces.find((workspace) => samePath(workspace.path, get().cwd))
    const workspaceId = requestedWorkspaceId ?? activeWorkspace?.workspaceId ?? matchingRoot?.workspaceId ?? get().workspaces[0]?.workspaceId
    if (active?.blank === true && (workspaceId === undefined || activeWorkspace?.workspaceId === workspaceId)) return
    if (workspaceId === undefined && get().capabilities?.workspace === true) {
      await get().addDshWorkspace()
      return
    }
    const payload = workspaceId === undefined ? { cwd: get().cwd } : { workspaceId }
    const { sessionId } = await rpc<{ sessionId: SessionId }>('session.create', payload)
    if (!get().sessions.some((session) => session.sessionId === sessionId)) {
      set({ sessions: [{ sessionId, title: null, updatedAt: Date.now(), running: false, blank: true, cwd: get().cwd }, ...get().sessions] })
    }
    await get().selectSession(sessionId)
    const pending = get().pendingModelSelection
    if (pending !== null) {
      set({ pendingModelSelection: null })
      await get().selectModel(pending.provider, pending.model, pending.reasoningEffort)
    }
  },

  addDshWorkspace: async () => {
    const result = await pickAndAddWorkspace()
    if (result.canceled) return
    if (result.payload !== undefined) get().applyInitPayload(result.payload, false)
    if (result.sessionId !== undefined) await get().selectSession(result.sessionId)
  },

  renameSession: async (id, title) => {
    await rpc('session.rename', { sessionId: id, title })
    set({ sessions: get().sessions.map((session) => session.sessionId === id ? { ...session, title } : session) })
  },

  deleteSession: async (id) => {
    const result = await rpc<{ archivedSessionIds: SessionId[] }>('workspace.archiveSession', { sessionId: id })
    set({ archivedSessionIds: result.archivedSessionIds, sessions: get().sessions.filter((session) => session.sessionId !== id) })
    if (get().activeSessionId === id) {
      get().resetGoal()
      set({ activeSessionId: null })
      setActiveSession(null)
      get().refreshActiveOverlay()
    }
  },

  forkSession: async (id, atSeq) => {
    const { sessionId } = await rpc<{ sessionId: SessionId }>('session.fork', { sessionId: id, atSeq })
    await get().selectSession(sessionId)
  },

  renameWorkspace: async (id, title) => {
    const { workspace } = await rpc<{ workspace: WorkspaceView }>('workspace.rename', { workspaceId: id, title })
    set({ workspaces: get().workspaces.map((item) => item.workspaceId === id ? workspace : item) })
  },

  deleteWorkspace: async (id) => {
    await rpc('workspace.delete', { workspaceId: id })
    const workspaces = get().workspaces.filter((workspace) => workspace.workspaceId !== id)
    get().initWorkspaces(workspaces, get().archivedSessionIds)
  },

  insertWorkspaceBefore: async (id, before) => {
    const result = await rpc<{ workspaceIds: WorkspaceId[] }>('workspace.insertBefore', {
      workspaceId: id,
      ...(before === undefined ? {} : { beforeWorkspaceId: before }),
    })
    set({ workspaces: reorderByIds(get().workspaces, result.workspaceIds) })
  },

  insertSessionBefore: async (workspaceId, id, before) => {
    const { workspace } = await rpc<{ workspace: WorkspaceView }>('workspace.insertSessionBefore', {
      workspaceId,
      sessionId: id,
      ...(before === undefined ? {} : { beforeSessionId: before }),
    })
    set({ workspaces: get().workspaces.map((item) => item.workspaceId === workspaceId ? workspace : item) })
  },

  setSessionGroupBy: (groupBy) => {
    const workspaceViewPrefs = { ...get().workspaceViewPrefs, groupBy }
    writeViewPrefs(workspaceViewPrefs)
    set({ workspaceViewPrefs })
  },
  setSessionOrderBy: (orderBy) => {
    const workspaceViewPrefs = { ...get().workspaceViewPrefs, orderBy }
    writeViewPrefs(workspaceViewPrefs)
    set({ workspaceViewPrefs })
  },
  setWorkspaceExpanded: (key, expanded) => {
    const workspaceViewPrefs = {
      ...get().workspaceViewPrefs,
      groupExpansion: { ...get().workspaceViewPrefs.groupExpansion, [key]: expanded },
    }
    writeViewPrefs(workspaceViewPrefs)
    set({ workspaceViewPrefs })
  },
  setLocalSessionOrder: (key, ids) => {
    const workspaceViewPrefs = {
      ...get().workspaceViewPrefs,
      sessionOrderByAccount: { ...get().workspaceViewPrefs.sessionOrderByAccount, [key]: ids },
    }
    writeViewPrefs(workspaceViewPrefs)
    set({ workspaceViewPrefs })
  },

  touchSession: (id, at) => {
    const now = at ?? Date.now()
    const touched = get().sessions.map((session) => session.sessionId === id && now > session.updatedAt ? { ...session, updatedAt: now } : session)
    touched.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ sessions: touched })
  },

  applyHostFrame: (frame) => {
    switch (frame.type) {
      case 'host/session-added':
        if (!get().sessions.some((session) => session.sessionId === frame.sessionId)) {
          set({ sessions: [{
            sessionId: frame.sessionId,
            title: null,
            updatedAt: Date.now(),
            running: false,
            blank: frame.blank,
            parentSessionId: frame.parentSessionId,
            origin: frame.origin,
            cwd: frame.cwd,
          }, ...get().sessions] })
        }
        break
      case 'host/session-removed':
        set({
          sessions: get().sessions.filter((session) => session.sessionId !== frame.sessionId),
          workspaces: get().workspaces.map((workspace) => ({ ...workspace, sessionIds: workspace.sessionIds.filter((id) => id !== frame.sessionId) })),
        })
        if (get().activeSessionId === frame.sessionId) {
          get().resetGoal()
          set({ activeSessionId: null })
          setActiveSession(null)
          get().refreshActiveOverlay()
        }
        break
      case 'host/session-status': {
        const ended = !frame.running && get().sessions.some((session) => session.sessionId === frame.sessionId && session.running)
        set({ sessions: get().sessions.map((session) => session.sessionId === frame.sessionId
          ? { ...session, running: frame.running, ...(ended ? { unread: true } : {}) }
          : session) })
        break
      }
      case 'host/workspace-changed': {
        const exists = get().workspaces.some((workspace) => workspace.workspaceId === frame.workspace.workspaceId)
        set({ workspaces: exists
          ? get().workspaces.map((workspace) => workspace.workspaceId === frame.workspace.workspaceId ? frame.workspace : workspace)
          : [...get().workspaces, frame.workspace] })
        break
      }
      case 'host/workspace-removed':
        get().initWorkspaces(get().workspaces.filter((workspace) => workspace.workspaceId !== frame.workspaceId), get().archivedSessionIds)
        break
      case 'host/workspace-order-changed':
        set({ workspaces: reorderByIds(get().workspaces, frame.workspaceIds) })
        break
      case 'host/archived-sessions-changed':
        set({
          archivedSessionIds: frame.archivedSessionIds,
          sessions: get().sessions.filter((session) => !frame.archivedSessionIds.includes(session.sessionId)),
        })
        break
      case 'host/agent-error':
        if (frame.sessionId === get().activeSessionId) get().appendError(frame.message)
        break
      default:
        break
    }
  },

  applyProjectionFrame: (frame) => {
    if (frame.type === 'session/event') {
      if (frame.event.type === 'user/message') get().touchSession(frame.sessionId, frame.event.time)
      if (get().sessions.some((session) => session.sessionId === frame.sessionId && session.blank)) {
        set({ sessions: get().sessions.map((session) => session.sessionId === frame.sessionId ? { ...session, blank: false } : session) })
      }
      if (frame.event.type === 'turn/end') {
        set({ sessions: get().sessions.map((session) => session.sessionId === frame.sessionId ? { ...session, unread: true } : session) })
      }
      return
    }
    if (frame.type === 'session/projection' && frame.key === 'title' && typeof frame.value === 'string') {
      set({ sessions: get().sessions.map((session) => session.sessionId === frame.sessionId ? { ...session, title: frame.value as string } : session) })
    }
  },
})
