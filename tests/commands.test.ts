import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandId, SessionId } from '../src/extension/protocol/brand'
import type { SessionEvent } from '../src/extension/protocol/session'

;(globalThis as { __DSH_MOCK__?: boolean }).__DSH_MOCK__ = true

const sessionId = 's-command-test' as SessionId

function event<T extends SessionEvent['type']>(
  type: T,
  seq: number,
  data: Extract<SessionEvent, { type: T }>['data'],
): SessionEvent {
  return { type, seq, time: seq * 100, data } as SessionEvent
}

test('composer routes registered commands to commands/execute, skills to prompt, and rejects unknown slash input', async () => {
  const [{ useAppStore }, mock] = await Promise.all([
    import('../src/webview/store'),
    import('../src/webview/mock/bridge'),
  ])
  useAppStore.setState({
    activeSessionId: sessionId,
    sessions: [{ sessionId, title: null, updatedAt: 1, running: false, blank: false, cwd: '/mock/workspace' }],
  })
  await useAppStore.getState().loadComposerCatalog(sessionId)

  mock.mockCommandRpcLog.length = 0
  mock.mockPromptRpcLog.length = 0
  await useAppStore.getState().sendPrompt('/plan off', [])
  assert.deepEqual(mock.mockCommandRpcLog.map((call) => call.method), ['commands/execute'])
  assert.equal(mock.mockPromptRpcLog.length, 0)
  assert.deepEqual((mock.mockCommandRpcLog[0]?.params['args'] as { line?: string })?.line, '/plan off')

  mock.mockCommandRpcLog.length = 0
  await useAppStore.getState().sendPrompt('/review this', [])
  assert.equal(mock.mockCommandRpcLog.length, 0)
  assert.equal(mock.mockPromptRpcLog.length, 1)

  mock.mockPromptRpcLog.length = 0
  await assert.rejects(useAppStore.getState().sendPrompt('/not-a-command value', []), /unknown or malformed command/u)
  assert.equal(mock.mockPromptRpcLog.length, 0)
})

test('command events fold by commandId, preserve goal input, and integrate compact outcomes', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const goalId = 'command-goal' as CommandId
  const compactId = 'command-compact' as CommandId
  useAppStore.setState({ activeSessionId: sessionId, nodes: [] })

  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/run', 10, { commandId: goalId, name: 'goal', args: ' ship it', source: { kind: 'user' } }),
  })
  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/done', 11, { commandId: goalId, kind: 'success', text: 'Goal created' }),
  })
  assert.deepEqual(useAppStore.getState().nodes.map((node) => node.kind), ['command-input', 'command'])
  const goalInput = useAppStore.getState().nodes[0]
  assert.equal(goalInput?.kind === 'command-input' && goalInput.text, '/goal ship it')
  const goalCommand = useAppStore.getState().nodes.find((node) => node.kind === 'command')
  assert.equal(goalCommand?.kind === 'command' && goalCommand.outcome?.text, 'Goal created')

  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/run', 20, { commandId: compactId, name: 'compact', source: { kind: 'user' } }),
  })
  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('compaction/summary', 21, {
      compactionId: 'compact-1', sourceCommandId: compactId,
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: 1, end: 9 }, shadowedSeqs: [], shadowedTokenCount: 50,
      provider: 'test', model: 'test',
    }),
  })
  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/done', 22, { commandId: compactId, kind: 'success', text: 'done', sourceEventSeq: 21 }),
  })
  const compact = useAppStore.getState().nodes.find((node) => node.kind === 'compaction')
  assert.equal(compact?.kind === 'compaction' && compact.command?.status, 'success')
  assert.equal(useAppStore.getState().nodes.some((node) => node.kind === 'command' && node.commandId === compactId), false)
})

test('permission command lifecycles stay out of the conversation surface', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const permissionId = 'command-permission' as CommandId
  useAppStore.setState({ activeSessionId: sessionId, nodes: [], silentCommandIds: new Set() })

  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/run', 30, {
      commandId: permissionId,
      name: 'permission',
      args: ' read-only',
      source: { kind: 'user' },
    }),
  })
  useAppStore.getState().applyMuxFrame({
    type: 'session/event', sessionId,
    event: event('command/done', 31, { commandId: permissionId, kind: 'success', text: 'read-only' }),
  })

  assert.equal(useAppStore.getState().nodes.length, 0)
  assert.equal(useAppStore.getState().silentCommandIds.has(permissionId), true)
})

test('permission receipt removes a lifecycle that raced ahead of suppression', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const permissionId = 'command-permission-race' as CommandId
  useAppStore.setState({
    activeSessionId: sessionId,
    silentCommandIds: new Set(),
    nodes: [{
      id: `command-${permissionId}`,
      kind: 'command',
      seq: 40,
      time: 4000,
      commandId: permissionId,
      name: null,
      args: null,
      outcome: { kind: 'success', text: 'read-only' },
    }],
  })

  useAppStore.getState().suppressCommand(permissionId)
  assert.equal(useAppStore.getState().nodes.length, 0)
})

test('history-page normalization joins a run with a done-only node', async () => {
  const { normalizeCommandNodes } = await import('../src/webview/store/conversation')
  const commandId = 'command-split' as CommandId
  const nodes = normalizeCommandNodes([
    { id: 'run', kind: 'command', seq: 1, time: 1, commandId, name: 'plan', args: ' off', outcome: null },
    { id: 'done', kind: 'command', seq: 2, time: 2, commandId, name: null, args: null, outcome: { kind: 'error', text: 'failed' } },
  ])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0]?.kind === 'command' && nodes[0].name, 'plan')
  assert.equal(nodes[0]?.kind === 'command' && nodes[0].outcome?.kind, 'error')
})
