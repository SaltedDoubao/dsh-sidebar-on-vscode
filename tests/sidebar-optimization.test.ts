import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { WorkspaceId } from '../src/extension/protocol/brand'
import { translate } from '../src/webview/i18n'

;(globalThis as { __DSH_MOCK__?: boolean }).__DSH_MOCK__ = true

test('webview translations preserve English and localize Chinese with interpolation', () => {
  assert.equal(translate('en', 'Chat'), 'Chat')
  assert.equal(translate('zh', 'Chat'), '对话')
  assert.equal(translate('zh', 'Show {count} more sessions', { count: 3 }), '展开其余 3 个会话')
  assert.equal(translate('en', 'Show {count} more sessions', { count: 3 }), 'Show 3 more sessions')
})

test('manifest and native localization catalogs have complete matching keys', async () => {
  const [manifestText, packageEnText, packageZhText, runtimeEnText, runtimeZhText] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('package.nls.json', 'utf8'),
    readFile('package.nls.zh-cn.json', 'utf8'),
    readFile('l10n/bundle.l10n.json', 'utf8'),
    readFile('l10n/bundle.l10n.zh-cn.json', 'utf8'),
  ])
  const manifest = JSON.parse(manifestText) as unknown
  const packageEn = JSON.parse(packageEnText) as Record<string, string>
  const packageZh = JSON.parse(packageZhText) as Record<string, string>
  const runtimeEn = JSON.parse(runtimeEnText) as Record<string, string>
  const runtimeZh = JSON.parse(runtimeZhText) as Record<string, string>

  assert.deepEqual(Object.keys(packageZh).sort(), Object.keys(packageEn).sort())
  assert.deepEqual(Object.keys(runtimeZh).sort(), Object.keys(runtimeEn).sort())
  assert.equal((manifest as { l10n?: string }).l10n, './l10n')
  for (const key of manifestText.matchAll(/%([^%]+)%/g)) {
    assert.ok(key[1] !== undefined && key[1] in packageEn, `missing package.nls key: ${String(key[1])}`)
  }
})

test('composer source keeps add immediately before permission and fixed send after optional extras', async () => {
  const [source, css] = await Promise.all([
    readFile('src/webview/components/composer/ComposerCard.tsx', 'utf8'),
    readFile('src/webview/components/composer/composer.css', 'utf8'),
  ])
  const toolbar = source.slice(source.indexOf('<div className="composer-toolbar">'))
  assert.ok(toolbar.indexOf('data-composer-tool="attach"') < toolbar.indexOf('<PermissionSelect'))
  assert.ok(toolbar.indexOf('<PermissionSelect') < toolbar.indexOf('composer-trailing-extras'))
  assert.ok(toolbar.indexOf('composer-trailing-extras') < toolbar.indexOf('<SendStopButton'))
  assert.match(css, /@media \(max-width: 460px\)[\s\S]*permission-trigger \.composer-chip-label/)
  assert.match(css, /@media \(max-width: 240px\)[\s\S]*data-composer-tool='attach'/)
})

test('top-level new chat creates or reuses the selected IDE-root workspace before the session', async () => {
  const [{ useAppStore }, { mockSessionRpcLog }] = await Promise.all([
    import('../src/webview/store'),
    import('../src/webview/mock/bridge'),
  ])
  mockSessionRpcLog.length = 0
  useAppStore.setState({
    cwd: '/mock/workspace',
    activeSessionId: null,
    sessions: [],
    workspaces: [],
    capabilities: { ...useAppStore.getState().capabilities, workspace: true } as NonNullable<ReturnType<typeof useAppStore.getState>['capabilities']>,
  })

  await useAppStore.getState().newChat()
  assert.deepEqual(mockSessionRpcLog.map((call) => call.method), ['workspace.create', 'session.create'])
  assert.equal(mockSessionRpcLog[0]?.params['path'], '/mock/workspace')
  assert.equal(typeof mockSessionRpcLog[1]?.params['workspaceId'], 'string')

  const createdSessionId = useAppStore.getState().activeSessionId
  const workspace = useAppStore.getState().workspaces.find((item) => item.sessionIds.includes(createdSessionId!))
  assert.ok(workspace)

  mockSessionRpcLog.length = 0
  await useAppStore.getState().newChat()
  assert.deepEqual(mockSessionRpcLog.map((call) => call.method), ['workspace.create'])

  mockSessionRpcLog.length = 0
  await useAppStore.getState().newChat(workspace!.workspaceId as WorkspaceId)
  assert.deepEqual(mockSessionRpcLog, [])
})
