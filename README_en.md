# DSH Sidebar on VSCode

[简体中文](README.md) | [English](README_en.md)

Use local [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) directly within a dedicated VS Code sidebar. The extension discovers or launches a loopback Host and bridges sessions, events, approvals, settings, and exports through a validated extension host; the Webview never directly accesses the network, filesystem, or credentials.

## Development

Development requires Node.js 20+, npm, and a locally installed official `dsh`. The extension does not download or maintain the DSH runtime; if `dsh` is not found on PATH, VS Code will display an installation prompt and command:

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

`test:e2e` uses an isolated `DSH_HOME` by default and does not copy user credentials, so the four test cases requiring a real model will be skipped. Only when a provider is configured in a throwaway test directory should `DSH_E2E_LIVE=1` be explicitly set to run these cases.

The generated local VSIX is identified as `local.deepseek-harness-vscode`. The initial release targets desktop VS Code and does not support VS Code Web or remote network Hosts.

### Settings

Click the settings button at the top-right of the sidebar or run `DSH Sidebar on VSCode: Open Settings` to open a standalone settings tab in the editor area. Re-opening it will reuse the existing tab and refresh authoritative Host data. The page provides general settings, model providers, plugins, and agent presets; extension-level advanced options (such as Host startup parameters) remain located in VS Code's native Settings.

### Custom Host Startup Command

The Host is started on demand when the sidebar is first opened. The extension first tries to reuse a compatible loopback Host; if none is found, it attempts the configured executable and then `dsh` on PATH in order. If neither is available, it displays an installation prompt without auto-downloading. The executable and arguments must be configured separately, for example:

```json
{
  "deepseekHarness.host.executable": "node",
  "deepseekHarness.host.arguments": ["C:\\tools\\deepseek-harness\\lib\\bin.js"]
}
```

The actual startup form is `<executable> <arguments...> web --host 127.0.0.1 --port <port> --no-open`. When the executable is Node, the extension automatically includes the `--expose-internals` flag required by the current DSH. Pipes, redirects, and other compound shell commands are not supported; if preparatory logic is needed, use a directly executable wrapper, or set `node`/`powershell.exe` as the executable and the script path as the first argument.

## Security Model

- Only probes up to 10 consecutive ports starting from the configured base port on `127.0.0.1`.
- Externally started Hosts are never terminated by the extension; the extension only manages processes spawned and authenticated by itself.
- API keys are written strictly write-only to the DSH credential endpoint through the validated extension host Bridge, never enter Webview persistent state, and are not logged.
- Raw HTML in Markdown is ignored; link navigation and local file operations are handled by extension host whitelists.

## Origins

UI and partial test structures are selectively derived from the MIT project `MmMmaru/dsh-vscode-sidebar`; the connection layer has been rebuilt against the current official DeepSeek Harness protocol. See `THIRD_PARTY_NOTICES.md` in the package and `docs/UPSTREAM.md` in the repository for details.

## License

This project is distributed and licensed under the [MIT](LICENSE) License. See [LICENSE](LICENSE) for details.
