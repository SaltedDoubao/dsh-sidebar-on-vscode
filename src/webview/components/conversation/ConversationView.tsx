/**
 * ConversationView (W3): the message-stream container. The section element
 * itself is the scrollport (base.css gives .region-conversation overflow-y).
 * Behavior: bottom-follow while pinned (any reader scroll away unpins, back
 * near the floor re-pins), a floating "回到底部" button while unpinned, and a
 * top "Load older" button that prepends the next history page while keeping
 * the reader's scroll position. Node kinds dispatch to their row components.
 */

import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { SessionId } from '../../../extension/protocol/brand'
import { useAppStore } from '../../store'
import { openFile } from '../../bridge'
import type { CompactionNode, ContextInjectionNode, ConversationNode, ErrorNode, RetryNode, WorkflowRunNode } from '../../types'
import type { ConversationMode } from '../../types'
import { useI18n } from '../../use-i18n'
import { AssistantBubble, MessageBubble } from './MessageBubble'
import { ReasoningRow } from './ReasoningRow'
import { ToolCallRow } from './ToolCallRow'
import { formatDuration, TurnStatusLine } from './TurnStatusLine'
import './conversation.css'

export interface ConversationViewProps {
  /** Active session; the view re-mounts when it changes. */
  sessionId: SessionId
  mode: ConversationMode
}

/** Reader is pinned to the floor while within this many px of it. */
const FOLLOW_THRESHOLD = 24

/** Collapsed context-injection row (AGENTS.md and friends); click expands. */
function ContextInjectionRow(props: { node: ContextInjectionNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const label = props.node.form !== undefined ? `${props.node.plugin} · ${props.node.form}` : props.node.plugin
  return (
    <div className="ctx-row">
      <button type="button" className="ctx-row-head" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden>📎</span>
        <span className="ctx-row-label">{t('Context injection')}</span>
        <span className="tool-row-dot">·</span>
        <span className="tool-row-summary">{label}</span>
        <span className={`tool-row-chevron${open ? ' tool-row-chevron-open' : ''}`}>›</span>
      </button>
      {open && <pre className="ctx-row-body">{props.node.text}</pre>}
    </div>
  )
}

/** Compaction marker line ("已压缩 N 条历史" style). */
function CompactionRow(props: { node: CompactionNode }): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="marker-row marker-compaction">
      <span aria-hidden>🗜</span> {t('Compacted history{summary}', { summary: props.node.summary !== undefined ? `：${props.node.summary}` : '' })}
    </div>
  )
}

/** Automatic model-retry marker line. */
function RetryRow(props: { node: RetryNode }): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="marker-row marker-retry">
      <span aria-hidden>↻</span> {t('Retry {attempt}{message}', { attempt: props.node.attempt, message: props.node.message !== undefined ? `，${props.node.message}` : '' })}
    </div>
  )
}

/** Turn failure line: red dot + message + optional machine code. */
function ErrorRow(props: { node: ErrorNode }): JSX.Element {
  return (
    <div className="marker-row marker-error">
      <span className="tool-dot-error" aria-hidden /> {props.node.message}
      {props.node.code !== undefined && <span className="marker-code">{props.node.code}</span>}
    </div>
  )
}

function WorkflowRunCard({ node }: { node: WorkflowRunNode }): JSX.Element {
  const [open, setOpen] = useState(true)
  const { t } = useI18n()
  return (
    <article className="workflow-run-card" data-workflow-run={node.runId}>
      <button type="button" className="workflow-run-head" onClick={() => setOpen((value) => !value)}>
        <span className={`workflow-status workflow-status-${node.status}`} aria-hidden />
        <strong>{node.name}</strong>
        <span>{node.status}</span>
        <span className={`tool-row-chevron${open ? ' tool-row-chevron-open' : ''}`}>›</span>
      </button>
      {open && (
        <ol className="workflow-members">
          {node.members.map((member) => (
            <li key={member.seq}>
              <span className={`workflow-status workflow-status-${member.status}`} aria-hidden />
              <span>{member.label || t('Agent {seq}', { seq: member.seq })}</span>
              {member.phase !== undefined && <span className="settings-tag">{member.phase}</span>}
              <span className="tool-row-summary">{member.status}</span>
            </li>
          ))}
          {node.members.length === 0 && <li className="tool-row-summary">{t('Waiting for workflow nodes…')}</li>}
        </ol>
      )}
    </article>
  )
}

/** Dispatch one conversation node to its row component. Exported for tests. */
export function NodeView(props: { node: ConversationNode }): JSX.Element {
  const { node } = props
  switch (node.kind) {
    case 'user-message':
      return <MessageBubble node={node} />
    case 'assistant-text':
      return <AssistantBubble node={node} />
    case 'reasoning':
      return <ReasoningRow node={node} />
    case 'tool-call':
      return <ToolCallRow node={node} />
    case 'context-injection':
      return <ContextInjectionRow node={node} />
    case 'compaction':
      return <CompactionRow node={node} />
    case 'retry':
      return <RetryRow node={node} />
    case 'error':
      return <ErrorRow node={node} />
    case 'workflow-run':
      return <WorkflowRunCard node={node} />
  }
}

/** Turn-tail stats row: run duration plus accumulated token usage. */
function TurnStatsRow(): JSX.Element | null {
  const stats = useAppStore((s) => s.stats)
  const lastTurnMs = useAppStore((s) => s.lastTurnMs)
  const turnStatus = useAppStore((s) => s.turnStatus)
  const zh = useAppStore((s) => s.uiPrefs.language === 'zh')
  if (turnStatus !== 'idle' || stats === null) return null
  const parts: string[] = []
  if (lastTurnMs !== null) parts.push(`${zh ? '运行耗时' : 'Ran for'} ${formatDuration(lastTurnMs)}`)
  parts.push(`${zh ? '输入' : 'Input'} ${stats.inputTokens} tok`)
  parts.push(`${zh ? '输出' : 'Output'} ${stats.outputTokens} tok`)
  return <div className="turn-stats-row">{parts.join(' · ')}</div>
}

export function ConversationView({ sessionId, mode }: ConversationViewProps): JSX.Element {
  const nodes = useAppStore((s) => s.nodes)
  const turnStatus = useAppStore((s) => s.turnStatus)
  const turnStartedAt = useAppStore((s) => s.turnStartedAt)
  const hasMoreHistory = useAppStore((s) => s.hasMoreHistory)
  const loadingOlder = useAppStore((s) => s.loadingOlder)
  const loadOlderHistory = useAppStore((s) => s.loadOlderHistory)
  const { locale, t } = useI18n()
  const deliverables = [...new Set(nodes.flatMap((node) => {
    if (node.kind !== 'tool-call' || node.status !== 'done') return []
    const view = node.resultView?.card === 'diff' ? node.resultView : node.callView?.card === 'diff' ? node.callView : undefined
    return view?.diffs.map((diff) => diff.path) ?? []
  }))]

  const scrollRef = useRef<HTMLElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Scroll height captured when a Load-older request starts. */
  const prependHeightRef = useRef<number | null>(null)

  // Bottom-follow: new flow content snaps to the floor only while pinned.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el !== null && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [nodes, turnStatus])

  // After a prepend lands, restore the reader's position over the new head.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el !== null && !loadingOlder && prependHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
    }
  }, [loadingOlder, nodes])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (el === null) return
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD
    atBottomRef.current = pinned
    setAtBottom(pinned)
  }

  const toBottom = (): void => {
    const el = scrollRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }

  const loadOlder = (): void => {
    const el = scrollRef.current
    if (el !== null) prependHeightRef.current = el.scrollHeight
    void loadOlderHistory(sessionId)
  }

  return (
    <section
      ref={scrollRef}
      className="region region-conversation conversation-view"
      data-region="ConversationView"
      data-session={sessionId}
      onScroll={onScroll}
    >
      {hasMoreHistory && (
        <div className="conv-older">
          <button type="button" className="conv-older-btn" disabled={loadingOlder} onClick={loadOlder}>
            {loadingOlder ? t('Loading…') : t('Load older')}
          </button>
        </div>
      )}
      {mode === 'trajectory' ? (
        <ol className="trajectory-list">
          {nodes.map((node) => (
            <li key={node.id}>
              <time>{new Date(node.time).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en')}</time>
              <span className="trajectory-kind">{node.kind}</span>
              <span className="trajectory-summary">
                {node.kind === 'tool-call' ? `${node.name} · ${node.status}`
                  : node.kind === 'assistant-text' ? node.text.slice(0, 100)
                    : node.kind === 'user-message' ? t('User prompt')
                      : node.kind === 'workflow-run' ? `${node.name} · ${node.status}`
                        : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : nodes.length === 0 ? (
        <div className="empty-hero">{t('Type a message to start chatting')}</div>
      ) : (
        <div className="conv-flow">
          {nodes.map((n) => (
            <div key={n.id} className={`conv-node conv-node-${n.kind}`}>
              <NodeView node={n} />
            </div>
          ))}
        </div>
      )}
      {turnStatus === 'running' && turnStartedAt !== null && <TurnStatusLine startedAt={turnStartedAt} />}
      {deliverables.length > 0 && (
        <div className="deliverables-row" aria-label={t('Deliverables')}>
          <strong>{t('Deliverables')}</strong>
          {deliverables.map((file) => <button key={file} type="button" onClick={() => openFile(file)}>{file}</button>)}
        </div>
      )}
      <TurnStatsRow />
      {!atBottom && (
        <div className="conv-tobottom-slot">
          <button type="button" className="conv-tobottom" aria-label={t('Back to bottom')} onClick={toBottom}>
            ↓ {t('Back to bottom')}
          </button>
        </div>
      )}
    </section>
  )
}
