const assert = require('node:assert/strict')
const vscode = require('vscode')

const EXPECTED_COMMANDS = [
  'deepseekHarness.newChat',
  'deepseekHarness.openSettings',
  'deepseekHarness.openFullPanel',
  'deepseekHarness.insertSelection',
  'deepseekHarness.insertActiveFile',
  'deepseekHarness.exportSession',
  'deepseekHarness.stopHost',
  'deepseekHarness.restartHost',
  'deepseekHarness.showLogs',
]

async function run() {
  const extension = vscode.extensions.getExtension('local.deepseek-harness-vscode')
  assert.ok(extension, 'extension local.deepseek-harness-vscode must be installed in the test host')
  await extension.activate()
  assert.equal(extension.isActive, true)

  const folders = vscode.workspace.workspaceFolders ?? []
  assert.equal(folders.length, 2, 'multi-root fixture should open both roots')

  const commands = new Set(await vscode.commands.getCommands(true))
  for (const command of EXPECTED_COMMANDS) assert.ok(commands.has(command), `missing command: ${command}`)

  const contributedView = extension.packageJSON.contributes.views.deepseekHarness
    .some((view) => view.id === 'deepseekHarness.sidebar' && view.type === 'webview')
  assert.equal(contributedView, true, 'sidebar webview contribution must be registered')

  const config = vscode.workspace.getConfiguration('deepseekHarness')
  assert.equal(config.get('host.basePort'), 3080)
  assert.deepEqual(config.get('host.arguments'), [])
  assert.equal(config.get('ideContext.enabled'), false)
  assert.equal(config.get('notifications.onCompletion'), false)

  await vscode.commands.executeCommand('deepseekHarness.openSettings')
  await new Promise((resolve) => setTimeout(resolve, 250))
  const countSettingsTabs = () => vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === 'DeepSeek Harness 设置').length
  assert.equal(countSettingsTabs(), 1, 'settings command should open one editor tab')
  await vscode.commands.executeCommand('deepseekHarness.openSettings')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(countSettingsTabs(), 1, 'settings command should reuse its singleton editor tab')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await new Promise((resolve) => setTimeout(resolve, 100))
  await vscode.commands.executeCommand('deepseekHarness.openSettings')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(countSettingsTabs(), 1, 'settings tab should be recreatable after close')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

  await vscode.commands.executeCommand('deepseekHarness.showLogs')
}

module.exports = { run }
