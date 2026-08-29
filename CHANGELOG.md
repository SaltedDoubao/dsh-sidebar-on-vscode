# Changelog

All notable changes to the "dsh-sidebar-on-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-29

### Added

- **Experimental Local IDE Bridge & Ephemeral Context (Preview / Protocol Placeholder)**:
  - Implemented the IDE Context Protocol v1 and local WebSocket bridge server (`deepseekHarness.ideContext.ephemeral.enabled`).
  - Added per-turn ephemeral editor context staging and replacement, keeping Composer user prompt text clean.
  - Added safe budget truncation (Unicode-safe head/tail retention) for oversized selections.
  - Added IDE context snapshot extraction (active editor, cursor, selection, workspace roots, language ID).
  - Added discovery publishing to `.dsh/ide/` for pairing with DSH IDE Context Runtime plugins (companion runtime plugin is under development; falls back to compatible mode until released).
  - Supported caller-owned RPC IDs (`rpcWithId`) for deterministic context correlation.
- **Internationalization (i18n)**:
  - Added comprehensive localization support with English and Simplified Chinese translations for VS Code commands, configuration settings, sidebar UI, and settings surface.
  - Automatically aligns UI language with VS Code display language with manual override support.
- **Settings Surface & Composer Enhancements**:
  - Added toggle for Experimental Ephemeral IDE Context in the standalone Settings page.
  - Allowed active editors outside the selected workspace folder to be referenced as context.
  - Enhanced workspace folder switching and discovery synchronization.

## [1.0.0] - 2026-08-28

### Added

- Initial release of **DSH Sidebar on VSCode**.
- Dedicated sidebar chat panel integrating with local [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-ai) runtime over loopback.
- Secure extension host bridge isolating Webview from direct network, filesystem, or secret access.
- Interactive permission requests, questions, tool approvals, and plan/streaming outputs.
- Standalone multi-tab Settings page for managing providers, models, plugins, and agent presets.
- Session export (Markdown / JSON) and history navigation.
