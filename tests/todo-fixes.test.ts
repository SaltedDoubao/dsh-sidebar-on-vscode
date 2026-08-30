/**
 * Regression tests for the five TODO items:
 *   1. IDE content insertion formatting (pure helpers).
 *   2. askuserquestion replay after the webview is recreated (overlay store).
 *   3. Complete dsh Workspace/session navigation state.
 *   4. Sessions move to the top after the user sends a message.
 *   5. A background-running session resumes its turn timer on re-entry.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ApprovalRequestId, MessageId, SessionId, WorkspaceId } from '../src/extension/protocol/brand'
import type { AskUserQuestionItem } from '../src/extension/protocol/events'
import type { SessionMeta } from '../src/webview/types'
import { formatIdeInsert, languageFromPath } from '../src/webview/ide-insert'

;(globalThis as { __DSH_MOCK__?: boolean }).__DSH_MOCK__ = true

const a = 'sess-a' as SessionId
const b = 'sess-b' as SessionId
const c = 'sess-c' as SessionId
const MOCK_CWD = '/mock/workspace'

function meta(sessionId: SessionId, updatedAt: number, extra: Partial<SessionMeta> = {}): SessionMeta {
  return { sessionId, title: null, updatedAt, running: false, blank: false, ...extra }
}

// ---------------------------------------------------------------------------
// ① IDE content insertion formatting
// ---------------------------------------------------------------------------

test('formatIdeInsert renders a source header plus a language-tagged fence', () => {
  const block = formatIdeInsert('active-file', 'export const x = 1\n', '/work/src/store/sessions.ts')
  assert.match(block, /### 文件：\/work\/src\/store\/sessions\.ts/)
  assert.match(block, /```ts/)
  assert.match(block, /export const x = 1/)
  assert.ok(block.endsWith('```'))
  // The trailing newline of document.getText() is trimmed: no blank line
  // between the content and the closing fence.
  assert.ok(!block.includes('1\n\n```'))
})

test('findIdeBlock strips IDE blocks from the user bubble and yields a hint', async () => {
  const { findIdeBlock } = await import('../src/webview/store/conversation')

  // Selection block (auto-injected): clean text keeps the question only.
  const selection = findIdeBlock('这个函数是做什么的？\n\n### 选中代码（/work/src/auto.ts）\n\n```ts\nfunction f() {}\n```')
  assert.equal(selection.clean, '这个函数是做什么的？')
  assert.deepEqual(selection.hint, { label: '选中代码（/work/src/auto.ts）', path: '/work/src/auto.ts' })

  // Current-file path block (auto-injected without selection).
  const pathOnly = findIdeBlock('这个文件是什么？\n\n### 当前文件：/work/src/context.ts')
  assert.equal(pathOnly.clean, '这个文件是什么？')
  assert.deepEqual(pathOnly.hint, { label: '当前文件：/work/src/context.ts', path: '/work/src/context.ts' })

  // Manual full-file block (insert command / chip).
  const manual = findIdeBlock('看看这个\n\n### 文件：/work/src/big.ts\n\n```ts\ncontent\n```')
  assert.equal(manual.clean, '看看这个')
  assert.equal(manual.hint?.label, '当前文件：/work/src/big.ts')

  // No block: text untouched.
  const plain = findIdeBlock('普通问题')
  assert.equal(plain.clean, '普通问题')
  assert.equal(plain.hint, null)
})

test('formatIdeInsert selection flavor names the source and drops unknown languages', () => {
  const block = formatIdeInsert('selection', 'SELECTED', '/work/README')
  assert.match(block, /### 选中代码（\/work\/README）/)
  assert.match(block, /```\nSELECTED/)
})

test('languageFromPath maps known extensions and ignores unknown ones', () => {
  assert.equal(languageFromPath('/a/b.tsx'), 'tsx')
  assert.equal(languageFromPath('/a/b.JSON'), 'json')
  assert.equal(languageFromPath('/a/b.sh'), 'bash')
  assert.equal(languageFromPath('/a/b'), undefined)
  assert.equal(languageFromPath(undefined), undefined)
  assert.equal(languageFromPath('/a/.hidden'), undefined)
})

// ---------------------------------------------------------------------------
// ③ Cross-workspace isolation + ④ session-to-top (sessions slice)
// ---------------------------------------------------------------------------

test('host/session-added accepts all dsh workspaces and deduplicates repeated frames', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const state = useAppStore.getState()
  useAppStore.setState({ cwd: MOCK_CWD, sessions: [meta(a, 3)], activeSessionId: null })

  state.applyHostFrame({ type: 'host/session-added', sessionId: b, blank: true, cwd: '/other/workspace' })
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [b, a])

  state.applyHostFrame({ type: 'host/session-added', sessionId: b, blank: true, cwd: MOCK_CWD })
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [b, a])

  // cwd-less legacy rows still enter (ungrouped sessions stay reachable).
  state.applyHostFrame({ type: 'host/session-added', sessionId: c, blank: true })
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [c, b, a])
})

test('initSessions trusts the bridge workspace baseline and does not re-filter cwd', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const state = useAppStore.getState()
  const rows = [
    meta(a, 1, { cwd: MOCK_CWD }),
    meta(b, 2, { cwd: '/other/workspace' }),
    meta(c, 3), // legacy cwd-less row stays visible
  ]
  state.initSessions(rows)
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [c, b, a])
})

test('workspace baselines and live frames preserve durable grouping/order and archives', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const wsA = 'ws-a' as WorkspaceId
  const wsB = 'ws-b' as WorkspaceId
  const workspace = (workspaceId: WorkspaceId, sessionIds: SessionId[]) => ({
    workspaceId, path: `/work/${workspaceId}`, title: workspaceId, sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const state = useAppStore.getState()
  state.initSessions([meta(a, 3), meta(b, 2), meta(c, 1)])
  state.initWorkspaces([workspace(wsA, [a]), workspace(wsB, [b])], [c])
  assert.deepEqual(useAppStore.getState().sessions.map((session) => session.sessionId), [a, b])
  assert.deepEqual(useAppStore.getState().workspaces.map((item) => item.workspaceId), [wsA, wsB])

  state.applyHostFrame({ type: 'host/workspace-order-changed', workspaceIds: [wsB, wsA] })
  assert.deepEqual(useAppStore.getState().workspaces.map((item) => item.workspaceId), [wsB, wsA])
  state.applyHostFrame({ type: 'host/workspace-removed', workspaceId: wsB })
  assert.deepEqual(useAppStore.getState().workspaces.map((item) => item.workspaceId), [wsA])
})

test('StatsLine session groups localize every bottom-bar label', async () => {
  const { statsGroups } = await import('../src/webview/components/composer/StatsLine')
  const projection = { turns: 2, steps: 3, llmMs: 1_000, toolMs: 500, ttftMs: 250, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 20 }
  assert.deepEqual(statsGroups(projection, true), [
    '2 轮次 · 3 步骤', '模型耗时 1s · 工具调用 0.5s', '首字延迟均值 0.3s · 20 tok/s',
  ])
  assert.match(statsGroups(projection, false).join(' | '), /2 turns.*Tool call.*TTFT avg/)
})

test('context meter uses projected pressure and derives stable panel segments', async () => {
  const { contextSegments, contextTooltip, contextUsage } = await import('../src/webview/components/composer/context-meter-model')
  assert.equal(contextUsage(null), null)
  assert.equal(contextUsage({ pressureTokens: 10 }), null)
  assert.deepEqual(contextUsage({ pressureTokens: 32_000, projectedTokens: 3_000, contextWindow: 128_000 }), {
    usedTokens: 3_000,
    contextWindow: 128_000,
    percent: 2,
  })
  assert.equal(contextUsage({ pressureTokens: 150_000, contextWindow: 128_000 })?.percent, 100)
  assert.equal(contextTooltip(25, true), '上下文已用: 25%')
  assert.equal(contextTooltip(25, false), 'Context used: 25%')
  assert.deepEqual(contextSegments(0, { systemTokens: 1, toolsTokens: 1, messageTokens: 1 }), [])
  assert.deepEqual(contextSegments(25, null), [{ key: 'total', color: '', width: 25 }])
  const parts = contextSegments(40, { systemTokens: 10, toolsTokens: 20, messageTokens: 10 })
  assert.equal(parts.length, 3)
  assert.equal(parts.reduce((sum, part) => sum + part.width, 0), 40)
})

test('permissions install from history and live projections, then clear with the session', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const { DEMO_SESSION_ID } = await import('../src/webview/mock/bridge')
  useAppStore.setState({ activeSessionId: DEMO_SESSION_ID, sessions: [meta(DEMO_SESSION_ID, Date.now())] })
  await useAppStore.getState().loadHistory(DEMO_SESSION_ID)
  assert.equal(useAppStore.getState().permissions?.currentValue, 'workspace-write')
  assert.deepEqual(useAppStore.getState().permissions?.options.map((option) => option.value), ['read-only', 'workspace-write', 'danger-full-access'])

  useAppStore.getState().applyQueueFrame({
    type: 'session/projection', sessionId: DEMO_SESSION_ID, key: 'permissions', seq: 9,
    value: { currentValue: 'custom', options: [{ value: 'custom', name: 'Custom policy' }, { value: 'safe', name: 'Safe' }] },
  })
  assert.equal(useAppStore.getState().permissions?.currentValue, 'custom')
  assert.equal(useAppStore.getState().permissionSwitchingTo, null)
  useAppStore.getState().clearConversation()
  assert.equal(useAppStore.getState().permissions, null)
})

test('permission switches wait for the host projection and retain errors', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const permissions = {
    currentValue: 'workspace-write',
    options: [{ value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' }],
  }
  useAppStore.setState({ activeSessionId: a, permissions, permissionSwitchingTo: null, permissionError: null })
  await useAppStore.getState().setPermissionPreset('read-only')
  assert.equal(useAppStore.getState().permissions?.currentValue, 'workspace-write')
  assert.equal(useAppStore.getState().permissionSwitchingTo, 'read-only')
  useAppStore.getState().applyQueueFrame({ type: 'session/projection', sessionId: a, key: 'permissions', seq: 10, value: { ...permissions, currentValue: 'read-only' } })
  assert.equal(useAppStore.getState().permissions?.currentValue, 'read-only')
  assert.equal(useAppStore.getState().permissionSwitchingTo, null)

  useAppStore.setState({ permissions: { currentValue: 'read-only', options: [{ value: 'unknown-preset', name: 'Unknown' }] } })
  await assert.rejects(useAppStore.getState().setPermissionPreset('unknown-preset'), /unknown permission preset/u)
  assert.equal(useAppStore.getState().permissionSwitchingTo, null)
  assert.match(useAppStore.getState().permissionError ?? '', /unknown permission preset/u)
})

test('permission selector uses and updates the next-session default without a history session', async () => {
  const { defaultPermissionProjection } = await import('../src/webview/components/composer/permission-select-model')
  const { useAppStore } = await import('../src/webview/store')

  assert.equal(defaultPermissionProjection('full-access').currentValue, 'danger-full-access')
  assert.deepEqual(
    defaultPermissionProjection('workspace-write').options.map((option) => option.value),
    ['read-only', 'workspace-write', 'danger-full-access'],
  )

  useAppStore.setState({
    activeSessionId: null,
    permissions: null,
    permissionSwitchingTo: null,
    permissionError: null,
    uiPrefSources: { ...useAppStore.getState().uiPrefSources, permissionMode: 'local' },
    uiPrefs: { ...useAppStore.getState().uiPrefs, permissionMode: 'workspace-write' },
  })
  await useAppStore.getState().setPermissionPreset('read-only')
  assert.equal(useAppStore.getState().uiPrefs.permissionMode, 'read-only')
  assert.equal(useAppStore.getState().permissions, null)
  assert.equal(useAppStore.getState().permissionSwitchingTo, null)
})

test('sending a message moves the session to the top of the list', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const state = useAppStore.getState()
  useAppStore.setState({ cwd: MOCK_CWD, sessions: [meta(a, 100), meta(b, 50), meta(c, 10)] })

  // The live user/message frame carries the authoritative prompt time.
  state.applyProjectionFrame({
    type: 'session/event',
    sessionId: b,
    event: { type: 'user/message', seq: 5, time: 200, data: { id: 'm-1' as MessageId, role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } },
  })
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [b, a, c])
  assert.equal(useAppStore.getState().sessions[0]?.updatedAt, 200)

  // touchSession with a newer time moves the row; an older time is a no-op.
  state.touchSession(c, 500)
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [c, b, a])
  state.touchSession(a, 1)
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [c, b, a])
  // Unknown sessions (foreign workspace frames) never touch the list.
  state.touchSession('sess-foreign' as SessionId, 999)
  assert.deepEqual(useAppStore.getState().sessions.map((s) => s.sessionId), [c, b, a])
})

// ---------------------------------------------------------------------------
// ② askuserquestion replay / per-session overlay tracking
// ---------------------------------------------------------------------------

const QUESTION: AskUserQuestionItem = { id: 'q-1', question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] }

test('question frames for a background session are recorded and surface on select', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const { waitingSessionId } = await import('../src/webview/store/overlay')
  const state = useAppStore.getState()
  useAppStore.setState({ cwd: MOCK_CWD, activeSessionId: a, overlayBySession: {}, pendingApproval: null, pendingQuestion: null, planReview: null })

  // Frame arrives while ANOTHER session is active: no panel for the active
  // session, but the per-session record drives the amber waiting dot.
  state.applyOverlayFrame({ type: 'question/requested', sessionId: b, questions: [QUESTION] })
  const store = useAppStore.getState()
  assert.equal(store.pendingQuestion, null)
  assert.equal(store.overlayBySession[b]?.question?.questions[0]?.id, 'q-1')
  assert.equal(waitingSessionId(store.overlayBySession), b)

  // Selecting the waiting session derives the takeover panel.
  useAppStore.setState({ sessions: [meta(a, 1), meta(b, 2)], activeSessionId: b })
  state.refreshActiveOverlay()
  const derived = useAppStore.getState()
  assert.equal(derived.pendingQuestion?.sessionId, b)
  assert.equal(derived.pendingQuestion?.questions[0]?.id, 'q-1')

  // question/resolved clears the record and the derived panel.
  state.applyOverlayFrame({ type: 'question/resolved', sessionId: b, questionRpcId: 'rpc-1' as never, outcome: 'answered' })
  const cleared = useAppStore.getState()
  assert.equal(cleared.pendingQuestion, null)
  assert.equal(cleared.overlayBySession[b], undefined)
})

test('approval frames record, derive and clear per session', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const state = useAppStore.getState()
  useAppStore.setState({ cwd: MOCK_CWD, activeSessionId: a, overlayBySession: {}, pendingApproval: null, pendingQuestion: null, planReview: null })

  state.applyOverlayFrame({ type: 'approval/requested', sessionId: a, approvalId: 'ap-1' as ApprovalRequestId, toolName: 'bash', reason: 'run build' })
  assert.equal(useAppStore.getState().pendingApproval?.approvalId, 'ap-1')
  // A resolution for a different approvalId must not clear this one.
  state.applyOverlayFrame({ type: 'approval/resolved', sessionId: a, approvalId: 'ap-other' as ApprovalRequestId, outcome: 'rejected' })
  assert.equal(useAppStore.getState().pendingApproval?.approvalId, 'ap-1')
  state.applyOverlayFrame({ type: 'approval/resolved', sessionId: a, approvalId: 'ap-1' as ApprovalRequestId, outcome: 'allowed-once' })
  assert.equal(useAppStore.getState().pendingApproval, null)
  assert.equal(useAppStore.getState().overlayBySession[a], undefined)
})

test('applyOverlays reinstalls replayed frames from the init payload', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const state = useAppStore.getState()
  useAppStore.setState({ cwd: MOCK_CWD, activeSessionId: a, overlayBySession: {}, pendingApproval: null, pendingQuestion: null, planReview: null })

  // What the extension host replays after the webview was recreated hidden.
  state.applyOverlays([
    { kind: 'approval', frame: { type: 'approval/requested', sessionId: b, approvalId: 'ap-9' as ApprovalRequestId, toolName: 'bash' } },
    { kind: 'question', frame: { type: 'question/requested', sessionId: a, questions: [QUESTION] } },
  ])
  const store = useAppStore.getState()
  // The active session's panel is derived immediately.
  assert.equal(store.pendingQuestion?.sessionId, a)
  assert.equal(store.overlayBySession[b]?.approval?.approvalId, 'ap-9')
  // The waiting dot points at the replayed question first (find order).
  const { waitingSessionId } = await import('../src/webview/store/overlay')
  assert.equal(waitingSessionId(store.overlayBySession), b)

  // clearOverlay drops the derived panel but keeps the per-session map
  // (session switch must not lose another session's pending overlay).
  state.clearOverlay()
  const afterClear = useAppStore.getState()
  assert.equal(afterClear.pendingQuestion, null)
  assert.equal(afterClear.overlayBySession[b]?.approval?.approvalId, 'ap-9')
})

// ---------------------------------------------------------------------------
// ⑤ Running-turn timer resume
// ---------------------------------------------------------------------------

test('entering a background-running session resumes the turn timer from history', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const { mockHistoryOverrides } = await import('../src/webview/mock/bridge')
  const running = 'sess-running' as SessionId
  const startedAt = Date.now() - 120_000
  mockHistoryOverrides.set(running, [{
    event: { type: 'turn/start', seq: 1, time: startedAt, data: { turn: 7 } },
  }])
  try {
    useAppStore.setState({
      cwd: MOCK_CWD,
      sessions: [meta(running, Date.now(), { running: true }), meta(a, 1)],
      activeSessionId: running,
      turnStatus: 'idle',
      turnStartedAt: null,
    })
    await useAppStore.getState().loadHistory(running)
    const store = useAppStore.getState()
    // The open turn's turn/start resumes the running state and the clock.
    assert.equal(store.turnStatus, 'running')
    assert.equal(store.turnStartedAt, startedAt)
  } finally {
    mockHistoryOverrides.delete(running)
  }
})

test('a completed-turn session stays idle after loadHistory', async () => {
  const { useAppStore } = await import('../src/webview/store')
  const { mockHistoryOverrides } = await import('../src/webview/mock/bridge')
  const done = 'sess-done' as SessionId
  const startedAt = Date.now() - 60_000
  mockHistoryOverrides.set(done, [
    { event: { type: 'turn/start', seq: 1, time: startedAt, data: { turn: 1 } } },
    { event: { type: 'turn/end', seq: 2, time: startedAt + 5000, data: { turn: 1, reason: { kind: 'completed' } } } },
  ])
  try {
    useAppStore.setState({
      cwd: MOCK_CWD,
      sessions: [meta(done, Date.now())],
      activeSessionId: done,
      turnStatus: 'idle',
      turnStartedAt: null,
    })
    await useAppStore.getState().loadHistory(done)
    const store = useAppStore.getState()
    assert.equal(store.turnStatus, 'idle')
    assert.equal(store.turnStartedAt, null)
    assert.equal(store.lastTurnMs, 5000)
  } finally {
    mockHistoryOverrides.delete(done)
  }
})
