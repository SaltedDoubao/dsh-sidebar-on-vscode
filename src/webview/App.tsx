/**
 * App shell: three-layer layout (chat list / conversation / composer) plus the
 * settings modal mount point and the host-status banner. Owns bootstrap: the
 * store's initialize() runs once on mount.
 */

import { useEffect, useState, type JSX } from 'react'
import { ChatListPanel } from './components/chat-list/ChatListPanel'
import { ComposerCard } from './components/composer/ComposerCard'
import { ConversationView } from './components/conversation/ConversationView'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { useAppStore } from './store'
import { openFolder } from './bridge'

export function App(): JSX.Element {
  const initialized = useAppStore((s) => s.initialized)
  const hostStatus = useAppStore((s) => s.hostStatus)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const cwd = useAppStore((s) => s.cwd)
  const models = useAppStore((s) => s.models)
  const capabilities = useAppStore((s) => s.capabilities)
  const openSettings = useAppStore((s) => s.openSettings)
  const language = useAppStore((s) => s.uiPrefs.language)
  const appearance = useAppStore((s) => s.uiPrefs.appearance)
  const [modelProbeSettled, setModelProbeSettled] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

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

  const copy = language === 'zh' ? {
    connecting: '正在连接 dsh host…', disconnected: 'dsh host 已断开，等待重连…',
    connect: '连接模型提供方', noModel: '尚未发现可用模型。配置 API Key、Base URL 或自定义提供方后即可开始。',
    settings: '打开模型设置', later: '稍后', openFirst: '打开一个文件夹后即可开始对话',
    openFolder: '打开文件夹', select: '选择或新建一个会话', loading: '加载中…',
  } : {
    connecting: 'Connecting to dsh host…', disconnected: 'dsh host disconnected; waiting to reconnect…',
    connect: 'Connect a model provider', noModel: 'No models are available. Configure an API key, base URL, or custom provider to begin.',
    settings: 'Open model settings', later: 'Later', openFirst: 'Open a folder to begin chatting',
    openFolder: 'Open Folder', select: 'Select or create a conversation', loading: 'Loading…',
  }

  const onboarding = cwd !== '' && activeSessionId === null && modelProbeSettled
    && capabilities?.modelConfiguration === true && models.length === 0 && !onboardingDismissed

  return (
    <main className="app-shell" data-dsh-theme={appearance}>
      {hostStatus !== 'ready' && (
        <div className={`host-banner host-banner-${hostStatus}`}>
          {hostStatus === 'starting' ? copy.connecting : copy.disconnected}
        </div>
      )}
      <ChatListPanel />
      {onboarding ? (
        <section className="region region-conversation" data-region="ProviderOnboarding">
          <div className="empty-hero onboarding-card">
            <strong>{copy.connect}</strong>
            <p>{copy.noModel}</p>
            <div>
              <button type="button" className="primary-btn" onClick={openSettings}>{copy.settings}</button>
              <button type="button" className="settings-btn" onClick={() => setOnboardingDismissed(true)}>{copy.later}</button>
            </div>
          </div>
        </section>
      ) : cwd === '' ? (
        <section className="region region-conversation" data-region="EmptyWorkspace">
          <div className="empty-hero">
            <div>{copy.openFirst}</div>
            <button type="button" className="primary-btn" onClick={openFolder}>{copy.openFolder}</button>
          </div>
        </section>
      ) : activeSessionId === null ? (
        <section className="region region-conversation" data-region="ConversationView">
          <div className="empty-hero">
            <div className="empty-hero-icon">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6l-3.2 2.4a.5.5 0 0 1-.8-.4z" />
              </svg>
            </div>
            <div>{initialized ? copy.select : copy.loading}</div>
          </div>
        </section>
      ) : (
        <ConversationView key={activeSessionId} sessionId={activeSessionId} />
      )}
      {cwd !== '' && <ComposerCard />}
      {settingsOpen && <SettingsPanel onClose={closeSettings} />}
    </main>
  )
}
