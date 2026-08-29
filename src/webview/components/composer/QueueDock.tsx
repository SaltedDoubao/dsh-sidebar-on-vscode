/**
 * QueueDock (owned by W4): the strip of queued messages above the composer
 * card. One item renders directly; several collapse behind a count header.
 * Each row offers edit (inline input, Enter saves / Escape cancels), remove,
 * and Steer (insert into the running turn) — all routed through
 * store.updateQueueItem by the owning card.
 * Contract: ARCHITECTURE.md section 5.3 ({ queue, onEdit, onRemove, onSteer }).
 */

import { useEffect, useState, type JSX } from 'react'
import type { MessageId } from '../../../extension/protocol/brand'
import type { QueuedMessage } from '../../types'
import { useI18n } from '../../use-i18n'

export interface QueueDockProps {
  queue: QueuedMessage[]
  /** Steer is only meaningful while a turn runs. */
  running: boolean
  onEdit: (id: MessageId, text: string) => Promise<void>
  onRemove: (id: MessageId) => Promise<void>
  onSteer: (id: MessageId) => Promise<void>
}

export function QueueDock({ queue, running, onEdit, onRemove, onSteer }: QueueDockProps): JSX.Element | null {
  const [editing, setEditing] = useState<{ id: MessageId; text: string } | null>(null)
  const [busy, setBusy] = useState<MessageId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const { t } = useI18n()

  // Reset transient state when the queue drains or the edited row disappears.
  useEffect(() => {
    if (queue.length === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && !queue.some((row) => row.id === editing.id)) setEditing(null)
  }, [collapsed, editing, queue])

  if (queue.length === 0) return null

  const expanded = !collapsed || editing !== null || busy !== null
  const listVisible = queue.length === 1 || expanded

  const apply = async (id: MessageId, action: () => Promise<void>): Promise<boolean> => {
    setBusy(id)
    try {
      await action()
      return true
    } finally {
      setBusy((cur) => (cur === id ? null : cur))
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await apply(editing.id, () => onEdit(editing.id, editing.text.trim()))) setEditing(null)
  }

  return (
    <div className="queue-dock" data-queue-dock="">
      {queue.length > 1 && (
        <button
          type="button"
          className="queue-header"
          aria-expanded={expanded}
          disabled={editing !== null || busy !== null}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="queue-count">{t('{count} queued messages', { count: queue.length })}</span>
          <span className="queue-chevron" aria-hidden>{expanded ? '▾' : '▴'}</span>
        </button>
      )}
      <ul className="queue-list" hidden={!listVisible}>
        {queue.map((row) => (
          <li key={row.id} className="queue-row">
            {editing?.id === row.id ? (
              <input
                autoFocus
                className="queue-editor"
                aria-label={t('Edit queued message')}
                value={editing.text}
                onChange={(e) => setEditing({ id: row.id, text: e.currentTarget.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null)
                  else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void saveEdit()
                  }
                }}
              />
            ) : (
              <span className="queue-preview">{row.text}</span>
            )}
            <div className="queue-actions">
              {editing?.id === row.id ? (
                <>
                  <button
                    type="button"
                    className="queue-action"
                    aria-label={t('Save')}
                    disabled={busy !== null || editing.text.trim() === ''}
                    onClick={() => void saveEdit()}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="queue-action"
                    aria-label={t('Cancel editing')}
                    disabled={busy !== null}
                    onClick={() => setEditing(null)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="queue-action"
                    aria-label={t('Edit queued message')}
                    disabled={busy !== null}
                    onClick={() => setEditing({ id: row.id, text: row.text })}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="queue-action"
                    aria-label={t('Delete queued message')}
                    disabled={busy !== null}
                    onClick={() => void apply(row.id, () => onRemove(row.id))}
                  >
                    🗑
                  </button>
                  <button
                    type="button"
                    className="queue-action"
                    aria-label={t('Steer now')}
                    title={running ? undefined : t('Can only steer while running')}
                    disabled={busy !== null || !running || row.placement !== 'queued'}
                    onClick={() => void apply(row.id, () => onSteer(row.id))}
                  >
                    ➤
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
