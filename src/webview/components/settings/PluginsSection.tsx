import { useMemo, useState, type JSX } from 'react'
import type { SettingsNamespaceView } from '../../../extension/protocol/settings'
import { useAppStore } from '../../store'

const NON_PLUGIN_NS = /^(llm-|ui-theme$|locale$|ui-conversation$|permission$|agent-presets$|ui-onboarding$)/
const KNOWN = [
  { id: 'bash', test: /(?:^|[-/])bash(?:$|[-/])/i, zh: '终端', en: 'Terminal', zhDesc: '限制 Agent 运行的每一条命令。', enDesc: 'Controls commands run by the agent.' },
  { id: 'agent-loop', test: /agent[-_/ ]?loop/i, zh: 'Agent 循环', en: 'Agent Loop', zhDesc: '配置 Agent 如何感知工具调用。', enDesc: 'Configures how the agent processes tool calls.' },
  { id: 'web-search', test: /web[-_/ ]?search/i, zh: '网页搜索', en: 'Web Search', zhDesc: 'DeepSeek 搜索提供方能力。', enDesc: 'DeepSeek web-search provider capabilities.' },
] as const

function isPluginNamespace(ns: SettingsNamespaceView): boolean {
  if (NON_PLUGIN_NS.test(ns.ns)) return false
  const hasSchema = typeof ns.schema === 'object' && ns.schema !== null && Object.keys(ns.schema).length > 0
  return hasSchema || ns.applies === 'restart'
}

function descriptionOf(ns: SettingsNamespaceView | undefined): string | null {
  const meta = (ns?.schema as { meta?: { description?: unknown } } | null)?.meta
  return typeof meta?.description === 'string' && meta.description.length > 0 ? meta.description : null
}

export function PluginsSection(): JSX.Element {
  const namespaces = useAppStore((state) => state.namespaces)
  const inventory = useAppStore((state) => state.pluginInventory)
  const capabilities = useAppStore((state) => state.capabilities)
  const language = useAppStore((state) => state.uiPrefs.language)
  const [tab, setTab] = useState<'configuration' | 'inventory'>('configuration')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const zh = language === 'zh'
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

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="settings-section" data-region="PluginsSection">
      <h2 className="settings-section-title">{zh ? '插件' : 'Plugins'}</h2>
      <p className="settings-section-intro">{zh ? '配置插件并查看本机已经安装的插件。' : 'Configure plugins and inspect the installed inventory.'}</p>
      <div className="settings-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'configuration'} className={tab === 'configuration' ? 'settings-tab-active' : ''} onClick={() => setTab('configuration')}>{zh ? '插件配置' : 'Configuration'}</button>
        <button type="button" role="tab" aria-selected={tab === 'inventory'} className={tab === 'inventory' ? 'settings-tab-active' : ''} onClick={() => setTab('inventory')}>{zh ? '插件列表' : 'Inventory'}</button>
      </div>

      {tab === 'configuration' ? (
        <div className="settings-plugin-config" role="tabpanel">
          {known.map((card) => {
            const open = expanded.has(card.id)
            const state = card.inventory === undefined
              ? (zh ? '未安装' : 'Not installed')
              : card.inventory.enabled ? (card.inventory.fiberPhase ?? (zh ? '已启用' : 'Enabled')) : (zh ? '已停用' : 'Disabled')
            return (
              <article key={card.id} className="settings-plugin-card">
                <button type="button" className="settings-plugin-toggle" aria-expanded={open} onClick={() => toggle(card.id)}>
                  <span>
                    <strong className="settings-plugin-name">{zh ? card.zh : card.en}</strong>
                    <span className="settings-plugin-desc">{descriptionOf(card.namespace) ?? (zh ? card.zhDesc : card.enDesc)}</span>
                  </span>
                  <span className="settings-provider-identity">
                    <span className={`settings-tag${card.inventory?.fiberPhase === 'failed' ? ' settings-tag-user' : ''}`}>{state}</span>
                    <span className={`settings-chevron${open ? ' settings-chevron-open' : ''}`} aria-hidden="true">⌄</span>
                  </span>
                </button>
                {open && (
                  <div className="settings-plugin-details">
                    <span>{card.namespace === undefined ? (zh ? '当前 Host 未公开此插件的可编辑设置。' : 'This Host does not expose editable settings for this plugin.') : `${zh ? '设置命名空间' : 'Settings namespace'}: ${card.namespace.ns}`}</span>
                    {card.namespace?.applies === 'restart' && <span className="settings-tag">{zh ? '重启生效' : 'Restart required'}</span>}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div role="tabpanel">
          {capabilities?.plugins === false ? (
            <p className="settings-notice">{zh ? '当前 Host 未提供插件运行清单。' : 'The current Host does not provide a plugin inventory.'}</p>
          ) : (
            <>
              <input className="settings-input" type="search" value={query} placeholder={zh ? '搜索插件…' : 'Search plugins…'} aria-label={zh ? '搜索插件' : 'Search plugins'} onChange={(event) => setQuery(event.target.value)} />
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
                {visible.length === 0 && <li className="settings-empty">{zh ? '没有匹配的插件。' : 'No matching plugins.'}</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
