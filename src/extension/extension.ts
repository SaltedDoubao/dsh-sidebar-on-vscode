import * as vscode from 'vscode'
import { Bridge } from './bridge'
import { DshAdapter } from './capabilities'
import { DshClient } from './dsh-client'
import { HostLeaseCoordinator } from './host-lease'
import { HostManager } from './host-manager'
import { SidebarProvider, renderHtml } from './sidebar-provider'

let host: HostManager | null = null
let adapter: DshAdapter | null = null
let lease: HostLeaseCoordinator | null = null
let output: vscode.OutputChannel | null = null
let settingsPanel: vscode.WebviewPanel | null = null

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('DeepSeek Harness', { log: true })
  output = log
  const coordinator = new HostLeaseCoordinator(context.globalStorageUri.fsPath, (line) => log.appendLine(line))
  await coordinator.start()
  lease = coordinator

  const config = vscode.workspace.getConfiguration('deepseekHarness')
  const hostManager = new HostManager(log, {
    autoStart: config.get<boolean>('host.autoStart', true),
    executable: config.get<string>('host.executable', ''),
    arguments: config.get<string[]>('host.arguments', []),
    onOwnedHost: (info) => coordinator.publishOwnedHost(info),
    stopSharedOwnedHost: (probe) => coordinator.stopRecordedHost(probe),
  })
  hostManager.basePort = config.get<number>('host.basePort', 3080)
  const client = new DshClient()
  client.onLog = (line) => log.appendLine(line)
  const dshAdapter = new DshAdapter(client)
  let bridge!: Bridge
  bridge = new Bridge(dshAdapter, hostManager, context, {
    openSettings: () => openSettingsPanel(context, bridge),
    closeSettings: () => settingsPanel?.dispose(),
  })
  const provider = new SidebarProvider(context, bridge)

  host = hostManager
  adapter = dshAdapter

  const reveal = async (): Promise<vscode.Webview | null> => {
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.reveal()
    return provider.activeWebview
  }

  context.subscriptions.push(
    log,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('deepseekHarness.newChat', async () => {
      const target = await reveal()
      if (target !== null) bridge.postCommand('newChat', [target])
    }),
    vscode.commands.registerCommand('deepseekHarness.openSettings', async () => {
      openSettingsPanel(context, bridge)
    }),
    vscode.commands.registerCommand('deepseekHarness.openFullPanel', () => openFullPanel(context, bridge)),
    vscode.commands.registerCommand('deepseekHarness.insertSelection', async () => {
      const target = await reveal()
      if (target !== null) bridge.postIdeContent('selection', [target])
    }),
    vscode.commands.registerCommand('deepseekHarness.insertActiveFile', async () => {
      const target = await reveal()
      if (target !== null) bridge.postIdeContent('active-file', [target])
    }),
    vscode.commands.registerCommand('deepseekHarness.exportSession', async () => {
      const target = await reveal()
      if (target !== null) bridge.postCommand('exportSession', [target])
    }),
    vscode.commands.registerCommand('deepseekHarness.stopHost', async () => {
      await bridge.stop()
      void vscode.window.showInformationMessage('DeepSeek Harness Host stopped')
    }),
    vscode.commands.registerCommand('deepseekHarness.restartHost', async () => {
      await bridge.restart()
      void vscode.window.showInformationMessage('DeepSeek Harness Host restarted')
    }),
    vscode.commands.registerCommand('deepseekHarness.showLogs', () => log.show(true)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('deepseekHarness.host')) return
      const next = vscode.workspace.getConfiguration('deepseekHarness')
      hostManager.basePort = next.get<number>('host.basePort', 3080)
      hostManager.autoStart = next.get<boolean>('host.autoStart', true)
      hostManager.executable = next.get<string>('host.executable', '')
      hostManager.arguments = [...next.get<string[]>('host.arguments', [])]
    }),
  )
}

export async function deactivate(): Promise<void> {
  settingsPanel?.dispose()
  settingsPanel = null
  await adapter?.dispose()
  const coordinator = lease
  const lastWindow = coordinator === null ? true : await coordinator.releaseAndIsLast()
  const keepAlive = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('host.keepAliveOnExit', false)
  if (lastWindow && !keepAlive) await host?.dispose()
  output?.appendLine(`[extension] deactivated (lastWindow=${String(lastWindow)}, keepAlive=${String(keepAlive)})`)
  host = null
  adapter = null
  lease = null
  output = null
}

function openSettingsPanel(context: vscode.ExtensionContext, bridge: Bridge): void {
  if (settingsPanel !== null) {
    settingsPanel.reveal(vscode.ViewColumn.Active, false)
    bridge.refreshSettings(settingsPanel.webview)
    return
  }
  const panel = vscode.window.createWebviewPanel(
    'deepseekHarness.settings',
    'DeepSeek Harness 设置',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      retainContextWhenHidden: true,
    },
  )
  settingsPanel = panel
  panel.webview.html = renderHtml(panel.webview, context.extensionUri, 'settings')
  const attached = bridge.attach(panel.webview, 'settings')
  panel.onDidDispose(() => {
    attached.dispose()
    if (settingsPanel === panel) settingsPanel = null
  })
}

function openFullPanel(context: vscode.ExtensionContext, bridge: Bridge): void {
  const panel = vscode.window.createWebviewPanel(
    'deepseekHarness.fullPanel',
    'DeepSeek Harness',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      retainContextWhenHidden: true,
    },
  )
  panel.webview.html = renderHtml(panel.webview, context.extensionUri)
  const attached = bridge.attach(panel.webview, 'chat')
  panel.onDidDispose(() => attached.dispose())
}
