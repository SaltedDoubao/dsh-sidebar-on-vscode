import * as vscode from 'vscode'
import { parseAllowedUri } from './resource-policy'

const DIFF_SCHEME = 'dsh-ide-diff'
const MAX_SIDE_BYTES = 2 * 1024 * 1024
const DIFF_TTL_MS = 10 * 60_000

interface DiffEntry {
  original: string
  modified: string
  timer: ReturnType<typeof setTimeout>
}

/** Read-only in-memory documents used by VS Code's native diff editor. */
export class IdeDiffProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly entries = new Map<string, DiffEntry>()
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.emitter.event
  private readonly registration: vscode.Disposable

  constructor() {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this)
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const entry = this.entries.get(uri.authority)
    if (entry === undefined) return ''
    return uri.path === '/modified' ? entry.modified : entry.original
  }

  async show(uriText: string, original: string, modified: string, title?: string): Promise<void> {
    const target = parseAllowedUri(uriText)
    if (Buffer.byteLength(original, 'utf8') > MAX_SIDE_BYTES || Buffer.byteLength(modified, 'utf8') > MAX_SIDE_BYTES) {
      throw new Error('Diff content exceeds the 2 MiB per-side limit')
    }
    const id = crypto.randomUUID()
    const timer = setTimeout(() => this.delete(id), DIFF_TTL_MS)
    timer.unref?.()
    this.entries.set(id, { original, modified, timer })
    const query = `target=${encodeURIComponent(target.toString())}`
    const left = vscode.Uri.parse(`${DIFF_SCHEME}://${id}/original?${query}`)
    const right = vscode.Uri.parse(`${DIFF_SCHEME}://${id}/modified?${query}`)
    await vscode.commands.executeCommand('vscode.diff', left, right, title ?? `DSH Diff: ${target.path.split('/').pop() ?? target.toString()}`, { preview: true })
  }

  dispose(): void {
    for (const id of this.entries.keys()) this.delete(id)
    this.registration.dispose()
    this.emitter.dispose()
  }

  private delete(id: string): void {
    const entry = this.entries.get(id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    this.entries.delete(id)
  }
}

