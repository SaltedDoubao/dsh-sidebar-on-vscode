import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { PermissionSelectProjection } from '../../../extension/protocol/projections'
import { FULL_ACCESS_PERMISSION } from './permission-select-model'

const SHIELD = 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

/** Product permission glyphs mirrored from the authoritative dsh Web UI. */
export function PermissionGlyph({ value }: { value: string }): JSX.Element {
  if (value === 'read-only') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d={SHIELD} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="m4.8 8 2.2 2.2 4.4-5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (value === 'workspace-write') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d={SHIELD} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="m5 10.8.3-2.1 4.8-4.8 2 2-4.8 4.8zM9.4 4.6l2 2" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" /></svg>
  if (value === FULL_ACCESS_PERMISSION || value === 'full-access') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d={SHIELD} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8.2 4.3v4.5M8.2 10.4v1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d={SHIELD} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
}

function displayName(value: string, name: string | undefined, zh: boolean): string {
  if (value === 'read-only') return zh ? '只读' : 'Read only'
  if (value === 'workspace-write') return zh ? '工作区可写' : 'Workspace write'
  if (value === FULL_ACCESS_PERMISSION || value === 'full-access') return zh ? '完全访问' : 'Full access'
  const source = name ?? value
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source)) return source
  return source.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export interface PermissionSelectProps {
  value: PermissionSelectProjection
  switchingTo: string | null
  error: string | null
  zh: boolean
  locked: boolean
  /** With no selected history session, this selector controls the next session default. */
  futureSession?: boolean
  onChange: (preset: string) => Promise<void>
}

export function PermissionSelect({ value, switchingTo, error, zh, locked, futureSession = false, onChange }: PermissionSelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const attempted = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 8, bottom: 42 })

  const positionMenu = (): void => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), bottom: window.innerHeight - rect.top + 6 })
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    positionMenu()
    window.addEventListener('resize', positionMenu)
    return () => window.removeEventListener('resize', positionMenu)
  }, [open])

  useEffect(() => {
    if (!attempted.current || switchingTo !== null) return
    attempted.current = false
    if (error === null) setOpen(false)
  }, [error, switchingTo])

  useEffect(() => {
    if (!locked) return
    setOpen(false)
    setConfirming(false)
  }, [locked])

  const current = value.options.find((option) => option.value === value.currentValue)
  const currentName = displayName(value.currentValue, current?.name, zh)
  const options = value.options.filter((option) => option.value !== 'custom')

  const submit = (preset: string): void => {
    attempted.current = true
    positionMenu()
    setOpen(true)
    void onChange(preset).catch(() => undefined)
  }

  const choose = (preset: string): void => {
    if (locked || preset === value.currentValue || switchingTo !== null) return
    if (preset === FULL_ACCESS_PERMISSION) {
      setOpen(false)
      setAcknowledged(false)
      setConfirming(true)
      return
    }
    submit(preset)
  }

  const closeConfirmation = (): void => {
    setAcknowledged(false)
    setConfirming(false)
  }

  return <>
    <div ref={rootRef} className="permission-select" data-composer-tool="permission">
      <button type="button" className="composer-chip permission-trigger" disabled={locked || switchingTo !== null}
        aria-label={futureSession
          ? (zh ? `下一次新会话权限：${currentName}` : `Next session permission: ${currentName}`)
          : (zh ? `权限模式，当前：${currentName}` : `Permission mode, current: ${currentName}`)}
        aria-haspopup="menu" aria-expanded={open} aria-busy={switchingTo !== null}
        title={futureSession
          ? (zh ? `下一次新会话权限：${currentName}` : `Next session permission: ${currentName}`)
          : (current?.description ?? (zh ? `当前权限：${currentName}` : `Current permission: ${currentName}`))}
        onClick={() => { positionMenu(); setOpen((shown) => !shown) }}>
        <span className="permission-trigger-icon"><PermissionGlyph value={value.currentValue} /></span>
        <span className="composer-chip-label">{currentName}</span>
        <svg className={`permission-chevron${open ? ' open' : ''}`} viewBox="0 0 14 14" fill="none" aria-hidden><path d="m4 5.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(<div ref={menuRef} className="composer-menu permission-menu permission-menu-portal" style={menuPosition} role="menu" aria-label={zh ? '权限模式' : 'Permission mode'}>
        {options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value.currentValue}
          className={`composer-menu-item${option.value === value.currentValue ? ' selected' : ''}`}
          disabled={locked || switchingTo !== null} onClick={() => choose(option.value)}>
          <span className="permission-option-icon"><PermissionGlyph value={option.value} /></span>
          <span className="composer-menu-item-copy"><span className="composer-menu-item-label">{displayName(option.value, option.name, zh)}</span>{option.description !== undefined && <span className="composer-menu-item-desc">{option.description}</span>}</span>
          <span className="composer-menu-check">{option.value === value.currentValue ? '✓' : ''}</span>
        </button>)}
        {error !== null && <div className="permission-error" role="alert">{error}</div>}
      </div>, document.body)}
    </div>
    {confirming && <div className="composer-dialog-backdrop" role="presentation" onClick={closeConfirmation}>
      <div className="composer-dialog" role="dialog" aria-modal="true" aria-label={zh ? '确认启用 Full access？' : 'Enable Full access?'} onClick={(event) => event.stopPropagation()}>
        <h2 className="composer-dialog-title">{zh ? '确认启用 Full access？' : 'Enable Full access?'}</h2>
        <p className="composer-dialog-body">{zh ? '启用后，agent 将减少确认步骤，并可直接执行文件修改、外部命令等敏感操作。仅建议在你信任当前任务时使用。' : 'The agent will require fewer confirmations and may directly perform sensitive actions, including file changes and external commands. Use only for tasks you trust.'}</p>
        <label className="composer-dialog-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{zh ? '我已了解风险，并愿意继续' : 'I understand the risks and want to continue'}</label>
        <div className="composer-dialog-actions"><button type="button" className="composer-btn" onClick={closeConfirmation}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="composer-btn composer-btn-danger" disabled={locked || !acknowledged} onClick={() => { closeConfirmation(); submit(FULL_ACCESS_PERMISSION) }}>{zh ? '启用 Full access' : 'Enable Full access'}</button></div>
      </div>
    </div>}
  </>
}
