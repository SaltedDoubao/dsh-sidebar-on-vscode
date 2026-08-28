import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { UI_REQUESTS } from '../src/shared/ui-requests'

test('settings.openDocument is explicitly allowed and legacy modal traces are absent', async () => {
  assert.equal(UI_REQUESTS.includes('settings.openDocument'), true)
  const [app, store, css] = await Promise.all([
    readFile('src/webview/App.tsx', 'utf8'),
    readFile('src/webview/store/settings.ts', 'utf8'),
    readFile('src/webview/components/settings/settings.css', 'utf8'),
  ])
  for (const legacy of ['SettingsPanel', 'settingsOpen', 'settings-overlay', 'settings-dialog', 'settings-mask']) {
    assert.equal(`${app}\n${store}\n${css}`.includes(legacy), false, `legacy settings modal trace remains: ${legacy}`)
  }
})
