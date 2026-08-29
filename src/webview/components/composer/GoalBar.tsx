/**
 * GoalBar: the compact goal indicator docked above the composer card (a port
 * of the dsh web GoalBar). A present, non-complete goal shows a target glyph,
 * a phase label, the truncated objective, and icon actions — pause (active),
 * resume (paused), inline edit, and clear. Loading (undefined), no goal
 * (null), and complete goals render nothing. State arrives as the whole-value
 * `goal` projection; the verbs are store actions that mutate only through RPC
 * and surface failures in this component's local error slot.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { GoalProjection } from '../../../extension/protocol/goals'
import './GoalBar.css'
import { translate, type Locale } from '../../i18n'

export interface GoalBarProps {
  /** undefined = loading/capability absent, null = no current goal. */
  goal: GoalProjection | null | undefined
  onEdit: (objective: string) => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onClear: () => Promise<void>
  locale?: Locale
}

/** Whether a projection should occupy space in the composer context stack. */
export function goalBarVisible(goal: GoalProjection | null | undefined): boolean {
  return goal !== undefined && goal !== null && goal.goal.phase !== 'complete'
}

export function GoalBar({ goal, onEdit, onPause, onResume, onClear, locale = 'zh' }: GoalBarProps): JSX.Element | null {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<GoalProjection['goal']['id'] | null>(null)
  const t = (key: Parameters<typeof translate>[1]): string => translate(locale, key)
  const pendingRef = useRef(false)
  const goalId = goal?.goal.id

  // A new goal identity (cleared/replaced externally) invalidates the local
  // edit/error state so a surviving draft cannot write over the NEW goal.
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same mutation twice.
  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    try {
      await action()
      return true
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const objective = draft.trim()
    if (objective === '') return
    if (await run(() => onEdit(objective))) setEditing(false)
  }, [draft, onEdit, run])

  const clear = useCallback(async (): Promise<void> => {
    if (goal === null || goal === undefined) return
    const id = goal.goal.id
    if (await run(onClear)) setClearedGoalId(id)
  }, [goal, onClear, run])

  if (goal === undefined || goal === null || goal.goal.phase === 'complete' || goal.goal.id === clearedGoalId) return null

  const snapshot = goal.goal

  if (editing) {
    return (
      <div className="goal-bar" data-goal-bar role="group" aria-label={t('Goal editor')}>
        <input
          className="goal-objective-input"
          type="text"
          aria-label={t('Goal content')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void save()
            }
          }}
          autoFocus
        />
        {actionError !== null && <span className="goal-error" role="alert">{actionError}</span>}
        <div className="goal-actions">
          <button
            type="button"
            className="goal-action"
            aria-label={t('Save goal')}
            disabled={pending || draft.trim() === ''}
            onClick={() => void save()}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="goal-action"
            aria-label={t('Cancel editing')}
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="goal-bar"
      data-goal-bar
      role="group"
      aria-label={t('Current goal')}
      title={snapshot.phase === 'blocked' ? snapshot.blockedReason?.message : undefined}
    >
      <span className="goal-icon" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <span className="goal-phase">{{ active: t('In progress'), paused: t('Paused'), blocked: t('Blocked'), complete: t('Completed') }[snapshot.phase]}</span>
      <span className="goal-objective" title={snapshot.objective}>{snapshot.objective}</span>
      {actionError !== null && <span className="goal-error" role="alert">{actionError}</span>}
      <div className="goal-actions">
        {snapshot.phase === 'active' && (
          <button
            type="button"
            className="goal-action"
            aria-label={t('Pause goal')}
            disabled={pending}
            onClick={() => void run(onPause)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
              <rect x="4" y="3" width="3" height="10" fill="currentColor" />
              <rect x="9" y="3" width="3" height="10" fill="currentColor" />
            </svg>
          </button>
        )}
        {snapshot.phase === 'paused' && (
          <button
            type="button"
            className="goal-action"
            aria-label={t('Resume goal')}
            disabled={pending}
            onClick={() => void run(onResume)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
              <path d="M5 3l8 5-8 5z" fill="currentColor" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="goal-action"
          aria-label={t('Goal editor')}
          disabled={pending}
          onClick={() => { setDraft(snapshot.objective); setEditing(true) }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M11.3 2.7l2 2L6 12l-2.8.8L4 10l7.3-7.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="goal-action"
          aria-label={t('Clear goal')}
          disabled={pending}
          onClick={() => void clear()}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 4h10M6 4V3h4v1M5 4l.5 9.2h5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
