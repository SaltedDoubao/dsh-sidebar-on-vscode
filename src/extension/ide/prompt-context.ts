import * as vscode from 'vscode'
import { z } from 'zod'
import type { DshAdapter } from '../capabilities'
import { RpcBusinessError } from '../dsh-client'
import type { PromptContentPart } from '../protocol/sessions'
import type { IdeContextSnapshot } from '../../shared/ide-protocol'
import { IDE_PROTOCOL_VERSION } from '../../shared/ide-protocol'
import { IdeContextProvider } from './context-provider'

const CAPABILITY_CACHE_MS = 5_000
const LOG_RATE_LIMIT_MS = 30_000

const promptPayloadSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.enum(['queue', 'steer']),
  content: z.array(z.union([
    z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
    z.object({ type: z.literal('image') }).passthrough(),
  ])).min(1),
  clientTimeZone: z.string().optional(),
}).passthrough()

const runtimeDescriptionSchema = z.object({
  protocolVersion: z.literal(IDE_PROTOCOL_VERSION),
  features: z.object({
    ephemeralSnapshot: z.literal(true),
    rpcCorrelation: z.literal(true),
  }).passthrough(),
}).passthrough()

interface CapabilityCache {
  supported: boolean
  expiresAt: number
}

/** Owns the exact snapshot → staged runtime context → session.prompt transaction. */
export class IdePromptContext {
  private capability: CapabilityCache | null = null
  private readonly lastLog = new Map<string, number>()

  constructor(
    private readonly adapter: DshAdapter,
    private readonly provider: IdeContextProvider,
    private readonly log: (line: string) => void,
  ) {}

  async send(params: unknown): Promise<unknown> {
    const prompt = promptPayloadSchema.parse(params)
    const firstText = prompt.content.find((part): part is { type: 'text'; text: string } => part.type === 'text')
    const slashCommand = firstText !== undefined && firstText.text.startsWith('/')
    if (slashCommand) return this.adapter.rpc('session.prompt', prompt)

    const autoEnabled = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('ideContext.enabled', false)
    const explicit = firstText !== undefined && hasExplicitIdeContext(firstText.text)
    const snapshot = autoEnabled && !explicit ? this.provider.capture() : null
    const experimental = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('ideContext.ephemeral.enabled', false)

    if (!experimental || !(await this.supported())) {
      return this.adapter.rpc('session.prompt', withLegacyContext(prompt, snapshot))
    }

    const promptRpcId = crypto.randomUUID()
    const stage = {
      sessionId: prompt.sessionId,
      promptRpcId,
      ideInstanceId: this.provider.instanceId,
      snapshotId: snapshot?.snapshotId ?? null,
    }
    try {
      unwrapRemote(await this.adapter.rpc('ideContext/stage', { args: stage }))
    } catch (error) {
      this.capability = null
      this.logFallback('stage', error)
      return this.adapter.rpc('session.prompt', withLegacyContext(prompt, snapshot))
    }

    try {
      return await this.adapter.rpcWithId('session.prompt', prompt, promptRpcId)
    } catch (error) {
      // A business response proves the prompt was rejected. A transport error
      // is ambiguous, so never retry or unstage it automatically.
      if (error instanceof RpcBusinessError) {
        await this.adapter.rpc('ideContext/unstage', { args: { sessionId: prompt.sessionId, promptRpcId } }).catch(() => undefined)
      }
      throw error
    }
  }

  invalidateCapability(): void {
    this.capability = null
  }

  private async supported(): Promise<boolean> {
    const now = Date.now()
    if (this.capability !== null && this.capability.expiresAt > now) return this.capability.supported
    try {
      const value = unwrapRemote(await this.adapter.rpc('ideContext/describe', { args: {} }))
      const supported = runtimeDescriptionSchema.safeParse(value).success
      this.capability = { supported, expiresAt: now + CAPABILITY_CACHE_MS }
      if (!supported) this.logFallback('capability', new Error('incompatible ideContext.describe response'))
      return supported
    } catch (error) {
      this.capability = { supported: false, expiresAt: now + CAPABILITY_CACHE_MS }
      this.logFallback('capability', error)
      return false
    }
  }

  private logFallback(kind: string, error: unknown): void {
    const now = Date.now()
    const previous = this.lastLog.get(kind) ?? 0
    if (now - previous < LOG_RATE_LIMIT_MS) return
    this.lastLog.set(kind, now)
    this.log(`[ide-context] ephemeral ${kind} unavailable; using legacy injection (${safeError(error)})`)
  }
}

function withLegacyContext<T extends { content: Array<Record<string, unknown>> }>(prompt: T, snapshot: IdeContextSnapshot | null): T {
  if (snapshot === null) return prompt
  const block = legacyBlock(snapshot)
  if (block === null) return prompt
  let attached = false
  const content = prompt.content.map((part) => {
    if (attached || part['type'] !== 'text' || typeof part['text'] !== 'string') return part
    attached = true
    const text = part['text'].trim()
    return { ...part, text: text === '' ? block : `${text}\n\n${block}` }
  })
  return { ...prompt, content }
}

function legacyBlock(snapshot: IdeContextSnapshot): string | null {
  const editor = snapshot.activeEditor
  if (editor === undefined) return null
  const target = editor.relativePath ?? editor.path ?? editor.uri
  if (snapshot.selection !== undefined && snapshot.selection.text.trim() !== '') {
    return `### 选中代码（${target}）\n\n\`\`\`${editor.languageId ?? ''}\n${snapshot.selection.text}\n\`\`\``
  }
  return `### 当前文件：${target}`
}

function hasExplicitIdeContext(text: string): boolean {
  return /(?:^|\n)###\s+(?:选中代码|文件内容|当前文件|文件：)/u.test(text)
}

function safeError(error: unknown): string {
  if (error instanceof RpcBusinessError) return error.code
  if (error instanceof Error) return error.name
  return typeof error
}

function unwrapRemote(result: unknown): unknown {
  if (result === null || typeof result !== 'object' || !('ok' in result)) return result
  const remote = result as { ok?: unknown; value?: unknown; error?: { message?: unknown } }
  if (remote.ok === true) return remote.value
  throw new Error(typeof remote.error?.message === 'string' ? remote.error.message : 'DSH IDE Context Runtime remote failed')
}

// Keep the imported wire type checked against the parser without widening the
// runtime schema to the full vendored union.
void (null as PromptContentPart | null)
