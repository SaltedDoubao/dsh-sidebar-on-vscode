import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HostLeaseCoordinator } from '../src/extension/host-lease'

test('window leases report last-window ownership in release order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deepseek-harness-lease-'))
  const a = new HostLeaseCoordinator(root, () => undefined)
  const b = new HostLeaseCoordinator(root, () => undefined)
  try {
    await a.start()
    await b.start()
    assert.equal(await a.releaseAndIsLast(), false)
    assert.equal(await b.releaseAndIsLast(), true)
  } finally {
    await a.releaseAndIsLast().catch(() => undefined)
    await b.releaseAndIsLast().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('a dead ownership PID is cleared without probing or signalling', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deepseek-harness-ownership-'))
  const coordinator = new HostLeaseCoordinator(root, () => undefined)
  let probes = 0
  try {
    await coordinator.publishOwnedHost({ port: 45999, pid: 2_147_483_647, spawnedByUs: true })
    const stopped = await coordinator.stopRecordedHost(async () => {
      probes += 1
      return true
    })
    assert.equal(stopped, false)
    assert.equal(probes, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
