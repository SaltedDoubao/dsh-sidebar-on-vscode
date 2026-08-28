import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { ContextBreakdownProjection } from '../../../extension/protocol/projections'
import { useAppStore } from '../../store'
import { formatTokens } from './StatsLine'
import { CONTEXT_PARTS, contextSegments, contextTooltip, contextUsage } from './context-meter-model'

export { contextOccupancy, contextSegments, contextTooltip, contextUsage } from './context-meter-model'

const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const ROWS: Array<{ key: keyof ContextBreakdownProjection; zh: string; en: string; color: string }> = [
  { ...CONTEXT_PARTS[0]!, zh: '系统提示词', en: 'System prompt' },
  { ...CONTEXT_PARTS[1]!, zh: '工具', en: 'Tools' },
  { ...CONTEXT_PARTS[2]!, zh: '对话消息', en: 'Messages' },
]

export function ContextMeter(): JSX.Element | null {
  const pressure = useAppStore((state) => state.contextPressure)
  const breakdown = useAppStore((state) => state.contextBreakdown)
  const zh = useAppStore((state) => state.uiPrefs.language === 'zh')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState({ right: 8, bottom: 42 })
  const usage = contextUsage(pressure)
  const available = usage !== null

  const positionPanel = (): void => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPanelPosition({ right: Math.max(8, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 8 })
  }

  useEffect(() => { if (!available) setOpen(false) }, [available])
  useEffect(() => {
    if (!open || !available) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [available, open])
  useEffect(() => {
    if (!open) return
    positionPanel()
    window.addEventListener('resize', positionPanel)
    return () => window.removeEventListener('resize', positionPanel)
  }, [open])

  const segments = useMemo(() => contextSegments(usage?.percent ?? 0, breakdown), [breakdown, usage?.percent])

  if (usage === null) return null
  const tooltip = contextTooltip(usage.percent, zh)
  return <span ref={rootRef} className="context-meter" data-composer-tool="meter">
    <button type="button" className="context-meter-trigger" title={tooltip} aria-label={tooltip} aria-haspopup="dialog" aria-expanded={open} onClick={() => { positionPanel(); setOpen((shown) => !shown) }}>
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden><circle className="context-meter-track" cx="7" cy="7" r={RADIUS} /><circle className="context-meter-fill" cx="7" cy="7" r={RADIUS} strokeDasharray={`${CIRCUMFERENCE * usage.percent / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" /></svg>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div ref={panelRef} className="context-meter-panel context-meter-panel-portal" style={panelPosition} role="dialog" aria-label={zh ? '上下文占用' : 'Context usage'}>
      <div className="context-meter-header"><span className="context-meter-heading">{zh ? '上下文已用' : 'Context used'}</span><strong>{usage.percent}%</strong><span className="context-meter-figures">~{formatTokens(usage.usedTokens)} / {formatTokens(usage.contextWindow)}</span></div>
      <div className="context-meter-bar">{segments.map((segment) => <span key={segment.key} className={`context-meter-segment${segment.color === '' ? '' : ` context-meter-${segment.color}`}`} style={{ width: `${segment.width}%` }} />)}</div>
      {breakdown !== null && <dl className="context-meter-rows">{ROWS.map((row) => <div className="context-meter-row" key={row.key}><dt><span className={`context-meter-swatch context-meter-${row.color}`} aria-hidden />{zh ? row.zh : row.en}</dt><dd>~{formatTokens(breakdown[row.key])}</dd></div>)}</dl>}
    </div>, document.body)}
  </span>
}
