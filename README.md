# DSH Sidebar on VSCode

[简体中文](README.md) | [English](README_en.md)

在 VS Code 独立侧边栏中使用本地 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。扩展负责发现或启动 loopback Host，并通过经过校验的扩展宿主桥接会话、事件、审批、设置与导出；Webview 不直接访问网络、文件系统或密钥。

## 开发

开发要求 Node.js 20+、npm 与本机安装的官方 `dsh`。扩展不会下载或维护 DSH runtime；若 PATH 中没有 `dsh`，VS Code 会显示安装提示及命令：

```sh
npm install -g @deepseek-ai/dsh
```

```sh
npm install
npm run typecheck
npm test
npm run test:e2e
npm run test:vscode
npm run build
npm run package
```

`test:e2e` 默认使用隔离的 `DSH_HOME`，不会复制用户凭据，因此需要真实模型的四项用例会跳过。只有在一次性的测试目录内配置 provider 后，才应显式设置 `DSH_E2E_LIVE=1` 运行这些用例。

生成的本地 VSIX 标识为 `local.deepseek-harness-vscode`。首版面向桌面版 VS Code，不支持 VS Code Web 或远程网络 Host。

### 设置

点击侧边栏右上角的设置按钮，或运行 `DSH Sidebar on VSCode: Open Settings`，会在当前编辑器区域打开独立的设置标签。重复打开会复用同一标签并刷新 Host 权威数据。页面提供通用设置、模型提供方、插件和 Agent 预设；Host 启动参数等扩展级高级选项仍位于 VS Code 原生 Settings。

### 自定义 Host 启动命令

Host 在首次打开侧边栏时按需启动。扩展先复用兼容的 loopback Host；未找到时依次尝试配置的可执行文件和 PATH 中的 `dsh`。两者都不可用时只显示安装提示，不会自动下载。可执行文件与参数必须分开配置，例如：

```json
{
  "deepseekHarness.host.executable": "node",
  "deepseekHarness.host.arguments": ["C:\\tools\\deepseek-harness\\lib\\bin.js"]
}
```

实际启动形式为 `<executable> <arguments...> web --host 127.0.0.1 --port <port> --no-open`。当 executable 为 Node 时，扩展会自动加入当前 DSH 所需的 `--expose-internals`。不支持管道、重定向或其他复合 shell 命令；需要准备逻辑时请使用可直接执行的包装程序，或把 `node`/`powershell.exe` 配为 executable、把脚本路径配为第一个 argument。

## 安全模型

- 仅探测 `127.0.0.1` 上配置端口起的十个连续端口。
- 外部启动的 Host 永不由扩展终止；扩展仅管理自己启动且身份验证通过的进程。
- API Key 仅通过经校验的扩展宿主 Bridge 写入 DSH credential endpoint，保持只写，不进入 Webview 持久状态，也不写日志。
- Markdown 原始 HTML 被忽略，链接与本地文件操作由扩展宿主白名单处理。

## 来源

UI 与部分测试结构选择性派生自 MIT 项目 `MmMmaru/dsh-vscode-sidebar`；连接层以 DeepSeek Harness 当前官方协议重建。详见包内的 `THIRD_PARTY_NOTICES.md` 与源码树中的 `docs/UPSTREAM.md`。

## 许可证

本项目采用 [MIT](LICENSE) 许可证分发与使用。详细条款见 [LICENSE](LICENSE)。
