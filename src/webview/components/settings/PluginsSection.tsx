import { useMemo, useState, type JSX } from 'react'
import type { SettingsNamespaceView } from '../../../extension/protocol/settings'
import { useAppStore } from '../../store'

const NON_PLUGIN_NS = /^(llm-|ui-theme$|locale$|ui-conversation$|permission$|agent-presets$|ui-onboarding$)/
const KNOWN = [
  { test: /(?:^|[-/])bash(?:$|[-/])/i, title: 'Bash', description: '终端执行、审批与后台任务。' },
  { test: /agent[-_/ ]?loop/i, title: 'Agent Loop', description: 'Agent 步数、上下文与重试策略。' },
  { test: /web[-_/ ]?search/i, title: 'Web Search', description: '网页搜索工具与提供方设置。' },
] as const

function isPluginNamespace(ns: SettingsNamespaceView): boolean {
  if (NON_PLUGIN_NS.test(ns.ns)) return false
  const hasSchema = typeof ns.schema === 'object' && ns.schema !== null && Object.keys(ns.schema).length > 0
  return hasSchema || ns.applies === 'restart'
}

function descriptionOf(ns: SettingsNamespaceView | undefined): string | null {
  if (ns === undefined) return null
  const meta = (ns.schema as { meta?: { description?: unknown } } | null)?.meta
  return typeof meta?.description === 'string' && meta.description.length > 0 ? meta.description : null
}

export function PluginsSection(): JSX.Element {
  const namespaces = useAppStore((s) => s.namespaces)
  const inventory = useAppStore((s) => s.pluginInventory)
  const capabilities = useAppStore((s) => s.capabilities)
  const [query, setQuery] = useState('')
  const plugins = namespaces.filter(isPluginNamespace)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle === '' ? inventory : inventory.filter((row) => `${row.moduleName} ${row.entryId}`.toLowerCase().includes(needle))
  }, [inventory, query])

  const known = KNOWN.map((card) => ({
    ...card,
    inventory: inventory.find((entry) => card.test.test(entry.moduleName)),
    namespace: plugins.find((entry) => card.test.test(entry.ns)),
  }))

  return (
    <div className="settings-section" data-region="PluginsSection">
      <h2 className="settings-section-title">插件</h2>
      <p className="settings-section-intro">已知插件显示其设置与运行状态；完整 Loader 清单保持只读。</p>
      {known.map((card) => (
        <article key={card.title} className="settings-plugin-card">
          <div className="settings-plugin-head">
            <span className="settings-plugin-name">{card.title}</span>
            <span className={`settings-tag${card.inventory?.fiberPhase === 'failed' ? ' settings-tag-user' : ''}`}>
              {card.inventory === undefined ? '未安装' : card.inventory.enabled ? (card.inventory.fiberPhase ?? '已启用') : '已停用'}
            </span>
          </div>
          <p className="settings-plugin-desc">{descriptionOf(card.namespace) ?? card.description}</p>
          {card.namespace?.applies === 'restart' && <span className="settings-tag">重启生效</span>}
        </article>
      ))}

      <h3 className="settings-subtitle">完整清单</h3>
      {capabilities?.plugins === false ? (
        <p className="settings-notice">当前 Host 未提供 pluginInventory/list；已隐藏插件运行清单。</p>
      ) : (
        <>
          <input
            className="settings-input"
            type="search"
            value={query}
            placeholder="搜索插件…"
            aria-label="搜索插件"
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="settings-plugin-list">
            {visible.map((entry) => (
              <li key={entry.entryId} className="settings-plugin-card">
                <div className="settings-plugin-head">
                  <span className="settings-plugin-name">{entry.moduleName}</span>
                  <span className="settings-tag">{entry.enabled ? (entry.fiberPhase ?? 'enabled') : 'disabled'}</span>
                </div>
                <p className="settings-plugin-desc">{entry.entryId}</p>
              </li>
            ))}
            {visible.length === 0 && <li className="settings-empty">没有匹配的插件。</li>}
          </ul>
        </>
      )}
    </div>
  )
}
