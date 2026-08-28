# DeepSeek Harness for VS Code

在 VS Code 独立侧边栏中使用本地 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。扩展负责发现或启动 loopback Host，并通过经过校验的扩展宿主桥接会话、事件、审批、设置与导出；Webview 不直接访问网络、文件系统或密钥。

## 开发

要求 Node.js 20+、npm，以及用于实际对话的 `dsh`（若 PATH 中不存在，扩展可回退到 `npx --yes @deepseek-ai/dsh@latest`）。

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

## 安全模型

- 仅探测 `127.0.0.1` 上配置端口起的十个连续端口。
- 外部启动的 Host 永不由扩展终止；扩展仅管理自己启动且身份验证通过的进程。
- API Key 仅通过经校验的扩展宿主 Bridge 写入 DSH credential endpoint，保持只写，不进入 Webview 持久状态，也不写日志。
- Markdown 原始 HTML 被忽略，链接与本地文件操作由扩展宿主白名单处理。

## 来源

UI 与部分测试结构选择性派生自 MIT 项目 `MmMmaru/dsh-vscode-sidebar`；连接层以 DeepSeek Harness 当前官方协议重建。详见包内的 `THIRD_PARTY_NOTICES.md` 与源码树中的 `docs/UPSTREAM.md`。
