/**
 * ProviderEditorCard (W6): one provider's inline editor — a write-only API key
 * field (credentials.set under the conventional `<ROUTE>_API_KEY` ref) and a
 * baseURL field (settings.mutate path op against the provider profile). Saving
 * announces through the parent (`onClose(true)`).
 */

import { useState, type JSX } from 'react'
import { useAppStore } from '../../store'
import { rpc } from '../../bridge'
import type { DiscoveredModelView } from '../../../extension/protocol/settings'
import { deriveKeyRef, type ProviderTarget } from '../../store/settings'

export interface ProviderEditorCardProps {
  target: ProviderTarget
  /** Close the editor; `changed` reports whether a save committed. */
  onClose: (changed: boolean) => void
}

/** Read the value at a path inside a plain object (redacted namespace value). */
function valueAt(source: unknown, path: string[]): unknown {
  let node = source
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

export function ProviderEditorCard({ target, onClose }: ProviderEditorCardProps): JSX.Element {
  const namespace = useAppStore((s) => s.namespaces.find((n) => n.ns === target.settingsNs))
  const language = useAppStore((s) => s.uiPrefs.language)
  const credential = useAppStore((s) => s.credentials[target.credentialRef ?? deriveKeyRef(target.provider)])
  const mutateSettings = useAppStore((s) => s.mutateSettings)
  const setCredential = useAppStore((s) => s.setCredential)

  const keyRef = target.credentialRef ?? deriveKeyRef(target.provider)
  const currentBaseURL = (() => {
    const value = valueAt(namespace?.value, target.settingsPath)
    const baseURL = typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)['baseURL']
      : undefined
    return typeof baseURL === 'string' ? baseURL : ''
  })()

  const [keyDraft, setKeyDraft] = useState('')
  const [baseURLDraft, setBaseURLDraft] = useState(currentBaseURL)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredModelView[] | null>(null)
  const zh = language === 'zh'

  const keyValue = keyDraft.trim()
  const baseURLChanged = baseURLDraft.trim() !== currentBaseURL
  const dirty = keyValue.length > 0 || baseURLChanged

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      if (baseURLChanged) {
        const path = [...target.settingsPath, 'baseURL']
        const next = baseURLDraft.trim()
        await mutateSettings(
          target.settingsNs,
          [next.length > 0 ? { op: 'set', path, value: next } : { op: 'unset', path }],
          namespace?.revision,
        )
      }
      if (keyValue.length > 0) await setCredential(keyRef, keyValue)
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const discover = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const result = await rpc<{ models: DiscoveredModelView[] }>('llm.discoverModels', {
        settingsNs: target.settingsNs,
        provider: target.provider,
        ...(baseURLDraft.trim() === '' ? {} : { baseURL: baseURLDraft.trim() }),
        ...(keyValue === '' ? {} : { apiKey: keyValue }),
      })
      setDiscovered(result.models)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-editor" data-region="ProviderEditorCard">
      <div className="settings-field">
        <div className="settings-field-label">{zh ? 'API 密钥' : 'API key'}</div>
        <input
          className="settings-input"
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={credential?.configured === true ? (zh ? '已配置（输入以更换）' : 'Configured (enter to replace)') : (zh ? '输入 API 密钥' : 'Enter API key')}
          aria-label={zh ? 'API 密钥' : 'API key'}
          disabled={busy}
          onChange={(e) => { setKeyDraft(e.target.value) }}
        />
      </div>
      <div className="settings-field">
        <div className="settings-field-label">Base URL</div>
        <input
          className="settings-input"
          type="text"
          value={baseURLDraft}
          placeholder="https://api.deepseek.com"
          aria-label="Base URL"
          disabled={busy}
          onChange={(e) => { setBaseURLDraft(e.target.value) }}
        />
      </div>
      {failure !== null && <p className="settings-error">{`${zh ? '保存失败' : 'Save failed'}: ${failure}`}</p>}
      {discovered !== null && (
        <p className="settings-plugin-desc">
          {discovered.length === 0 ? (zh ? '端点未返回模型。' : 'The endpoint returned no models.') : `${zh ? '发现' : 'Found'} ${discovered.length} ${zh ? '个模型' : 'models'}: ${discovered.slice(0, 8).map((model) => model.name ?? model.id).join(zh ? '、' : ', ')}`}
        </p>
      )}
      <div className="settings-editor-actions">
        <button type="button" className="settings-btn" disabled={busy} onClick={() => { void discover() }}>
          {zh ? '发现模型' : 'Discover models'}
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={() => { onClose(false) }}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-primary"
          disabled={busy || !dirty}
          onClick={() => { void save() }}
        >
          {busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}
        </button>
      </div>
    </div>
  )
}
