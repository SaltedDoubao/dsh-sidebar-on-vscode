/**
 * App shell: three-layer layout (chat list / conversation / composer) plus the
 * host-status banner. Owns bootstrap: the
 * store's initialize() runs once on mount.
 */

import { useEffect, useState, type JSX } from 'react'
import { ChatListPanel } from './components/chat-list/ChatListPanel'
import { ComposerCard } from './components/composer/ComposerCard'
import { ConversationView } from './components/conversation/ConversationView'
import { useAppStore } from './store'
import { openFolder, openSettings } from './bridge'
import { translate } from './i18n'
import type { ConversationMode } from './types'
import deepseekIconSvg from '../../resources/icon.svg?raw'

const deepseekIconDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(
  deepseekIconSvg.replace('fill="none"', 'fill="black"')
)}`

export function App(): JSX.Element {
  const initialized = useAppStore((s) => s.initialized)
  const hostStatus = useAppStore((s) => s.hostStatus)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const cwd = useAppStore((s) => s.cwd)
  const models = useAppStore((s) => s.models)
  const capabilities = useAppStore((s) => s.capabilities)
  const language = useAppStore((s) => s.uiPrefs.language)
  const appearance = useAppStore((s) => s.uiPrefs.appearance)
  const workspaces = useAppStore((s) => s.workspaces)
  const [modelProbeSettled, setModelProbeSettled] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [conversationMode, setConversationMode] = useState<ConversationMode>('chat')

  useEffect(() => {
    void useAppStore.getState().initialize()
  }, [])

  useEffect(() => {
    if (!initialized) return
    const timer = setTimeout(() => setModelProbeSettled(true), 800)
    return () => clearTimeout(timer)
  }, [initialized])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  useEffect(() => {
    setConversationMode('chat')
  }, [activeSessionId, capabilities?.trajectory])

  const t = (key: Parameters<typeof translate>[1]): string => translate(language, key)

  const onboarding = cwd !== '' && activeSessionId === null && modelProbeSettled
    && capabilities?.modelConfiguration === true && models.length === 0 && !onboardingDismissed

  return (
    <main className="app-shell" data-dsh-theme={appearance}>
      {hostStatus !== 'ready' && (
        <div className={`host-banner host-banner-${hostStatus}`}>
          {hostStatus === 'starting' ? t('Connecting to dsh host…') : t('dsh host failed to start or disconnected. Check the DeepSeek Harness logs, fix the configuration, then run Restart Host.')}
        </div>
      )}
      <ChatListPanel mode={conversationMode} onModeChange={setConversationMode} />
      {onboarding ? (
        <section className="region region-conversation" data-region="ProviderOnboarding">
          <div className="empty-hero onboarding-card">
            <strong>{t('Connect a model provider')}</strong>
            <p>{t('No models are available. Configure an API key, base URL, or custom provider to begin.')}</p>
            <div>
              <button type="button" className="primary-btn" onClick={openSettings}>{t('Open model settings')}</button>
              <button type="button" className="settings-btn" onClick={() => setOnboardingDismissed(true)}>{t('Later')}</button>
            </div>
          </div>
        </section>
      ) : cwd === '' && workspaces.length === 0 ? (
        <section className="region region-conversation" data-region="EmptyWorkspace">
          <div className="empty-hero">
            <div>{t('Open a folder to begin chatting')}</div>
            <button type="button" className="primary-btn" onClick={openFolder}>{t('Open Folder')}</button>
          </div>
        </section>
      ) : activeSessionId === null ? (
        <section className="region region-conversation" data-region="ConversationView">
          <div className="empty-hero">
            {initialized ? (
              <span
                className="empty-deepseek-icon"
                style={{
                  WebkitMaskImage: `url("${deepseekIconDataUrl}")`,
                  maskImage: `url("${deepseekIconDataUrl}")`,
                }}
                aria-label="DeepSeek"
              />
            ) : (
              <div>{t('Loading…')}</div>
            )}
          </div>
        </section>
      ) : (
        <ConversationView key={activeSessionId} sessionId={activeSessionId} mode={conversationMode} />
      )}
      {(cwd !== '' || workspaces.length > 0) && <ComposerCard />}
    </main>
  )
}
