import { useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react'
import type { SessionId, WorkspaceId } from '../../../extension/protocol/brand'
import type { WorkspaceView } from '../../../extension/protocol/views'
import { openSettings, rpc } from '../../bridge'
import { useAppStore } from '../../store'
import { waitingSessionId as firstWaitingSessionId } from '../../store/overlay'
import type { SessionGroupBy } from '../../store/sessions'
import type { SessionMeta } from '../../types'
import type { ConversationMode } from '../../types'
import { useI18n } from '../../use-i18n'
import './chat-list.css'

const UNGROUPED = '__ungrouped__'
const FLAT = '__flat__'
const COLLAPSED_LIMIT = 5

function relativeTime(updatedAt: number, zh: boolean): string {
  const minutes = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000))
  if (minutes < 1) return zh ? '刚刚' : 'now'
  if (minutes < 60) return zh ? `${minutes}分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return zh ? `${hours}小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return zh ? `${days}天前` : `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return zh ? `${months}个月前` : `${months}mo ago`
  const years = Math.floor(months / 12)
  return zh ? `${years}年前` : `${years}y ago`
}

function dotClass(session: SessionMeta, waitingSessionId: SessionId | null): string {
  if (waitingSessionId === session.sessionId) return 'status-dot status-dot-waiting'
  if (session.running) return 'status-dot status-dot-running'
  if (session.unread === true) return 'status-dot status-dot-unread'
  return 'status-dot'
}

function Icon(props: { name: 'clock' | 'gear' | 'pencil' | 'dots' | 'search' | 'folderAdd' | 'chevron' | 'plus' | 'close' }): JSX.Element {
  const paths: Record<typeof props.name, JSX.Element> = {
    clock: <><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" /></>,
    gear: <><path d="M8.15 1.33h-.29a1.33 1.33 0 0 0-1.33 1.33v.12a1.33 1.33 0 0 1-.67 1.15l-.29.17a1.33 1.33 0 0 1-1.33 0l-.1-.05a1.33 1.33 0 0 0-1.82.49l-.15.25a1.33 1.33 0 0 0 .49 1.82l.1.07a1.33 1.33 0 0 1 .67 1.15v.34a1.33 1.33 0 0 1-.67 1.16l-.1.06a1.33 1.33 0 0 0-.49 1.82l.15.25a1.33 1.33 0 0 0 1.82.49l.1-.05a1.33 1.33 0 0 1 1.33 0l.29.17a1.33 1.33 0 0 1 .67 1.15V13.33a1.33 1.33 0 0 0 1.33 1.33h.29a1.33 1.33 0 0 0 1.33-1.33v-.12a1.33 1.33 0 0 1 .67-1.15l.29-.17a1.33 1.33 0 0 1 1.33 0l.1.05a1.33 1.33 0 0 0 1.82-.49l.15-.26a1.33 1.33 0 0 0-.49-1.82l-.1-.05a1.33 1.33 0 0 1-.67-1.16v-.33a1.33 1.33 0 0 1 .67-1.16l.1-.06a1.33 1.33 0 0 0 .49-1.82l-.15-.25a1.33 1.33 0 0 0-1.82-.49l-.1.05a1.33 1.33 0 0 1-1.33 0l-.29-.17a1.33 1.33 0 0 1-.67-1.15V2.67a1.33 1.33 0 0 0-1.33-1.33z" /><circle cx="8" cy="8" r="2" /></>,
    pencil: <><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" /><path d="M9.5 4l2.5 2.5" /></>,
    dots: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />,
    search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>,
    folderAdd: <><path d="M1.5 4.5h5l1.2 1.5h6.8v7.5h-13z" /><path d="M11 7.7v4M9 9.7h4" /></>,
    chevron: <path d="m5 6.5 3 3 3-3" />,
    plus: <path d="M8 3v10M3 8h10" />,
    close: <path d="m4 4 8 8M12 4l-8 8" />,
  }
  return <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{paths[props.name]}</svg>
}

function orderedSessions(sessions: SessionMeta[], accountOrder: readonly string[] | undefined, updated: boolean): SessionMeta[] {
  if (updated) return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  if (accountOrder === undefined) return [...sessions]
  const byId = new Map(sessions.map((session) => [session.sessionId as string, session]))
  return [...accountOrder.flatMap((id) => byId.get(id) ?? []), ...sessions.filter((session) => !accountOrder.includes(session.sessionId))]
}

interface SessionRowProps {
  session: SessionMeta
  waiting: SessionId | null
  zh: boolean
  onSelected?: () => void
  draggable?: boolean
  onDragStart?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
}

function SessionRow({ session, waiting, zh, onSelected, ...dragProps }: SessionRowProps): JSX.Element {
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const selectSession = useAppStore((state) => state.selectSession)
  const renameSession = useAppStore((state) => state.renameSession)
  const archiveSession = useAppStore((state) => state.deleteSession)
  const forkSession = useAppStore((state) => state.forkSession)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const title = session.title ?? (zh ? '新会话' : 'New Session')

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const submitRename = (): void => {
    const value = draft.trim()
    setRenaming(false)
    if (value !== '' && value !== session.title) void renameSession(session.sessionId, value)
  }

  if (renaming) {
    return <li className="session-row session-row-editing"><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={submitRename} onKeyDown={(event) => {
      if (event.key === 'Enter') submitRename()
      if (event.key === 'Escape') setRenaming(false)
    }} /></li>
  }

  return <li className="session-row-wrap" draggable={dragProps.draggable} onDragStart={dragProps.onDragStart} onDragOver={(event) => dragProps.draggable && event.preventDefault()} onDrop={dragProps.onDrop}>
    <button type="button" className={`session-row${activeSessionId === session.sessionId ? ' session-row-active' : ''}`} title={title} onClick={() => {
      void selectSession(session.sessionId)
      onSelected?.()
    }}>
      <span className={dotClass(session, waiting)} />
      <span className="session-title">{title}</span>
      {!session.blank && <span className="session-time">{relativeTime(session.updatedAt, zh)}</span>}
      {!session.blank && <span className="session-menu-trigger" role="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }}><Icon name="dots" /></span>}
    </button>
    {menuOpen && <div className="session-menu" ref={menuRef}>
      <button type="button" onClick={() => { setMenuOpen(false); setDraft(session.title ?? ''); setRenaming(true) }}>{zh ? '重命名' : 'Rename'}</button>
      <button type="button" onClick={() => { setMenuOpen(false); void forkSession(session.sessionId) }}>{zh ? '分叉会话' : 'Fork session'}</button>
      <button type="button" className="session-menu-danger" onClick={() => { setMenuOpen(false); void archiveSession(session.sessionId) }}>{zh ? '归档会话' : 'Archive session'}</button>
    </div>}
  </li>
}

export interface ChatListPanelProps {
  mode: ConversationMode
  onModeChange: (mode: ConversationMode) => void
}

export function ChatListPanel({ mode, onModeChange }: ChatListPanelProps): JSX.Element {
  const sessions = useAppStore((state) => state.sessions)
  const workspaces = useAppStore((state) => state.workspaces)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const overlayBySession = useAppStore((state) => state.overlayBySession)
  const prefs = useAppStore((state) => state.workspaceViewPrefs)
  const language = useAppStore((state) => state.uiPrefs.language)
  const newChat = useAppStore((state) => state.newChat)
  const addDshWorkspace = useAppStore((state) => state.addDshWorkspace)
  const renameWorkspace = useAppStore((state) => state.renameWorkspace)
  const deleteWorkspace = useAppStore((state) => state.deleteWorkspace)
  const insertWorkspaceBefore = useAppStore((state) => state.insertWorkspaceBefore)
  const insertSessionBefore = useAppStore((state) => state.insertSessionBefore)
  const setGroupBy = useAppStore((state) => state.setSessionGroupBy)
  const setOrderBy = useAppStore((state) => state.setSessionOrderBy)
  const setExpanded = useAppStore((state) => state.setWorkspaceExpanded)
  const setLocalOrder = useAppStore((state) => state.setLocalSessionOrder)
  const zh = language === 'zh'
  const { t } = useI18n()
  const trajectoryAvailable = useAppStore((state) => state.capabilities?.trajectory === true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [remoteIds, setRemoteIds] = useState<SessionId[]>([])
  const [searchWarning, setSearchWarning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [workspaceDialog, setWorkspaceDialog] = useState<{ kind: 'rename' | 'delete'; workspace: WorkspaceView } | null>(null)
  const [workspaceDraft, setWorkspaceDraft] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [dragWorkspace, setDragWorkspace] = useState<WorkspaceId | null>(null)
  const [dragSession, setDragSession] = useState<{ account: string; id: SessionId } | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const waiting = useMemo(() => firstWaitingSessionId(overlayBySession), [overlayBySession])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (debounced === '') { setRemoteIds([]); setSearchWarning(false); return }
    let active = true
    void rpc<{ items: Array<{ sessionId: SessionId }>; hasMore: boolean }>('session.search', { query: debounced })
      .then((result) => { if (active) { setRemoteIds(result.items.map((item) => item.sessionId)); setSearchWarning(false) } })
      .catch(() => { if (active) { setRemoteIds([]); setSearchWarning(true) } })
    return () => { active = false }
  }, [debounced])

  useEffect(() => {
    if (!historyOpen) return
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      setHistoryOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setViewMenuOpen(false); setHistoryOpen(false) } }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey) }
  }, [historyOpen])

  // A truly empty untitled placeholder stays hidden; an explicitly renamed
  // blank Session is intentional and remains navigable (also matches legacy hosts).
  const visibleSessions = sessions.filter((session) => !session.blank || session.title !== null || session.sessionId === activeSessionId)
  const filtered = useMemo(() => {
    if (debounced === '') return visibleSessions
    const needle = debounced.toLocaleLowerCase()
    const remote = new Set(remoteIds)
    return visibleSessions.filter((session) => (session.title ?? '').toLocaleLowerCase().includes(needle) || remote.has(session.sessionId))
  }, [visibleSessions, debounced, remoteIds])
  const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds))
  const ungrouped = filtered.filter((session) => !accounted.has(session.sessionId))
  const byId = new Map(filtered.map((session) => [session.sessionId, session]))
  const updated = prefs.orderBy === 'updated'
  const flat = orderedSessions(filtered, prefs.sessionOrderByAccount[FLAT], updated)

  const add = async (): Promise<void> => {
    setAdding(true); setAddError(null)
    try { await addDshWorkspace(); setHistoryOpen(false) }
    catch (error) { setAddError(error instanceof Error ? error.message : String(error)) }
    finally { setAdding(false) }
  }

  const submitWorkspaceDialog = async (): Promise<void> => {
    if (workspaceDialog === null) return
    setWorkspaceBusy(true)
    setWorkspaceError(null)
    try {
      if (workspaceDialog.kind === 'rename') await renameWorkspace(workspaceDialog.workspace.workspaceId, workspaceDraft.trim())
      else await deleteWorkspace(workspaceDialog.workspace.workspaceId)
      setWorkspaceDialog(null)
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const dropSession = (account: string, target: SessionId, ordered: SessionMeta[], workspaceId?: WorkspaceId): void => {
    if (dragSession === null || dragSession.account !== account || dragSession.id === target) return
    const ids = ordered.map((session) => session.sessionId).filter((id) => id !== dragSession.id)
    ids.splice(Math.max(0, ids.indexOf(target)), 0, dragSession.id)
    setLocalOrder(account, ids)
    if (workspaceId !== undefined) void insertSessionBefore(workspaceId, dragSession.id, target)
    setDragSession(null)
  }

  const renderRun = (account: string, ordered: SessionMeta[], workspaceId?: WorkspaceId): JSX.Element => <ul className="session-list">
    {ordered.map((session) => <SessionRow key={session.sessionId} session={session} waiting={waiting} zh={zh} onSelected={() => setHistoryOpen(false)}
      draggable={prefs.orderBy === 'manual'}
      onDragStart={() => setDragSession({ account, id: session.sessionId })}
      onDrop={(event) => { event.preventDefault(); dropSession(account, session.sessionId, ordered, workspaceId) }} />)}
  </ul>

  const renderGroup = (workspace: WorkspaceView | null, groupSessions: SessionMeta[]): JSX.Element | null => {
    const key = workspace?.workspaceId ?? UNGROUPED
    if (workspace === null && groupSessions.length === 0) return null
    const ordered = orderedSessions(groupSessions, prefs.sessionOrderByAccount[key], updated)
    const expanded = prefs.groupExpansion[key] ?? true
    const showAll = prefs.groupExpansion[`${key}:all`] === true
    const shown = showAll ? ordered : ordered.slice(0, COLLAPSED_LIMIT)
    const label = workspace?.title ?? (zh ? '未分组' : 'Ungrouped')
    return <section key={key} className="workspace-group" draggable={workspace !== null}
      onDragStart={() => workspace !== null && setDragWorkspace(workspace.workspaceId)}
      onDragOver={(event) => workspace !== null && event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (workspace !== null && dragWorkspace !== null && dragWorkspace !== workspace.workspaceId) void insertWorkspaceBefore(dragWorkspace, workspace.workspaceId); setDragWorkspace(null) }}>
      <div className="workspace-row">
        <button type="button" className="workspace-toggle" aria-expanded={expanded} onClick={() => setExpanded(key, !expanded)}><span className={`workspace-chevron${expanded ? ' open' : ''}`}>›</span><span title={workspace?.path}>{label}</span><span className="workspace-count">{ordered.length}</span></button>
        {workspace !== null && <>
          <button type="button" className="workspace-new" title={zh ? '在此工作区新建会话' : 'New session in workspace'} onClick={() => { void newChat(workspace.workspaceId); setHistoryOpen(false) }}><Icon name="plus" /></button>
          <button type="button" className="workspace-actions" title={zh ? '工作区操作' : 'Workspace actions'} onClick={() => { setWorkspaceDraft(workspace.title); setWorkspaceError(null); setWorkspaceDialog({ kind: 'rename', workspace }) }}><Icon name="dots" /></button>
        </>}
      </div>
      {expanded && <>
        {renderRun(key, shown, workspace?.workspaceId)}
        {ordered.length > COLLAPSED_LIMIT && <button type="button" className="session-overflow" onClick={() => setExpanded(`${key}:all`, !showAll)}>{showAll ? (zh ? '收起' : 'Show less') : (zh ? `展开其余 ${ordered.length - COLLAPSED_LIMIT} 个会话` : `Show ${ordered.length - COLLAPSED_LIMIT} more sessions`)}</button>}
      </>}
    </section>
  }

  const runningCount = sessions.filter((session) => session.running).length
  const recent = [...visibleSessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)

  return <section className="region-chat-list chat-list" data-region="ChatListPanel" ref={panelRef}>
    <div className="chat-list-header">
      {activeSessionId !== null && trajectoryAvailable ? (
        <div className="chat-list-mode-tabs" role="tablist" aria-label={t('Conversation view')}>
          <button type="button" role="tab" aria-selected={mode === 'chat'} onClick={() => onModeChange('chat')}>{t('Chat')}</button>
          <button type="button" role="tab" aria-selected={mode === 'trajectory'} onClick={() => onModeChange('trajectory')}>{t('Trajectory')}</button>
        </div>
      ) : <span className="chat-list-title">{t('Chat')}</span>}
      <span className="chat-list-actions">
        <button type="button" className={`icon-btn${historyOpen ? ' icon-btn-active' : ''}`} title={zh ? '历史会话' : 'History'} onClick={() => setHistoryOpen((value) => !value)}>{runningCount > 0 ? <span className="chat-list-running-badge"><span className="chat-list-running-spinner" /><span className="chat-list-running-count">{runningCount}</span></span> : <Icon name="clock" />}</button>
        <button type="button" className="icon-btn" title={zh ? '设置' : 'Settings'} onClick={openSettings}><Icon name="gear" /></button>
        <button type="button" className="icon-btn" title={zh ? '新建会话' : 'New chat'} onClick={() => void newChat()}><Icon name="pencil" /></button>
      </span>
    </div>
    {activeSessionId === null && <ul className="session-list recent-session-list">{recent.map((session) => <SessionRow key={session.sessionId} session={session} waiting={waiting} zh={zh} />)}</ul>}
    {historyOpen && <div className="chat-list-dropdown">
      <div className="chat-list-search"><Icon name="search" /><input autoFocus placeholder={zh ? '搜索会话…' : 'Search sessions…'} value={query} onChange={(event) => setQuery(event.target.value.replaceAll('\0', '').slice(0, 500))} />{query !== '' && <button type="button" aria-label={zh ? '清除搜索' : 'Clear search'} onClick={() => setQuery('')}><Icon name="close" /></button>}</div>
      <div className="history-controls">
        <div className="view-options-wrap">
          <button type="button" className="view-options-trigger" aria-expanded={viewMenuOpen} onClick={() => setViewMenuOpen((value) => !value)}>{zh ? '分组方式' : 'Group by'} <Icon name="chevron" /></button>
          {viewMenuOpen && <div className="view-options-menu">
            <span>{zh ? '分组方式' : 'Group by'}</span>
            {([['workspace', zh ? '按工作区' : 'By workspace'], ['flat', zh ? '单列表' : 'One list']] as Array<[SessionGroupBy, string]>).map(([value, label]) => <button key={value} type="button" className={prefs.groupBy === value ? 'selected' : ''} onClick={() => { setGroupBy(value); setViewMenuOpen(false) }}>{label}<b>{prefs.groupBy === value ? '✓' : ''}</b></button>)}
            <span>{zh ? '排序方式' : 'Order by'}</span>
            <button type="button" className={prefs.orderBy === 'manual' ? 'selected' : ''} onClick={() => { setOrderBy('manual'); setViewMenuOpen(false) }}>{zh ? '手动排序' : 'Manual'}<b>{prefs.orderBy === 'manual' ? '✓' : ''}</b></button>
            <button type="button" className={prefs.orderBy === 'updated' ? 'selected' : ''} onClick={() => { setOrderBy('updated'); setViewMenuOpen(false) }}>{zh ? '最近更新' : 'Last updated'}<b>{prefs.orderBy === 'updated' ? '✓' : ''}</b></button>
          </div>}
        </div>
        <button type="button" className="add-workspace-btn" disabled={adding} title={zh ? '添加工作区' : 'Add workspace'} aria-label={zh ? '添加工作区' : 'Add workspace'} onClick={() => void add()}><Icon name="folderAdd" /></button>
      </div>
      {addError !== null && <div className="history-warning" role="alert"><span>{addError}</span><button type="button" onClick={() => void add()}>{zh ? '重试' : 'Retry'}</button></div>}
      {searchWarning && <div className="history-warning" role="status">{zh ? '内容搜索暂不可用，仅显示名称匹配。' : 'Content search unavailable; showing title matches.'}</div>}
      <div className="history-tree">
        {filtered.length === 0 && <div className="chat-list-empty">{zh ? '无匹配会话' : 'No matching sessions'}</div>}
        {filtered.length > 0 && (debounced !== '' || prefs.groupBy === 'flat') && renderRun(FLAT, flat)}
        {filtered.length > 0 && debounced === '' && prefs.groupBy === 'workspace' && <>{workspaces.map((workspace) => renderGroup(workspace, workspace.sessionIds.flatMap((id) => byId.get(id) ?? [])))}{renderGroup(null, ungrouped)}</>}
      </div>
    </div>}
    {workspaceDialog !== null && <div className="history-dialog-backdrop" role="presentation"><div className="history-dialog" role="dialog" aria-modal="true">
      <h3>{workspaceDialog.kind === 'rename' ? (zh ? '重命名工作区' : 'Rename workspace') : (zh ? '删除工作区' : 'Delete workspace')}</h3>
      {workspaceDialog.kind === 'rename' ? <input autoFocus value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} /> : <p>{zh ? `将把“${workspaceDialog.workspace.title}”从工作区列表中移除。文件夹与会话记录会保留。` : `Remove “${workspaceDialog.workspace.title}” from the list. Files and session logs are kept.`}</p>}
      {workspaceError !== null && <p className="history-dialog-error" role="alert">{workspaceError}</p>}
      <div><button type="button" disabled={workspaceBusy} onClick={() => setWorkspaceDialog(null)}>{zh ? '取消' : 'Cancel'}</button>{workspaceDialog.kind === 'rename'
        ? <><button type="button" className="danger-link" disabled={workspaceBusy} onClick={() => { setWorkspaceError(null); setWorkspaceDialog({ kind: 'delete', workspace: workspaceDialog.workspace }) }}>{zh ? '删除工作区' : 'Delete workspace'}</button><button type="button" disabled={workspaceBusy || workspaceDraft.trim() === ''} onClick={() => void submitWorkspaceDialog()}>{workspaceBusy ? (zh ? '处理中…' : 'Working…') : (zh ? '重命名' : 'Rename')}</button></>
        : <button type="button" className="danger-btn" disabled={workspaceBusy} onClick={() => void submitWorkspaceDialog()}>{workspaceBusy ? (zh ? '处理中…' : 'Working…') : (zh ? '删除工作区' : 'Delete workspace')}</button>}</div>
    </div></div>}
  </section>
}
