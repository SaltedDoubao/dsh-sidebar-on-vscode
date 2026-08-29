import * as path from 'node:path'
import * as vscode from 'vscode'
import { IDE_PROTOCOL_VERSION, type IdeContextSnapshot, type WorkspaceContext } from '../../shared/ide-protocol'
import { isInsidePath } from './resource-policy'
import { truncateSelection } from './selection-budget'

const SELECTED_ROOT_KEY = 'deepseekHarness.selectedWorkspaceUri'
const SNAPSHOT_TTL_MS = 60_000

interface CachedSnapshot {
  snapshot: IdeContextSnapshot
  expiresAt: number
}

/** Captures immutable, bounded IDE context snapshots at prompt-send time. */
export class IdeContextProvider implements vscode.Disposable {
  private readonly snapshots = new Map<string, CachedSnapshot>()
  private readonly cleanup: ReturnType<typeof setInterval>

  constructor(
    readonly instanceId: string,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.cleanup = setInterval(() => this.prune(), 15_000)
    this.cleanup.unref?.()
  }

  workspaceContext(): WorkspaceContext {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      uri: folder.uri.toString(),
      name: folder.name,
      path: folder.uri.fsPath,
    }))
    const saved = this.context.workspaceState.get<string>(SELECTED_ROOT_KEY)
    const selected = roots.find((root) => root.uri === saved) ?? roots[0]
    return { roots, ...(selected === undefined ? {} : { selectedRootUri: selected.uri }) }
  }

  capture(): IdeContextSnapshot {
    const snapshotId = crypto.randomUUID()
    const workspace = this.workspaceContext()
    const editor = vscode.window.activeTextEditor
    const snapshot: IdeContextSnapshot = {
      protocolVersion: IDE_PROTOCOL_VERSION,
      snapshotId,
      ideInstanceId: this.instanceId,
      workspace,
      timestamp: Date.now(),
    }

    if (editor !== undefined) {
      const document = editor.document
      const uri = document.uri.toString()
      const filePath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined
      const owner = filePath === undefined
        ? undefined
        : [...workspace.roots]
          .filter((root) => isInsidePath(root.path, filePath))
          .sort((a, b) => b.path.length - a.path.length)[0]
      snapshot.activeEditor = {
        uri,
        ...(filePath === undefined ? {} : { path: filePath }),
        ...(owner === undefined || filePath === undefined ? {} : { relativePath: path.relative(owner.path, filePath) }),
        languageId: document.languageId,
        isDirty: document.isDirty,
        isUntitled: document.isUntitled,
      }
      snapshot.cursor = {
        uri,
        position: { line: editor.selection.active.line, character: editor.selection.active.character },
      }
      if (!editor.selection.isEmpty) {
        const original = document.getText(editor.selection)
        const bounded = truncateSelection(original)
        snapshot.selection = {
          uri,
          range: {
            start: { line: editor.selection.start.line, character: editor.selection.start.character },
            end: { line: editor.selection.end.line, character: editor.selection.end.character },
          },
          text: bounded.text,
          truncated: bounded.truncated,
          originalBytes: bounded.originalBytes,
        }
      }
    }

    this.snapshots.set(snapshotId, { snapshot, expiresAt: Date.now() + SNAPSHOT_TTL_MS })
    return snapshot
  }

  get(snapshotId: string): IdeContextSnapshot | undefined {
    const cached = this.snapshots.get(snapshotId)
    if (cached === undefined) return undefined
    if (cached.expiresAt <= Date.now()) {
      this.snapshots.delete(snapshotId)
      return undefined
    }
    return cached.snapshot
  }

  dispose(): void {
    clearInterval(this.cleanup)
    this.snapshots.clear()
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, entry] of this.snapshots) if (entry.expiresAt <= now) this.snapshots.delete(id)
  }
}
