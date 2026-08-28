import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DshAdapter } from '../src/extension/capabilities'
import { DshClient } from '../src/extension/dsh-client'
import { startFakeHost } from './fake-host'

test('capability detection tolerates unknown fields and probes the export contract', async () => {
  const fake = await startFakeHost({
    hostDescriptionExtra: { futureField: { nested: true } },
    values: { 'session.list': { items: [], futurePageToken: 'opaque' } },
    sessionExport: true,
  })
  const adapter = new DshAdapter(new DshClient())
  try {
    const matrix = await adapter.connect({ port: fake.port, spawnedByUs: false })
    assert.equal(matrix.core, true)
    assert.equal(matrix.sessions, true)
    assert.equal(matrix.sessionExport, true)
  } finally {
    await adapter.dispose()
    await fake.close()
  }
})

test('missing optional routes degrade independently without disabling chat', async () => {
  const fake = await startFakeHost({
    values: { 'session.list': { items: [] } },
    missingMethods: [
      'workspace.list', 'settings.describe', 'credentials.describe', 'llm.providers',
      'agentPreset.list', 'pluginInventory/list', 'messageFeedback/list',
      'fileReferences/list', 'sessionReferenceResolver/candidates',
    ],
  })
  const adapter = new DshAdapter(new DshClient())
  try {
    const matrix = await adapter.connect({ port: fake.port, spawnedByUs: false })
    assert.equal(matrix.core, true)
    assert.equal(matrix.workspace, false)
    assert.equal(matrix.settings, false)
    assert.equal(matrix.plugins, false)
    assert.equal(matrix.references, false)
    assert.equal(matrix.sessionExport, false)
  } finally {
    await adapter.dispose()
    await fake.close()
  }
})
