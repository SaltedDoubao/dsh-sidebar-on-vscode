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
import deepseekIconUrl from '../../resources/icon.svg?url'

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
    connecting: '正在连接 dsh host…', disconnected: 'dsh host 启动失败或连接已断开。请查看 DeepSeek Harness 日志，修正配置后运行 Restart Host。',
    connect: '连接模型提供方', noModel: '尚未发现可用模型。配置 API Key、Base URL 或自定义提供方后即可开始。',
    settings: '打开模型设置', later: '稍后', openFirst: '打开一个文件夹后即可开始对话',
    openFolder: '打开文件夹', select: '选择或新建一个会话', loading: '加载中…',
  } : {
    connecting: 'Connecting to dsh host…', disconnected: 'dsh host failed to start or disconnected. Check the DeepSeek Harness logs, fix the configuration, then run Restart Host.',
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
      ) : cwd === '' && workspaces.length === 0 ? (
        <section className="region region-conversation" data-region="EmptyWorkspace">
          <div className="empty-hero">
            <div>{copy.openFirst}</div>
            <button type="button" className="primary-btn" onClick={openFolder}>{copy.openFolder}</button>
          </div>
        </section>
      ) : activeSessionId === null ? (
        <section className="region region-conversation" data-region="ConversationView">
          <div className="empty-hero">
            {initialized ? <span className="empty-deepseek-icon" style={{ WebkitMaskImage: `url(${deepseekIconUrl})`, maskImage: `url(${deepseekIconUrl})` }} aria-label="DeepSeek" /> : <div>{copy.loading}</div>}
          </div>
        </section>
      ) : (
        <ConversationView key={activeSessionId} sessionId={activeSessionId} />
      )}
      {(cwd !== '' || workspaces.length > 0) && <ComposerCard />}
    </main>
  )
}
