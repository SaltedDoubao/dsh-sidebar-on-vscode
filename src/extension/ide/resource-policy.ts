import * as path from 'node:path'
import * as vscode from 'vscode'

/** True when a filesystem path is equal to, or contained by, a workspace root. */
export function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/** Resources exposed to reverse IDE actions: workspace resources or documents already open in this window. */
export function isAllowedResource(uri: vscode.Uri): boolean {
  if (vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri.toString())) return true
  if (uri.scheme !== 'file') return false
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => isInsidePath(folder.uri.fsPath, uri.fsPath))
}

export function parseAllowedUri(raw: string): vscode.Uri {
  const uri = vscode.Uri.parse(raw, true)
  if (!isAllowedResource(uri)) throw new Error('IDE resource is outside the workspace and is not currently open')
  return uri
}

