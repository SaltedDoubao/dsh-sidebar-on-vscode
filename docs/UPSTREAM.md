# Upstream synchronization

## Baselines

- UI/reference baseline: `MmMmaru/dsh-vscode-sidebar` commit `a8af23e`
- DeepSeek Harness protocol baseline: `deepseek-ai/deepseek-harness` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

The reference UI is imported selectively under MIT. Its extension ID, publisher, command namespace, pinned Host version, and legacy transport assumptions are intentionally not retained.

## Updating

When DeepSeek Harness changes, compare `packages/apiproxy`, host routes, and official UI Remote endpoints against the baseline above. Update tolerant schemas and capability probes first, then add feature adapters. Unknown fields and events must remain non-fatal; only a missing core session/event capability should block chat.

Do not restore a strict version-prefix gate. The reported version is diagnostic only.
