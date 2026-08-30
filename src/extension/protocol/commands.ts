/** Client-safe command-plane types mirrored from @deepseek-ai/dsh-commands. */

import type { CommandId, SessionId } from './brand'

export interface EncodedImageAttachment {
  mediaType: string
  data: string
  name?: string
}

export interface CommandInputDescriptor {
  hint: string
  images?: boolean
}

export interface CommandDescriptor {
  name: string
  description: string
  input?: CommandInputDescriptor
}

export type CommandResult =
  | { kind: 'success'; text?: string; sourceEventSeq?: number }
  | { kind: 'error'; text: string }

export interface CommandExecution {
  commandId: CommandId
  result: CommandResult
}

export type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

/** Wire rows use the generated Remote carrier's `{ args }` envelope. */
export interface CommandsRpc {
  'commands/list': {
    payload: { args: { agentId: SessionId } }
    /** DshClient unwraps the gateway's RemoteResult/ServerResponse boundary. */
    value: readonly CommandDescriptor[]
  }
  'commands/execute': {
    payload: { args: { agentId: SessionId; line: string; images: readonly EncodedImageAttachment[] } }
    value: CommandExecution | undefined
  }
}
