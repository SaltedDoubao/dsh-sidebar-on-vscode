import { useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { closeSettings } from '../../bridge'
import { useAppStore } from '../../store'
import { GeneralSection } from './GeneralSection'
import { ModelsSection } from './ModelsSection'
import { PluginsSection } from './PluginsSection'
import { PresetsSection } from './PresetsSection'
import './settings.css'

type SectionId = 'general' | 'models' | 'plugins' | 'presets'

function NavIcon({ id }: { id: SectionId }): JSX.Element {
  if (id === 'models') return <svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="4" rx="5.5" ry="2.2" /><path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" /></svg>
  if (id === 'plugins') return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5 8h6M6.5 11.5h3M5 3v3M11 6V3M7 6v4M9 10v3" /></svg>
  if (id === 'presets') return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="2.4" /><path d="M3 13.2c.6-2.4 2.6-3.8 5-3.8s4.4 1.4 5 3.8" /></svg>
  return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" /></svg>
}

export function SettingsPage(): JSX.Element {
  const language = useAppStore((state) => state.uiPrefs.language)
  const appearance = useAppStore((state) => state.uiPrefs.appearance)
  const hasDocument = useAppStore((state) => state.settingsHasDocument)
  const loading = useAppStore((state) => state.settingsLoading)
  const loadError = useAppStore((state) => state.settingsError)
  const openDocument = useAppStore((state) => state.openSettingsDocument)
  const [active, setActive] = useState<SectionId>('general')
  const [actionError, setActionError] = useState<string | null>(null)
  const navRefs = useRef<Array<HTMLButtonElement | null>>([])
  const zh = language === 'zh'
  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'general', label: zh ? '通用设置' : 'General' },
    { id: 'models', label: zh ? '模型' : 'Models' },
    { id: 'plugins', label: zh ? '插件' : 'Plugins' },
    { id: 'presets', label: zh ? 'Agent 预设' : 'Agent Presets' },
  ]

  const moveNav = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const next = (index + delta + sections.length) % sections.length
    const section = sections[next]
    if (section !== undefined) setActive(section.id)
    navRefs.current[next]?.focus()
  }

  const openConfig = (): void => {
    setActionError(null)
    void openDocument().catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <main className="settings-page" data-dsh-theme={appearance}>
      <nav className="settings-nav" aria-label={zh ? '设置分类' : 'Settings categories'}>
        <div className="settings-nav-title">{zh ? '设置' : 'Settings'}</div>
        <div className="settings-nav-list" role="tablist" aria-orientation="vertical">
          {sections.map((section, index) => (
            <button
              key={section.id}
              ref={(node) => { navRefs.current[index] = node }}
              type="button"
              role="tab"
              aria-selected={active === section.id}
              tabIndex={active === section.id ? 0 : -1}
              className={`settings-nav-cell${active === section.id ? ' settings-nav-cell-active' : ''}`}
              onClick={() => setActive(section.id)}
              onKeyDown={(event) => moveNav(event, index)}
            >
              <NavIcon id={section.id} />
              <span>{section.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <section className="settings-content">
        <header className="settings-content-header">
          <span className="settings-refresh-state" role="status">{loading ? (zh ? '正在刷新…' : 'Refreshing…') : ''}</span>
          {hasDocument && (
            <button type="button" className="settings-header-action" onClick={openConfig}>
              {zh ? '打开配置文件' : 'Open config file'}
            </button>
          )}
          <button type="button" className="settings-close" aria-label={zh ? '关闭设置' : 'Close settings'} onClick={closeSettings}>
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </header>
        {(actionError ?? loadError) !== null && <div className="settings-error-banner" role="alert">{actionError ?? loadError}</div>}
        <div className="settings-body" role="tabpanel" data-section={active}>
          {active === 'general' && <GeneralSection />}
          {active === 'models' && <ModelsSection />}
          {active === 'plugins' && <PluginsSection />}
          {active === 'presets' && <PresetsSection />}
        </div>
      </section>
    </main>
  )
}
