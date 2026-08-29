import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IdeDiscovery, IdeInfo } from '../../shared/ide-protocol'

const HEARTBEAT_MS = 5_000

/** Publishes one user-private, atomically replaced IDE discovery record. */
export class IdeDiscoveryPublisher {
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private current: IdeDiscovery | null = null
  readonly directory = path.join(process.env['DSH_HOME']?.trim() || path.join(os.homedir(), '.dsh'), 'ide')

  constructor(private readonly log: (line: string) => void) {}

  async start(info: IdeInfo, port: number, authToken: string): Promise<void> {
    this.current = { ...info, pid: process.pid, port, transport: 'ws', authToken, updatedAt: Date.now() }
    await this.write()
    this.heartbeat = setInterval(() => void this.write(), HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  async update(info: IdeInfo): Promise<void> {
    if (this.current === null) return
    this.current = { ...this.current, ...info, updatedAt: Date.now() }
    await this.write()
  }

  async dispose(): Promise<void> {
    if (this.heartbeat !== null) clearInterval(this.heartbeat)
    this.heartbeat = null
    const file = this.current === null ? null : this.file(this.current.instanceId)
    this.current = null
    if (file !== null) await rm(file, { force: true }).catch((error) => this.log(`[ide-discovery] cleanup failed: ${String(error)}`))
  }

  private async write(): Promise<void> {
    const current = this.current
    if (current === null) return
    current.updatedAt = Date.now()
    try {
      await mkdir(this.directory, { recursive: true })
      const target = this.file(current.instanceId)
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
    } catch (error) {
      this.log(`[ide-discovery] publish failed: ${String(error)}`)
    }
  }

  private file(instanceId: string): string {
    return path.join(this.directory, `${instanceId}.json`)
  }
}

