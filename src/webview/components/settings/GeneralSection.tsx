/**
 * GeneralSection (W6): language, appearance, busy-Enter behavior and the
 * default permission mode for new sessions. Each preference persists through a
 * writable settings namespace when the host exposes one (locale / ui-theme /
 * ui-conversation / permission), else a localStorage fallback — see the
 * settings slice's uiPrefSources.
 */

import { useState, type JSX } from 'react'
import { useAppStore } from '../../store'
import type { UiPrefs } from '../../store/settings'

interface OptionRowProps<K extends keyof UiPrefs> {
  label: string
  description?: string
  prefKey: K
  options: Array<{ value: UiPrefs[K]; label: string }>
}

/** One preference row: label + segmented options, writing on selection. */
function OptionRow<K extends keyof UiPrefs>({ label, description, prefKey, options }: OptionRowProps<K>): JSX.Element {
  const value = useAppStore((s) => s.uiPrefs[prefKey])
  const source = useAppStore((s) => s.uiPrefSources[prefKey])
  const setUiPref = useAppStore((s) => s.setUiPref)
  const language = useAppStore((s) => s.uiPrefs.language)
  const [failure, setFailure] = useState<string | null>(null)

  const select = (next: UiPrefs[K]): void => {
    if (next === value) return
    setFailure(null)
    void setUiPref(prefKey, next).catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <div className="settings-field" data-pref={prefKey} data-source={source}>
      <div className="settings-field-label">{label}</div>
      {description !== undefined && <div className="settings-field-desc">{description}</div>}
      <div className="settings-segment" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`settings-segment-item${option.value === value ? ' settings-segment-item-active' : ''}`}
            aria-pressed={option.value === value}
            onClick={() => { select(option.value) }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {failure !== null && <p className="settings-error">{`${language === 'zh' ? '保存失败' : 'Save failed'}: ${failure}`}</p>}
    </div>
  )
}

export function GeneralSection(): JSX.Element {
  const language = useAppStore((state) => state.uiPrefs.language)
  const presets = useAppStore((state) => state.presets)
  const defaultPresetId = useAppStore((state) => state.defaultPresetId)
  const selectDefaultPreset = useAppStore((state) => state.selectDefaultPreset)
  const settingsWritable = useAppStore((state) => state.settingsWritable)
  const ideContextEphemeralEnabled = useAppStore((state) => state.ideContextEphemeralEnabled)
  const setIdeContextEphemeralEnabled = useAppStore((state) => state.setIdeContextEphemeralEnabled)
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetFailure, setPresetFailure] = useState<string | null>(null)
  const zh = language === 'zh'

  const selectPreset = (id: string): void => {
    if (id === defaultPresetId || presetBusy) return
    setPresetBusy(true)
    setPresetFailure(null)
    void selectDefaultPreset(id)
      .catch((error: unknown) => setPresetFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => setPresetBusy(false))
  }

  return (
    <div className="settings-section" data-region="GeneralSection">
      <h2 className="settings-section-title">{zh ? '通用设置' : 'General'}</h2>
      <p className="settings-section-intro">{zh ? '管理新会话的默认行为和界面偏好。' : 'Manage defaults for new sessions and interface preferences.'}</p>
      <div className="settings-field">
        <div className="settings-field-label">{zh ? 'Agent 预设' : 'Agent preset'}</div>
        <div className="settings-field-desc">{zh ? '对之后新建的会话生效，运行中的会话保持原预设。' : 'Applies to new sessions; running sessions keep their current preset.'}</div>
        <select
          className="settings-input"
          value={defaultPresetId}
          disabled={presetBusy || !settingsWritable || presets.length === 0}
          aria-label={zh ? 'Agent 预设' : 'Agent preset'}
          onChange={(event) => selectPreset(event.target.value)}
        >
          {presets.map((preset) => <option key={preset.id} value={preset.id} disabled={preset.broken !== undefined}>{preset.name ?? preset.id}</option>)}
        </select>
        {presetFailure !== null && <p className="settings-error">{presetFailure}</p>}
      </div>
      <OptionRow
        label={zh ? '权限' : 'Permission'}
        description={zh ? '选择新会话的默认权限模式。' : 'Default permission mode for new sessions.'}
        prefKey="permissionMode"
        options={[
          { value: 'read-only', label: 'Read Only' },
          { value: 'workspace-write', label: 'Workspace Write' },
          { value: 'full-access', label: 'Full Access' },
        ]}
      />
      <OptionRow
        label={zh ? '语言' : 'Language'}
        description={zh
          ? '此设置用于 DSH WebUI；Sidebar 界面语言跟随 IDE。'
          : 'This setting controls the DSH WebUI language; the Sidebar language follows the IDE.'}
        prefKey="language"
        options={[
          { value: 'zh', label: '中文' },
          { value: 'en', label: 'English' },
        ]}
      />
      <div className="settings-field" data-pref="ideContextEphemeral">
        <div className="settings-field-label">{zh ? '瞬时 IDE 上下文（实验性）' : 'Ephemeral IDE context (Experimental)'}</div>
        <div className="settings-field-desc">
          {zh
            ? '启用 IDE Bridge 和每轮替换的上下文注入。需要 DSH IDE Context Runtime 插件；插件不可用时静默使用兼容注入。'
            : 'Enables the IDE Bridge and per-turn context replacement. Requires the DSH IDE Context Runtime plugin; silently falls back to compatible injection when unavailable.'}
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={ideContextEphemeralEnabled}
            onChange={(event) => setIdeContextEphemeralEnabled(event.target.checked)}
          />
          <span>{ideContextEphemeralEnabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')}</span>
        </label>
      </div>
      <OptionRow
        label={zh ? '外观' : 'Appearance'}
        prefKey="appearance"
        options={[
          { value: 'vscode', label: zh ? '跟随 VS Code' : 'VS Code' },
          { value: 'light', label: zh ? '浅色' : 'Light' },
          { value: 'dark', label: zh ? '深色' : 'Dark' },
        ]}
      />
      <OptionRow
        label={zh ? '繁忙时 Enter 键行为' : 'Enter while busy'}
        description={zh ? '仅在智能体运行时生效。' : 'Only applies while the agent is running.'}
        prefKey="busyEnter"
        options={[
          { value: 'queue', label: zh ? '排队发送' : 'Queue' },
          { value: 'steer', label: zh ? '立即插话' : 'Steer' },
        ]}
      />
    </div>
  )
}
