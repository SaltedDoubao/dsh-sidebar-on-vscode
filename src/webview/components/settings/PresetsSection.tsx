/**
 * PresetsSection (W6): the agent preset roster (agentPreset.list) with the
 * default-for-new-sessions selection (settings.update ns `agent-presets`,
 * field `default`). Broken presets render disabled with their reason.
 */

import { useState, type JSX } from 'react'
import { useAppStore } from '../../store'

export function PresetsSection(): JSX.Element {
  const presets = useAppStore((s) => s.presets)
  const language = useAppStore((s) => s.uiPrefs.language)
  const defaultPresetId = useAppStore((s) => s.defaultPresetId)
  const settingsWritable = useAppStore((s) => s.settingsWritable)
  const selectDefaultPreset = useAppStore((s) => s.selectDefaultPreset)
  const presetAuthorable = useAppStore((s) => s.presetAuthorable)
  const presetHasDocument = useAppStore((s) => s.presetHasDocument)
  const readPreset = useAppStore((s) => s.readPreset)
  const copyPreset = useAppStore((s) => s.copyPreset)
  const openPreset = useAppStore((s) => s.openPreset)
  const removePreset = useAppStore((s) => s.removePreset)

  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ id: string; content: string } | null>(null)
  const zh = language === 'zh'

  const select = (id: string): void => {
    if (saving || id === defaultPresetId || !settingsWritable) return
    setSaving(true)
    setFailure(null)
    void selectDefaultPreset(id)
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setSaving(false) })
  }

  const run = (work: () => Promise<void>): void => {
    setSaving(true)
    setFailure(null)
    void work().catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false))
  }

  return (
    <div className="settings-section" data-region="PresetsSection">
      <h2 className="settings-section-title">{zh ? 'Agent 预设' : 'Agent Presets'}</h2>
      <p className="settings-section-intro">{zh ? '预设是一个会话的 Agent 所运行的插件继承集合，包括工具、提示词与能力。' : 'A preset defines the plugins, tools, prompts, and capabilities available to an agent.'}</p>
      {failure !== null && <p className="settings-error">{`${zh ? '操作失败' : 'Action failed'}: ${failure}`}</p>}
      {presets.length === 0 ? (
        <p className="settings-empty">{zh ? '当前部署没有可用的预设。' : 'No presets are available.'}</p>
      ) : (
        <ul className="settings-preset-list" role="radiogroup" aria-label={zh ? '默认预设' : 'Default preset'}>
          {presets.map((preset) => {
            const selected = preset.id === defaultPresetId
            const broken = preset.broken !== undefined
            return (
              <li key={preset.id} className="settings-preset-card">
                <button
                  type="button"
                  className={`settings-preset-row${selected ? ' settings-preset-row-active' : ''}`}
                  role="radio"
                  aria-checked={selected}
                  disabled={broken || saving || !settingsWritable}
                  title={preset.broken}
                  onClick={() => { select(preset.id) }}
                >
                  <span className={`settings-radio${selected ? ' settings-radio-on' : ''}`} aria-hidden="true" />
                  <span className="settings-preset-identity">
                    <span className="settings-preset-name">
                      {preset.name ?? preset.id}
                      {preset.name !== undefined && preset.name !== preset.id && (
                        <span className="settings-preset-id">{` ${preset.id}`}</span>
                      )}
                    </span>
                    {preset.description !== undefined && (
                      <span className="settings-preset-desc">{preset.description}</span>
                    )}
                    {broken && <span className="settings-error">{`不可用：${preset.broken ?? ''}`}</span>}
                  </span>
                  <span className="settings-provider-identity">
                    {selected && <span className="settings-tag settings-current-tag">{zh ? '当前使用' : 'Current'}</span>}
                    <span className={`settings-tag${preset.trust === 'user' ? ' settings-tag-user' : ''}`}>
                      {preset.trust === 'user' ? (zh ? '本地' : 'Local') : (zh ? '内置' : 'Built-in')}
                    </span>
                  </span>
                </button>
                <div className="settings-editor-actions">
                  <button type="button" className="settings-btn" disabled={saving} onClick={() => run(async () => {
                    const result = await readPreset(preset.id)
                    setViewer({ id: preset.id, content: result.content })
                  })}>{zh ? '查看' : 'View'}</button>
                  {presetAuthorable && (
                    <button type="button" className="settings-btn" disabled={saving} onClick={() => {
                      const id = window.prompt(zh ? '新预设标识' : 'New preset ID')?.trim()
                      if (id !== undefined && id !== '') run(() => copyPreset(preset.id, id))
                    }}>{zh ? '复制' : 'Copy'}</button>
                  )}
                  {preset.trust === 'user' && (
                    <button type="button" className="settings-btn" disabled={saving} onClick={() => run(async () => {
                      const fallback = await openPreset(preset.id)
                      if (fallback !== null) window.alert(`${zh ? '预设目录' : 'Preset directory'}: ${fallback}`)
                    })}>{presetHasDocument ? (zh ? '打开目录' : 'Open directory') : (zh ? '显示目录' : 'Show directory')}</button>
                  )}
                  {preset.trust === 'user' && (
                    <button type="button" className="settings-btn settings-btn-danger" disabled={saving} onClick={() => {
                      if (window.confirm(zh ? `删除本地预设「${preset.name ?? preset.id}」？` : `Delete local preset “${preset.name ?? preset.id}”?`)) run(() => removePreset(preset.id))
                    }}>{zh ? '删除' : 'Delete'}</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {presetAuthorable && presets[0] !== undefined && (
        <button type="button" className="settings-create-preset" disabled={saving} onClick={() => {
          const source = presets.find((preset) => preset.id === defaultPresetId) ?? presets[0]
          const id = window.prompt(zh ? '新预设标识' : 'New preset ID')?.trim()
          if (source !== undefined && id !== undefined && id !== '') run(() => copyPreset(source.id, id, zh ? '自定义预设' : 'Custom preset'))
        }}>＋ {zh ? '用「当前预设」创建自定义预设' : 'Create a custom preset from the current preset'}</button>
      )}
      {viewer !== null && (
        <div className="settings-editor">
          <div className="settings-plugin-head">
            <strong>{viewer.id}</strong>
            <button type="button" className="settings-btn" onClick={() => setViewer(null)}>{zh ? '关闭' : 'Close'}</button>
          </div>
          <pre className="settings-preset-source">{viewer.content}</pre>
        </div>
      )}
    </div>
  )
}
