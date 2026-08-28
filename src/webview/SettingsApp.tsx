import { useEffect, useState, type JSX } from 'react'
import type { SettingsInitPayload } from '../shared/bridge'
import { onSettingsInit, onSettingsInitError, onSettingsRefresh, waitSettingsInit } from './bridge'
import { SettingsPage } from './components/settings/SettingsPage'
import { useAppStore } from './store'

/** Independent editor-area settings application. It intentionally does not
 * initialize sessions, conversation state, overlays, or chat event streams. */
export function SettingsApp(): JSX.Element {
  const appearance = useAppStore((state) => state.uiPrefs.appearance)
  const language = useAppStore((state) => state.uiPrefs.language)
  const [hostError, setHostError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const applyInit = (payload: SettingsInitPayload): void => {
      useAppStore.setState({
        hostVersion: payload.hostVersion,
        capabilities: payload.capabilities,
        hostStatus: 'ready',
        uiPrefs: {
          ...useAppStore.getState().uiPrefs,
          language: payload.vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en',
        },
      })
      setHostError(null)
      setReady(true)
      void useAppStore.getState().loadSettings().catch(() => undefined)
    }
    const disposeInit = onSettingsInit(applyInit)
    const disposeRefresh = onSettingsRefresh(() => {
      void useAppStore.getState().loadSettings().catch(() => undefined)
    })
    const disposeError = onSettingsInitError((error) => {
      setHostError(error)
      setReady(false)
    })
    void waitSettingsInit().then(applyInit).catch((error: unknown) => {
      setHostError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      disposeInit()
      disposeRefresh()
      disposeError()
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  if (!ready) {
    return (
      <main className="settings-bootstrap" data-dsh-theme={appearance}>
        <div className="settings-bootstrap-card" role={hostError === null ? 'status' : 'alert'}>
          <strong>{language === 'zh' ? 'DeepSeek Harness 设置' : 'DeepSeek Harness Settings'}</strong>
          <p>{hostError ?? (language === 'zh' ? '正在连接 DSH Host…' : 'Connecting to the DSH Host…')}</p>
        </div>
      </main>
    )
  }
  return <SettingsPage />
}
