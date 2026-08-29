/**
 * Runtime stub for the `vscode` module (E2E only). Bundled in place of the
 * real vscode module via esbuild `alias`, so the REAL extension host code
 * (Bridge / DshClient / HostManager / OverlayRetention) runs under the
 * Playwright harness without the VSCode runtime. Only the surface the
 * bundled code touches is implemented; anything else stays undefined and a
 * touch would throw loudly. Programmatic accessors let tests control the
 * active editor (IDE insertion) and record error notifications.
 */

/** Minimal editor shape the bridge's `handleIdeRequest` reads. */
export interface StubTextEditor {
  document: {
    getText(selection?: unknown): string
    uri: { fsPath: string }
  }
  selection: { isEmpty: boolean; start?: { line: number }; end?: { line: number } }
}

const errorMessages: string[] = []
const warningMessages: string[] = []
const activeEditorListeners = new Set<(editor: StubTextEditor | undefined) => void>()
const selectionListeners = new Set<(event: { textEditor: StubTextEditor }) => void>()

export const window = {
  /** Programmable active editor; tests set it to exercise IDE insertion. */
  activeTextEditor: undefined as StubTextEditor | undefined,
  onDidChangeActiveTextEditor: (listener: (editor: StubTextEditor | undefined) => void): Disposable => {
    activeEditorListeners.add(listener)
    return new Disposable(() => activeEditorListeners.delete(listener))
  },
  onDidChangeTextEditorSelection: (listener: (event: { textEditor: StubTextEditor }) => void): Disposable => {
    selectionListeners.add(listener)
    return new Disposable(() => selectionListeners.delete(listener))
  },
  showErrorMessage: (message: string): Promise<void> => {
    errorMessages.push(message)
    return Promise.resolve()
  },
  showWarningMessage: (message: string): Promise<void> => {
    warningMessages.push(message)
    return Promise.resolve()
  },
  showInformationMessage: (): Promise<void> => Promise.resolve(),
  showSaveDialog: (): Promise<undefined> => Promise.resolve(undefined),
  createOutputChannel: () => ({ appendLine: (): void => undefined, append: (): void => undefined }),
}

const configuration = new Map<string, unknown>([['deepseekHarness.ideContext.enabled', true]])

export const workspace = {
  /** Programmable workspace root (session ownership anchor of the bridge). */
  workspaceFolders: undefined as { name: string; uri: { fsPath: string; toString(): string } }[] | undefined,
  getConfiguration: (section = '') => ({
    get: <T>(key: string, fallback?: T): T | undefined => (configuration.get(`${section}.${key}`) as T | undefined) ?? fallback,
    update: (key: string, value: unknown): Promise<void> => {
      configuration.set(`${section}.${key}`, value)
      return Promise.resolve()
    },
  }),
  fs: { writeFile: (): Promise<void> => Promise.resolve() },
  openTextDocument: (): Promise<never> => Promise.reject(new Error('not implemented in E2E stub')),
}

export const ConfigurationTarget = { Global: 1 }
export const commands = { executeCommand: (): Promise<void> => Promise.resolve() }
export const env = {
  language: 'en',
  openExternal: (): Promise<boolean> => Promise.resolve(true),
}

export const l10n = {
  t: (message: string, values?: Record<string, unknown>): string => {
    if (values === undefined) return message
    return message.replace(/\{([^}]+)\}/g, (match, key: string) => String(values[key] ?? match))
  },
}

export class Disposable {
  static from(...disposables: Array<{ dispose(): void }>): Disposable {
    return new Disposable(() => {
      for (const disposable of disposables) disposable.dispose()
    })
  }
  constructor(private readonly onDispose?: () => void) {}
  dispose(): void {
    this.onDispose?.()
  }
}

export const Uri = {
  joinPath: (base: unknown, ...parts: string[]): unknown => ({ base, parts }),
  file: (fsPath: string): { fsPath: string; scheme: string } => ({ fsPath, scheme: 'file' }),
  parse: (value: string): { scheme: string; value: string } => ({ scheme: value.split(':', 1)[0] ?? '', value }),
}

/** Test control: point the stub at an editor (or clear it — mirrors the real
 * vscode API, where the active editor is `undefined` when none is open). */
export function setActiveEditor(editor: StubTextEditor | null): void {
  window.activeTextEditor = editor ?? undefined
  for (const listener of activeEditorListeners) listener(window.activeTextEditor)
  if (window.activeTextEditor !== undefined) {
    for (const listener of selectionListeners) listener({ textEditor: window.activeTextEditor })
  }
}

/** Test control: notifications the extension host raised via the stub. */
export function errorNotifications(): string[] {
  return [...errorMessages]
}
