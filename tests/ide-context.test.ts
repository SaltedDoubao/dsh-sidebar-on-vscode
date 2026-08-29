import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDE_PROTOCOL_VERSION, ideContextSnapshotSchema, ideDiscoverySchema } from '../src/shared/ide-protocol'
import { truncateSelection } from '../src/extension/ide/selection-budget'

test('IDE protocol accepts a structured v1 snapshot and rejects version drift', () => {
  const snapshot = {
    protocolVersion: IDE_PROTOCOL_VERSION,
    snapshotId: crypto.randomUUID(),
    ideInstanceId: crypto.randomUUID(),
    workspace: { roots: [{ uri: 'file:///repo', name: 'repo', path: '/repo' }], selectedRootUri: 'file:///repo' },
    activeEditor: { uri: 'untitled:Untitled-1', languageId: 'typescript', isDirty: true, isUntitled: true },
    selection: {
      uri: 'untitled:Untitled-1',
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } },
      text: 'const x = 1',
      truncated: false,
      originalBytes: 11,
    },
    cursor: { uri: 'untitled:Untitled-1', position: { line: 1, character: 2 } },
    timestamp: Date.now(),
  }
  assert.equal(ideContextSnapshotSchema.safeParse(snapshot).success, true)
  assert.equal(ideContextSnapshotSchema.safeParse({ ...snapshot, protocolVersion: 2 }).success, false)
})

test('discovery requires authenticated loopback service facts', () => {
  const parsed = ideDiscoverySchema.safeParse({
    protocolVersion: 1,
    instanceId: crypto.randomUUID(),
    ide: 'vscode',
    ideVersion: '1.95.0',
    extensionVersion: '1.0.0',
    capabilities: { context: true, selection: true, diagnostics: true, diff: true, openFile: true, notebook: false, debugger: false },
    workspaceFolders: ['file:///repo'],
    pid: 1,
    port: 42137,
    transport: 'ws',
    authToken: 'x'.repeat(43),
    updatedAt: Date.now(),
  })
  assert.equal(parsed.success, true)
})

test('selection budget preserves small text and Unicode-safe head/tail for large text', () => {
  assert.deepEqual(truncateSelection('你好'), { text: '你好', truncated: false, originalBytes: 6 })
  const original = `开头-${'🙂'.repeat(6_000)}-结尾`
  const result = truncateSelection(original)
  assert.equal(result.truncated, true)
  assert.equal(result.originalBytes, Buffer.byteLength(original, 'utf8'))
  assert.match(result.text, /^开头-/u)
  assert.match(result.text, /-结尾$/u)
  assert.equal(result.text.includes('\uFFFD'), false)
})

