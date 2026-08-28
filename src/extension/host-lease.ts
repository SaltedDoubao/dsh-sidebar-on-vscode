import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import type { HostInfo } from './host-manager'

const execFileAsync = promisify(execFile)

const HEARTBEAT_MS = 5_000
const STALE_MS = 20_000

interface WindowLease {
  instanceId: string
  pid: number
  touchedAt: number
}

interface HostOwnership {
  marker: 'local.dsh-sidebar-on-vscode'
  instanceId: string
  pid: number
  port: number
  startedAt: number
}

/** File-backed coordination between VS Code windows sharing globalStorage. */
export class HostLeaseCoordinator {
  readonly instanceId = crypto.randomUUID()
  private readonly leasesDirectory: string
  private readonly ownershipPath: string
  private heartbeat: ReturnType<typeof setInterval> | null = null

  constructor(private readonly storagePath: string, private readonly log: (line: string) => void) {
    this.leasesDirectory = path.join(storagePath, 'window-leases')
    this.ownershipPath = path.join(storagePath, 'host-ownership.json')
  }

  async start(): Promise<void> {
    await mkdir(this.leasesDirectory, { recursive: true })
    await this.writeLease()
    this.heartbeat = setInterval(() => void this.writeLease(), HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  async publishOwnedHost(info: HostInfo): Promise<void> {
    if (!info.spawnedByUs || info.pid === undefined) return
    const ownership: HostOwnership = {
      marker: 'local.dsh-sidebar-on-vscode',
      instanceId: this.instanceId,
      pid: info.pid,
      port: info.port,
      startedAt: Date.now(),
    }
    await mkdir(this.storagePath, { recursive: true })
    await writeFile(this.ownershipPath, JSON.stringify(ownership), { encoding: 'utf8', mode: 0o600 })
  }

  async releaseAndIsLast(): Promise<boolean> {
    if (this.heartbeat !== null) clearInterval(this.heartbeat)
    this.heartbeat = null
    await rm(this.leasePath(), { force: true })
    return (await this.liveLeases()).length === 0
  }

  async stopRecordedHost(probe: (port: number) => Promise<boolean>): Promise<boolean> {
    const ownership = await this.readOwnership()
    if (ownership === null || !processAlive(ownership.pid)) {
      await rm(this.ownershipPath, { force: true })
      return false
    }
    if (!(await probe(ownership.port)) || !(await processOwnsPort(ownership.pid, ownership.port))) {
      this.log('[host-lease] ownership record failed Host/PID/port verification; refusing to signal the process')
      return false
    }
    try {
      process.kill(ownership.pid)
      await rm(this.ownershipPath, { force: true })
      this.log(`[host-lease] stopped verified shared Host pid=${String(ownership.pid)} port=${String(ownership.port)}`)
      return true
    } catch (error) {
      this.log(`[host-lease] failed to stop verified shared Host: ${String(error)}`)
      return false
    }
  }

  async clearOwnershipIf(instanceId: string): Promise<void> {
    const ownership = await this.readOwnership()
    if (ownership?.instanceId === instanceId) await rm(this.ownershipPath, { force: true })
  }

  private async writeLease(): Promise<void> {
    const lease: WindowLease = { instanceId: this.instanceId, pid: process.pid, touchedAt: Date.now() }
    await mkdir(this.leasesDirectory, { recursive: true })
    await writeFile(this.leasePath(), JSON.stringify(lease), { encoding: 'utf8', mode: 0o600 })
  }

  private leasePath(): string {
    return path.join(this.leasesDirectory, `${this.instanceId}.json`)
  }

  private async liveLeases(): Promise<WindowLease[]> {
    let names: string[]
    try {
      names = await readdir(this.leasesDirectory)
    } catch {
      return []
    }
    const live: WindowLease[] = []
    for (const name of names) {
      const file = path.join(this.leasesDirectory, name)
      try {
        const lease = JSON.parse(await readFile(file, 'utf8')) as Partial<WindowLease>
        if (typeof lease.instanceId !== 'string' || typeof lease.pid !== 'number' || typeof lease.touchedAt !== 'number') throw new Error('invalid lease')
        if (Date.now() - lease.touchedAt > STALE_MS || !processAlive(lease.pid)) {
          await rm(file, { force: true })
          continue
        }
        live.push(lease as WindowLease)
      } catch {
        await rm(file, { force: true })
      }
    }
    return live
  }

  private async readOwnership(): Promise<HostOwnership | null> {
    try {
      const parsed = JSON.parse(await readFile(this.ownershipPath, 'utf8')) as Partial<HostOwnership>
      if (parsed.marker !== 'local.dsh-sidebar-on-vscode'
        || typeof parsed.instanceId !== 'string'
        || typeof parsed.pid !== 'number'
        || typeof parsed.port !== 'number'
        || typeof parsed.startedAt !== 'number') return null
      return parsed as HostOwnership
    } catch {
      return null
    }
  }
}

async function processOwnsPort(pid: number, port: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'TCP'], { windowsHide: true })
      return stdout.split(/\r?\n/u).some((line) => {
        const columns = line.trim().split(/\s+/u)
        if (columns.length < 5 || columns[0]?.toUpperCase() !== 'TCP' || columns[3]?.toUpperCase() !== 'LISTENING') return false
        const local = columns[1] ?? ''
        const loopback = local.startsWith('127.0.0.1:') || local.startsWith('[::1]:')
        return loopback && local.endsWith(`:${String(port)}`) && columns[4] === String(pid)
      })
    }
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'])
      return stdout.split(/\r?\n/u).some((row) => row.trim() === String(pid))
    } catch {
      const { stdout } = await execFileAsync('ss', ['-ltnp'])
      return stdout.split(/\r?\n/u).some((line) =>
        (line.includes(`127.0.0.1:${String(port)}`) || line.includes(`[::1]:${String(port)}`))
        && line.includes(`pid=${String(pid)}`),
      )
    }
  } catch {
    // Verification tooling missing or denied: safe failure means the recorded
    // process is left running and can be stopped explicitly by its owner.
    return false
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
