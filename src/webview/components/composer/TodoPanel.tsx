/**
 * TodoPanel (owned by W4): the agent todo checklist docked above the composer
 * card while store.todos is non-empty. Status glyphs: completed ✓ /
 * in_progress ◌ / pending ○.
 * Contract: ARCHITECTURE.md section 5.3 ({ todos }).
 */

import type { JSX } from 'react'
import type { TodoItem } from '../../types'
import { useI18n } from '../../use-i18n'

const STATUS_GLYPH: Record<TodoItem['status'], string> = {
  completed: '✓',
  in_progress: '◌',
  pending: '○',
}

export interface TodoPanelProps {
  todos: TodoItem[]
}

export function TodoPanel({ todos }: TodoPanelProps): JSX.Element | null {
  const { t } = useI18n()
  const statusLabel: Record<TodoItem['status'], string> = { completed: t('Completed'), in_progress: t('In progress'), pending: t('Pending') }
  if (todos.length === 0) return null
  return (
    <ul className="todo-panel" aria-label={t('Task list')}>
      {todos.map((todo, i) => (
        <li key={`${i}-${todo.content}`} className={`todo-item todo-${todo.status}`}>
          <span className="todo-glyph" aria-hidden>{STATUS_GLYPH[todo.status]}</span>
          <span className="todo-content">{todo.content}</span>
          <span className="todo-status">{statusLabel[todo.status]}</span>
        </li>
      ))}
    </ul>
  )
}
