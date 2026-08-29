import * as vscode from 'vscode'
import type { IdeDiagnostic } from '../../shared/ide-protocol'
import { parseAllowedUri } from './resource-policy'

const MAX_DIAGNOSTICS = 200
const MAX_DIAGNOSTIC_BYTES = 256 * 1024

/** Bounded adapter over VS Code's Problems/diagnostics API. */
export class IdeDiagnosticsProvider {
  get(uriText?: string): { items: IdeDiagnostic[]; truncated: boolean } {
    const target = uriText === undefined
      ? vscode.window.activeTextEditor?.document.uri
      : parseAllowedUri(uriText)
    if (target === undefined) return { items: [], truncated: false }
    if (uriText === undefined && !isOpen(target)) return { items: [], truncated: false }

    const items: IdeDiagnostic[] = []
    let bytes = 0
    let truncated = false
    for (const diagnostic of vscode.languages.getDiagnostics(target)) {
      const item: IdeDiagnostic = {
        uri: target.toString(),
        severity: severity(diagnostic.severity),
        message: diagnostic.message,
        range: {
          start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
          end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
        },
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
        ...(diagnostic.code === undefined
          ? {}
          : { code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code }),
      }
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8')
      if (items.length >= MAX_DIAGNOSTICS || bytes + size > MAX_DIAGNOSTIC_BYTES) {
        truncated = true
        break
      }
      items.push(item)
      bytes += size
    }
    return { items, truncated }
  }
}

function isOpen(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri.toString())
}

function severity(value: vscode.DiagnosticSeverity): IdeDiagnostic['severity'] {
  if (value === vscode.DiagnosticSeverity.Error) return 'error'
  if (value === vscode.DiagnosticSeverity.Warning) return 'warning'
  if (value === vscode.DiagnosticSeverity.Information) return 'info'
  return 'hint'
}

