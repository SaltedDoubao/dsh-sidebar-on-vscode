/**
 * Unit tests for HostManager: probe semantics, port rollover (顺延), and the
 * version compatibility check. All traffic hits an in-process fake host.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DSH_INSTALL_COMMAND, DshNotInstalledError, HostManager } from '../src/extension/host-manager'
import { consecutivePorts, startFakeHost } from './fake-host'

/** Silent logger satisfying the OutputChannel subset HostManager consumes. */
const silentLog = { appendLine: (_line: string): void => undefined }
const fixtureCli = path.resolve('tests/fixtures/fake-dsh-cli.mjs')

async function installFakePathCommand(root: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(path.join(root, 'dsh.cmd'), '@exit /b 99\r\n', 'utf8')
    const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
    const cli = path.join(packageRoot, 'lib', 'bin.js')
    await mkdir(path.dirname(cli), { recursive: true })
    await copyFile(fixtureCli, cli)
    await writeFile(path.join(packageRoot, 'package.json'), '{"type":"module","name":"@deepseek-ai/dsh"}', 'utf8')
    return
  }
  const shim = path.join(root, 'dsh')
  const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const cli = path.join(packageRoot, 'lib', 'bin.js')
  await mkdir(path.dirname(cli), { recursive: true })
  await copyFile(fixtureCli, cli)
  await writeFile(path.join(packageRoot, 'package.json'), '{"type":"module","name":"@deepseek-ai/dsh"}', 'utf8')
  await symlink(cli, shim)
}

test('probe returns false on a closed port and true on a dsh host', async () => {
  const fake = await startFakeHost()
  const manager = new HostManager(silentLog)
  try {
    assert.equal(await manager.probe(fake.port), true)
    assert.equal(await manager.probe(1), false)
  } finally {
    await fake.close()
  }
})

test('probe rejects a non-dsh listener on the port', async () => {
  const dummy: Server = createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>((resolve) => dummy.listen(0, '127.0.0.1', resolve))
  const address = dummy.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const manager = new HostManager(silentLog)
  try {
    assert.equal(await manager.probe(port), false)
  } finally {
    await new Promise<void>((resolve) => dummy.close(() => resolve()))
  }
})

test('ensureHost skips an occupied non-dsh port and uses the next live host (端口顺延)', async () => {
  const [base] = await consecutivePorts()
  // Occupy base with a dummy listener that never answers like dsh.
  const dummy: Server = createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>((resolve) => dummy.listen(base, '127.0.0.1', resolve))
  // A real dsh-shaped host sits on base+1.
  const fakeOnNext = await startFakeHostOn(base + 1)
  const manager = new HostManager(silentLog)
  manager.basePort = base
  try {
    const info = await manager.ensureHost()
    assert.equal(info.port, base + 1)
    assert.equal(info.spawnedByUs, false)
  } finally {
    await fakeOnNext.close()
    await new Promise<void>((resolve) => dummy.close(() => resolve()))
  }
})

/** startFakeHost bound to an explicit port (rollover fixture). */
async function startFakeHostOn(port: number) {
  const { createServer: create } = await import('node:http')
  const server = create((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/host.describe') {
      res.writeHead(404).end()
      return
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    req.on('end', () => {
      const body = JSON.parse(raw) as { rpcId: string }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { version: '0.1.0-rc.6', cwd: '/tmp', attachedSessions: 0, canOpenPath: false } },
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { server, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('version is diagnostic only when the core host.describe structure is valid', async () => {
  const manager = new HostManager(silentLog)
  for (const version of ['0.1.0-rc.6', '0.0.1']) {
    const good = await startFakeHost({ version })
    try {
      assert.equal(await manager.checkVersion({ port: good.port, spawnedByUs: false }), null)
    } finally {
      await good.close()
    }
  }
  const future = await startFakeHost({ version: '9.9.9' })
  try {
    assert.equal(await manager.checkVersion({ port: future.port, spawnedByUs: false }), null)
  } finally {
    await future.close()
  }
})

test('explicit executable receives literal custom arguments before the managed web command', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh host arguments '))
  const capture = path.join(root, 'captured arguments.json')
  const [port] = await consecutivePorts()
  const custom = [fixtureCli, '--capture', capture, 'argument with spaces', '&&', 'echo-not-executed']
  const manager = new HostManager(silentLog, { executable: process.execPath, arguments: custom })
  try {
    const info = await manager.spawn(port)
    assert.equal(info.spawnedByUs, true)
    const captured = JSON.parse(await readFile(capture, 'utf8')) as string[]
    assert.deepEqual(captured, [...custom.slice(1), 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'])
  } finally {
    await manager.stopOwned()
    await rm(root, { recursive: true, force: true })
  }
})

test('configured Node executable may be a plain PATH command and receives required runtime flags', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-path-command-'))
  const capture = path.join(root, 'args.json')
  const [port] = await consecutivePorts()
  const manager = new HostManager(silentLog, {
    executable: process.platform === 'win32' ? 'node.exe' : 'node',
    arguments: [fixtureCli, '--capture', capture, '--require-expose-internals'],
  })
  try {
    await manager.spawn(port)
    const captured = JSON.parse(await readFile(capture, 'utf8')) as string[]
    assert.equal(captured.at(-6), 'web')
  } finally {
    await manager.stopOwned()
    await rm(root, { recursive: true, force: true })
  }
})

test('automatic startup uses the PATH dsh with literal argument ordering', async () => {
  const originalPath = process.env['PATH']
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-path-fallback-'))
  const capture = path.join(root, 'args.json')
  try {
    await installFakePathCommand(root)
    process.env['PATH'] = root
    const [port] = await consecutivePorts()
    const manager = new HostManager(silentLog, {
      arguments: ['--capture', capture, '--require-expose-internals'],
    })
    await manager.spawn(port)
    const captured = JSON.parse(await readFile(capture, 'utf8')) as string[]
    assert.deepEqual(captured, [
      '--capture', capture, '--require-expose-internals',
      'web', '--host', '127.0.0.1', '--port', String(port), '--no-open',
    ])
    await manager.stopOwned()
  } finally {
    if (originalPath === undefined) delete process.env['PATH']
    else process.env['PATH'] = originalPath
    await rm(root, { recursive: true, force: true })
  }
})

test('missing PATH dsh reports the official npm installation command without installing', async () => {
  const originalPath = process.env['PATH']
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-not-installed-'))
  try {
    process.env['PATH'] = root
    const manager = new HostManager(silentLog)
    await assert.rejects(manager.spawn(1), (error: unknown) => {
      assert.ok(error instanceof DshNotInstalledError)
      assert.equal(error.installCommand, DSH_INSTALL_COMMAND)
      assert.equal(error.message.includes(DSH_INSTALL_COMMAND), true)
      return true
    })
  } finally {
    if (originalPath === undefined) delete process.env['PATH']
    else process.env['PATH'] = originalPath
    await rm(root, { recursive: true, force: true })
  }
})

test('managed web, loopback host and port cannot be overridden by custom arguments', async () => {
  for (const forbidden of ['web', '--', '--host', '--host=0.0.0.0', '--port', '--port=1']) {
    const manager = new HostManager(silentLog, { executable: process.execPath, arguments: [forbidden] })
    await assert.rejects(manager.spawn(1), /cannot override the managed web host or port/u)
  }
})

test('configured executable rejects compound shell commands', async () => {
  const manager = new HostManager(silentLog, { executable: 'node --version' })
  await assert.rejects(manager.spawn(1), /must not contain arguments or shell operators/u)
})

test('unresolved shell shims are rejected instead of re-parsing arguments', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-unsafe-shim-'))
  const shim = path.join(root, 'custom dsh.cmd')
  await writeFile(shim, '@echo off\r\n', 'utf8')
  const manager = new HostManager(silentLog, { executable: shim })
  try {
    await assert.rejects(manager.spawn(1), /Cannot safely launch shell shim/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('early process exit is reported and credential-looking stderr is redacted', async () => {
  const lines: string[] = []
  const manager = new HostManager({ appendLine: (line: string) => lines.push(line) }, {
    executable: process.execPath,
    arguments: [fixtureCli, '--exit-immediately'],
  })
  const [port] = await consecutivePorts()
  await assert.rejects(manager.spawn(port), /exited during startup \(code 17\)/u)
  assert.equal(lines.some((line) => line.includes('apiKey=<redacted>')), true)
  assert.equal(lines.some((line) => line.includes('fixture-secret')), false)
})

test('a process that never exposes a compatible host is stopped after the readiness timeout', async () => {
  const manager = new HostManager(silentLog, {
    executable: process.execPath,
    arguments: [fixtureCli, '--never-ready'],
    spawnReadyTimeoutMs: 100,
  })
  const [port] = await consecutivePorts()
  await assert.rejects(manager.spawn(port), /did not become ready.+within 100ms/u)
})
