import { access, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { spawn as spawnChild, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type * as vscode from 'vscode'

const execFileAsync = promisify(execFile)

export interface HostInfo {
  port: number
  pid?: number
  spawnedByUs: boolean
  version?: string
}

export interface HostManagerOptions {
  autoStart?: boolean
  executable?: string
  arguments?: string[]
  onOwnedHost?: (info: HostInfo) => void | Promise<void>
  stopSharedOwnedHost?: (probe: (port: number) => Promise<boolean>) => Promise<boolean>
  /** Test seam; production always uses the ten-minute package-install budget. */
  spawnReadyTimeoutMs?: number
}

const PROBE_METHOD = 'host.describe'
const PORT_SCAN_LIMIT = 10
const PROBE_TIMEOUT_MS = 1500
const SPAWN_READY_TIMEOUT_MS = 600_000
const SPAWN_POLL_MS = 500
export const DSH_INSTALL_COMMAND = 'npm install -g @deepseek-ai/dsh'

/** Raised when no running Host or locally installed dsh executable exists. */
export class DshNotInstalledError extends Error {
  readonly installCommand = DSH_INSTALL_COMMAND

  constructor() {
    super(`DeepSeek Harness CLI is not installed. Run: ${DSH_INSTALL_COMMAND}`)
    this.name = 'DshNotInstalledError'
  }
}

const hostDescriptionSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  attachedSessions: z.number(),
  canOpenPath: z.boolean(),
}).passthrough()

const responseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.union([
    z.object({ ok: z.literal(true), value: hostDescriptionSchema }).passthrough(),
    z.object({ ok: z.literal(false), error: z.object({ message: z.string() }).passthrough() }).passthrough(),
  ]),
}).passthrough()

type Logger = Pick<vscode.OutputChannel, 'appendLine'>

/** Discovers and owns only Host processes spawned by this manager instance. */
export class HostManager {
  basePort = 3080
  autoStart: boolean
  executable: string
  arguments: string[]
  private child: ChildProcess | null = null
  private ownedInfo: HostInfo | null = null
  private readonly options: HostManagerOptions

  constructor(private readonly logger: Logger, options: HostManagerOptions = {}) {
    this.options = options
    this.autoStart = options.autoStart ?? true
    this.executable = options.executable?.trim() ?? ''
    this.arguments = [...(options.arguments ?? [])]
  }

  log(line: string): void {
    this.logger.appendLine(line)
  }

  async ensureHost(): Promise<HostInfo> {
    for (let port = this.basePort; port < this.basePort + PORT_SCAN_LIMIT; port += 1) {
      const description = await this.probeDescription(port)
      if (description !== null) {
        this.log(`[host-manager] compatible loopback Host found on 127.0.0.1:${port} (version ${description.version})`)
        return { port, spawnedByUs: false, version: description.version }
      }
    }
    if (!this.autoStart) throw new Error('No compatible loopback DeepSeek Harness Host was found and auto-start is disabled')
    const port = await this.firstFreePort()
    this.log(`[host-manager] no compatible Host found; starting one on 127.0.0.1:${port}`)
    return this.spawn(port)
  }

  async probe(port: number): Promise<boolean> {
    return (await this.probeDescription(port)) !== null
  }

  async probeDescription(port: number): Promise<z.infer<typeof hostDescriptionSchema> | null> {
    try {
      const rpcId = crypto.randomUUID()
      const response = await fetch(`http://127.0.0.1:${port}/api/${PROBE_METHOD}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: PROBE_METHOD, payload: {} }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.rpcId !== rpcId || !parsed.data.result.ok) return null
      return parsed.data.result.value
    } catch {
      return null
    }
  }

  async spawn(port: number): Promise<HostInfo> {
    const command = await this.resolveCommand()
    const customArguments = validateArguments(this.arguments)
    const args = [...command.args, ...customArguments, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open']
    this.log(`[host-manager] spawn: ${command.label} web --host 127.0.0.1 --port ${String(port)} --no-open`)
    const launch = platformLaunch(command.bin, args)
    const child = spawnChild(launch.bin, launch.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    this.child = child
    const spawnState: { error: Error | null } = { error: null }
    let stderrTail = ''
    child.once('error', (error) => {
      spawnState.error = error
      this.log(`[host-manager] failed to launch ${command.label}: ${redact(error.message)}`)
    })
    child.stdout?.on('data', (chunk: Buffer) => this.log(`[dsh] ${redact(chunk.toString().trimEnd())}`))
    child.stderr?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString()
      stderrTail = `${stderrTail}${raw}`.slice(-16_384)
      this.log(`[dsh:err] ${redact(raw.trimEnd())}`)
    })
    child.on('exit', (code) => {
      this.log(`[host-manager] owned Host exited with code ${String(code)}`)
      if (this.child === child) {
        this.child = null
        this.ownedInfo = null
      }
    })

    const readyTimeout = this.options.spawnReadyTimeoutMs ?? SPAWN_READY_TIMEOUT_MS
    const deadline = Date.now() + readyTimeout
    while (Date.now() < deadline) {
      if (spawnState.error !== null) {
        if (this.child === child) this.child = null
        throw new Error(`Unable to launch DeepSeek Harness Host with ${command.label}: ${spawnState.error.message}`)
      }
      if (child.exitCode !== null) {
        const detail = summarizeStderr(stderrTail)
        throw new Error(`DeepSeek Harness Host exited during startup (code ${String(child.exitCode)})${detail === '' ? '' : `: ${detail}`}`)
      }
      const description = await this.probeDescription(port)
      if (description !== null) {
        const info: HostInfo = { port, pid: child.pid, spawnedByUs: true, version: description.version }
        this.ownedInfo = info
        await this.options.onOwnedHost?.(info)
        return info
      }
      await new Promise((resolve) => setTimeout(resolve, SPAWN_POLL_MS))
    }
    if (this.child === child) {
      await terminateChild(child)
      if (this.child === child) this.child = null
    }
    throw new Error(`DeepSeek Harness Host did not become ready on port ${String(port)} within ${String(readyTimeout)}ms`)
  }

  /** Version is diagnostic only. Structural probes decide compatibility. */
  async checkVersion(info: HostInfo): Promise<string | null> {
    const description = await this.probeDescription(info.port)
    return description === null ? 'host.describe did not return the required core structure' : null
  }

  async stopOwned(): Promise<void> {
    const child = this.child
    const info = this.ownedInfo
    this.child = null
    this.ownedInfo = null
    if (child === null || info?.spawnedByUs !== true || child.exitCode !== null) {
      await this.options.stopSharedOwnedHost?.((port) => this.probe(port))
      return
    }
    // Re-probe the exact port before signalling. The ChildProcess identity is
    // the primary ownership proof; the probe prevents killing a stale PID after
    // an unexpected child exit/port takeover race.
    if (!(await this.probe(info.port))) {
      this.log('[host-manager] owned process no longer matches a compatible Host; refusing to signal it')
      return
    }
    this.log(`[host-manager] stopping owned Host pid=${String(child.pid)} port=${String(info.port)}`)
    await terminateChild(child)
    await this.options.stopSharedOwnedHost?.((port) => this.probe(port))
  }

  async restart(): Promise<void> {
    await this.stopOwned()
  }

  async dispose(): Promise<void> {
    await this.stopOwned()
  }

  private async firstFreePort(): Promise<number> {
    const net = await import('node:net')
    for (let port = this.basePort; port < this.basePort + PORT_SCAN_LIMIT; port += 1) {
      const free = await new Promise<boolean>((resolve) => {
        const server = net.createServer()
        server.once('error', () => resolve(false))
        server.once('listening', () => server.close(() => resolve(true)))
        server.listen(port, '127.0.0.1')
      })
      if (free) return port
    }
    throw new Error(`No free port in ${String(this.basePort)}..${String(this.basePort + PORT_SCAN_LIMIT - 1)}`)
  }

  private async resolveCommand(): Promise<{ bin: string; args: string[]; label: string }> {
    if (this.executable !== '') {
      const executable = await resolveConfiguredExecutable(this.executable)
      const direct = await directNpmCli(executable, '@deepseek-ai/dsh/lib/bin.js', ['--expose-internals'])
      if (direct !== null) return { ...direct, label: this.executable }
      rejectShellShim(executable)
      return {
        bin: executable,
        args: isNodeRuntime(executable) && !this.arguments.includes('--expose-internals') ? ['--expose-internals'] : [],
        label: this.executable,
      }
    }

    const dsh = await findOnPath('dsh')
    if (dsh !== null) {
      const direct = await directNpmCli(dsh, '@deepseek-ai/dsh/lib/bin.js', ['--expose-internals'])
      if (direct === null) rejectShellShim(dsh)
      return direct === null
        ? { bin: dsh, args: [], label: 'dsh (PATH)' }
        : { ...direct, label: 'dsh (PATH)' }
    }

    throw new DshNotInstalledError()
  }
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  let resolveExit: (() => void) | undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
    child.once('exit', resolve)
  })
  child.kill()
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 4_000)),
  ])
  if (graceful) return
  // The process is still the exact ChildProcess this manager spawned and was
  // re-probed above; escalation never targets a discovered/external Host.
  child.kill('SIGKILL')
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
  ])
  child.removeListener('exit', resolveExit!)
}

/** Resolve an explicit executable without invoking a shell. Absolute paths may
 * contain spaces; otherwise the value must be one plain command name on PATH. */
async function resolveConfiguredExecutable(value: string): Promise<string> {
  const executable = value.trim()
  if (path.isAbsolute(executable)) {
    await access(executable)
    return executable
  }
  if (executable.includes('/') || executable.includes('\\')) {
    throw new Error('deepseekHarness.host.executable must be an absolute path or a command name on PATH')
  }
  if (/\s|[|&;<>()`\r\n]/u.test(executable)) {
    throw new Error('deepseekHarness.host.executable must not contain arguments or shell operators; use deepseekHarness.host.arguments')
  }
  const resolved = await findOnPath(executable)
  if (resolved === null) throw new Error(`Configured DeepSeek Harness executable was not found on PATH: ${executable}`)
  return resolved
}

/** Extra arguments are passed literally, but cannot interfere with the
 * extension-owned subcommand, loopback address, or selected port. */
function validateArguments(values: readonly string[]): string[] {
  if (!Array.isArray(values)) throw new Error('deepseekHarness.host.arguments must be an array of strings')
  return values.map((value, index) => {
    if (typeof value !== 'string') throw new Error(`deepseekHarness.host.arguments[${String(index)}] must be a string`)
    const normalized = value.toLowerCase()
    if (normalized === 'web' || normalized === '--' || /^--(?:host|port)(?:=|$)/u.test(normalized)) {
      throw new Error(`deepseekHarness.host.arguments[${String(index)}] cannot override the managed web host or port`)
    }
    return value
  })
}

/** Batch and PowerShell shims require another command interpreter, which
 * would make otherwise literal user arguments subject to shell parsing. Known
 * npm shims are converted to their JavaScript entrypoint before this check. */
function rejectShellShim(executable: string): void {
  if (/\.(?:cmd|bat|ps1)$/iu.test(executable)) {
    throw new Error(`Cannot safely launch shell shim ${executable}; configure its underlying executable and script path separately`)
  }
}

/** npm's Windows shims create a wrapper process. Resolve known JS entrypoints
 * so the owned ChildProcess is the actual Host and can be stopped reliably. */
async function directNpmCli(
  shim: string,
  relativeCli: string,
  nodeArguments: readonly string[] = [],
): Promise<{ bin: string; args: string[] } | null> {
  let cli: string
  if (process.platform === 'win32' && /\.(?:cmd|bat|ps1)$/iu.test(shim)) {
    cli = path.join(path.dirname(shim), 'node_modules', ...relativeCli.split('/'))
  } else {
    try {
      const target = await realpath(shim)
      const expectedSuffix = path.normalize(relativeCli)
      if (!path.normalize(target).endsWith(expectedSuffix)) return null
      cli = target
    } catch {
      return null
    }
  }
  try {
    await access(cli)
  } catch {
    return null
  }
  const node = await resolveNodeRuntime(path.dirname(shim))
  return { bin: node, args: [...nodeArguments, cli] }
}

async function resolveNodeRuntime(shimDirectory: string): Promise<string> {
  const adjacentNode = path.join(shimDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
  try {
    await access(adjacentNode)
    return adjacentNode
  } catch {
    const fromPath = await findOnPath('node')
    if (fromPath !== null) {
      rejectShellShim(fromPath)
      return fromPath
    }
    return process.execPath
  }
}

function platformLaunch(bin: string, args: string[]): { bin: string; args: string[] } {
  return { bin, args }
}

function isNodeRuntime(executable: string): boolean {
  return /^node(?:\.exe)?$/iu.test(path.basename(executable))
}

async function findOnPath(name: string): Promise<string | null> {
  const rawPath = process.env['PATH'] ?? process.env['Path'] ?? ''
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1', ''] : ['']
  for (const rawDirectory of rawPath.split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/gu, '')
    if (directory === '') continue
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`)
      try {
        await access(candidate)
        return candidate
      } catch {
        // Continue through PATH in order.
      }
    }
  }
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFileAsync(finder, [name], { windowsHide: true })
    const rows = stdout.split(/\r?\n/u).map((row) => row.trim()).filter(Boolean)
    if (process.platform === 'win32') {
      return rows.find((row) => /\.(?:exe|cmd|bat)$/iu.test(row)) ?? rows[0] ?? null
    }
    return rows[0] ?? null
  } catch {
    return null
  }
}

/** Defensive log redaction for common credential-looking assignments. */
function redact(line: string): string {
  return line.replace(/((?:api[_-]?key|token|secret|authorization)\s*[=:]\s*)\S+/giu, '$1<redacted>')
}

function summarizeStderr(stderr: string): string {
  const lines = redact(stderr).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const error = lines.find((line) => /^Error:/u.test(line))
    ?? lines.find((line) => /(?:failed|required|not found|E[A-Z_]+)/u.test(line))
    ?? lines.at(-1)
    ?? ''
  return error.slice(0, 600)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as Error & { stderr?: unknown }).stderr
    const detail = typeof stderr === 'string' ? summarizeStderr(stderr) : ''
    return detail === '' ? error.message : `${error.message}: ${detail}`
  }
  return String(error)
}
