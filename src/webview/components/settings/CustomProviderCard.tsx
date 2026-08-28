/**
 * CustomProviderCard (W6): the 添加自定义提供方 card — declares an
 * OpenAI-compatible route in the `llm-pi-ai` settings namespace (settings.mutate
 * set at [routeId]) plus an optional initial API key (credentials.set).
 */

import { useState, type JSX } from 'react'
import { useAppStore } from '../../store'
import { deriveKeyRef } from '../../store/settings'

export interface CustomProviderCardProps {
  /** Route ids already taken (validation). */
  taken: string[]
  /** Close the card; `changed` reports whether a declaration committed. */
  onClose: (changed: boolean) => void
}

const PROTOCOLS = ['openai', 'anthropic'] as const

export function CustomProviderCard({ taken, onClose }: CustomProviderCardProps): JSX.Element {
  const namespace = useAppStore((s) => s.namespaces.find((n) => n.ns === 'llm-pi-ai'))
  const language = useAppStore((s) => s.uiPrefs.language)
  const mutateSettings = useAppStore((s) => s.mutateSettings)
  const setCredential = useAppStore((s) => s.setCredential)

  const [id, setId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [api, setApi] = useState<string>(PROTOCOLS[0])
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const zh = language === 'zh'

  const routeId = id.trim()
  const idFailure = routeId.length === 0
    ? null
    : !/^[a-z0-9][a-z0-9-]*$/.test(routeId)
      ? (zh ? '标识只能包含小写字母、数字与连字符' : 'Use lowercase letters, numbers, and hyphens only')
      : taken.includes(routeId)
        ? (zh ? '该标识已被占用' : 'This ID is already in use')
        : null
  const canSubmit = routeId.length > 0 && idFailure === null && baseURL.trim().length > 0 && !busy

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const profile: Record<string, unknown> = {
        displayName: displayName.trim().length > 0 ? displayName.trim() : routeId,
        baseURL: baseURL.trim(),
        api,
      }
      const keyValue = keyDraft.trim()
      if (keyValue.length > 0) {
        const ref = deriveKeyRef(routeId)
        profile['apiKeyEnv'] = ref
        await setCredential(ref, keyValue)
      }
      await mutateSettings('llm-pi-ai', [{ op: 'set', path: [routeId], value: profile }], namespace?.revision)
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-editor" data-region="CustomProviderCard">
      <div className="settings-field">
        <div className="settings-field-label">{zh ? '提供方标识' : 'Provider ID'}</div>
        <input
          className="settings-input"
          type="text"
          value={id}
          placeholder={zh ? '例如 my-lab' : 'e.g. my-lab'}
          aria-label={zh ? '提供方标识' : 'Provider ID'}
          disabled={busy}
          onChange={(e) => { setId(e.target.value) }}
        />
        {idFailure !== null && <p className="settings-error">{idFailure}</p>}
      </div>
      <div className="settings-field">
        <div className="settings-field-label">{zh ? '显示名称' : 'Display name'}</div>
        <input
          className="settings-input"
          type="text"
          value={displayName}
          placeholder={routeId || (zh ? '同标识' : 'Same as ID')}
          aria-label={zh ? '显示名称' : 'Display name'}
          disabled={busy}
          onChange={(e) => { setDisplayName(e.target.value) }}
        />
      </div>
      <div className="settings-field">
        <div className="settings-field-label">Base URL</div>
        <input
          className="settings-input"
          type="text"
          value={baseURL}
          placeholder="https://example.com/v1"
          aria-label="Base URL"
          disabled={busy}
          onChange={(e) => { setBaseURL(e.target.value) }}
        />
      </div>
      <div className="settings-field">
        <div className="settings-field-label">{zh ? '协议' : 'Protocol'}</div>
        <select
          className="settings-input"
          value={api}
          aria-label={zh ? '协议' : 'Protocol'}
          disabled={busy}
          onChange={(e) => { setApi(e.target.value) }}
        >
          {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="settings-field">
        <div className="settings-field-label">{zh ? 'API 密钥（可选）' : 'API key (optional)'}</div>
        <input
          className="settings-input"
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={zh ? '可稍后再填' : 'Can be added later'}
          aria-label={zh ? 'API 密钥' : 'API key'}
          disabled={busy}
          onChange={(e) => { setKeyDraft(e.target.value) }}
        />
      </div>
      {failure !== null && <p className="settings-error">{`${zh ? '保存失败' : 'Save failed'}: ${failure}`}</p>}
      <div className="settings-editor-actions">
        <button type="button" className="settings-btn" disabled={busy} onClick={() => { onClose(false) }}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-primary"
          disabled={!canSubmit}
          onClick={() => { void save() }}
        >
          {busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '添加' : 'Add')}
        </button>
      </div>
    </div>
  )
}
