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

test('language setting explains WebUI and Sidebar locale ownership', async () => {
  const source = await readFile('src/webview/components/settings/GeneralSection.tsx', 'utf8')
  assert.match(source, /此设置用于 DSH WebUI；Sidebar 界面语言跟随 IDE。/)
  assert.match(source, /This setting controls the DSH WebUI language; the Sidebar language follows the IDE\./)
})

test('experimental ephemeral IDE context is opt-in and documented in both languages', async () => {
  const [manifest, source] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src/webview/components/settings/GeneralSection.tsx', 'utf8'),
  ])
  const parsed = JSON.parse(manifest) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } }
  assert.equal(parsed.contributes.configuration.properties['deepseekHarness.ideContext.ephemeral.enabled']?.default, false)
  assert.match(source, /瞬时 IDE 上下文（实验性）/)
  assert.match(source, /Ephemeral IDE context \(Experimental\)/)
  assert.match(source, /静默使用兼容注入/)
  assert.match(source, /silently falls back to compatible injection/)
})
