/**
 * ReasoningRow (W3): the collapsible "Think" row. Collapsed it shows a single
 * line (bulb icon + "Think" + summary); while streaming the summary tracks the
 * latest line. Click toggles the full indented text.
 */

import { useState, type JSX } from 'react'
import type { ReasoningNode } from '../../types'
import { useI18n } from '../../use-i18n'

/** Collapsed summary: latest line while streaming, first line when settled. */
function summary(text: string, streaming: boolean, thinking: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return streaming ? thinking : ''
  return (streaming ? lines[lines.length - 1] : lines[0]) ?? ''
}

export function ReasoningRow(props: { node: ReasoningNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  return (
    <div className={`reasoning-row${props.node.streaming ? ' reasoning-running' : ''}`}>
      <button type="button" className="reasoning-header" onClick={() => setOpen((v) => !v)}>
        <span className="reasoning-icon">💡</span>
        <span className="reasoning-label">Think</span>
        <span className="reasoning-dot">·</span>
        <span className="reasoning-summary">{summary(props.node.text, props.node.streaming, t('Thinking…'))}</span>
        <span className={`reasoning-chevron${open ? ' reasoning-chevron-open' : ''}`}>›</span>
      </button>
      {open && <div className="reasoning-body">{props.node.text}</div>}
    </div>
  )
}
