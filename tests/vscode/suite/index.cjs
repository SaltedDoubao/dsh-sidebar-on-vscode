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
  assert.equal(config.get('ideContext.enabled'), false)
  assert.equal(config.get('notifications.onCompletion'), false)

  await vscode.commands.executeCommand('deepseekHarness.showLogs')
}

module.exports = { run }
