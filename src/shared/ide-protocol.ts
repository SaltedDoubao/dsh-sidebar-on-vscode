import { z } from 'zod'

/** First interoperable version of the IDE Context Bridge protocol. */
export const IDE_PROTOCOL_VERSION = 1 as const

export const idePositionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
})

export const ideRangeSchema = z.object({
  start: idePositionSchema,
  end: idePositionSchema,
})

export const workspaceContextSchema = z.object({
  roots: z.array(z.object({
    uri: z.string().min(1),
    name: z.string(),
    path: z.string(),
  })),
  selectedRootUri: z.string().optional(),
})

export const editorContextSchema = z.object({
  uri: z.string().min(1),
  path: z.string().optional(),
  relativePath: z.string().optional(),
  languageId: z.string().optional(),
  isDirty: z.boolean(),
  isUntitled: z.boolean(),
})

export const selectionContextSchema = z.object({
  uri: z.string().min(1),
  range: ideRangeSchema,
  text: z.string(),
  truncated: z.boolean(),
  originalBytes: z.number().int().nonnegative(),
})

export const cursorContextSchema = z.object({
  uri: z.string().min(1),
  position: idePositionSchema,
})

export const ideContextSnapshotSchema = z.object({
  protocolVersion: z.literal(IDE_PROTOCOL_VERSION),
  snapshotId: z.string().uuid(),
  ideInstanceId: z.string().uuid(),
  workspace: workspaceContextSchema,
  activeEditor: editorContextSchema.optional(),
  selection: selectionContextSchema.optional(),
  cursor: cursorContextSchema.optional(),
  timestamp: z.number().int().nonnegative(),
})

export const ideDiagnosticSchema = z.object({
  uri: z.string().min(1),
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  message: z.string(),
  range: ideRangeSchema,
  source: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
})

export const ideCapabilitiesSchema = z.object({
  context: z.literal(true),
  selection: z.literal(true),
  diagnostics: z.boolean(),
  diff: z.boolean(),
  openFile: z.boolean(),
  notebook: z.boolean(),
  debugger: z.boolean(),
})

export const ideInfoSchema = z.object({
  protocolVersion: z.literal(IDE_PROTOCOL_VERSION),
  instanceId: z.string().uuid(),
  ide: z.literal('vscode'),
  ideVersion: z.string(),
  extensionVersion: z.string(),
  capabilities: ideCapabilitiesSchema,
  workspaceFolders: z.array(z.string()),
  selectedWorkspaceUri: z.string().optional(),
})

export const ideDiscoverySchema = ideInfoSchema.extend({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  transport: z.literal('ws'),
  authToken: z.string().min(32),
  updatedAt: z.number().int().nonnegative(),
})

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export type IdePosition = z.infer<typeof idePositionSchema>
export type IdeRange = z.infer<typeof ideRangeSchema>
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>
export type EditorContext = z.infer<typeof editorContextSchema>
export type SelectionContext = z.infer<typeof selectionContextSchema>
export type CursorContext = z.infer<typeof cursorContextSchema>
export type IdeContextSnapshot = z.infer<typeof ideContextSnapshotSchema>
export type IdeDiagnostic = z.infer<typeof ideDiagnosticSchema>
export type IdeCapabilities = z.infer<typeof ideCapabilitiesSchema>
export type IdeInfo = z.infer<typeof ideInfoSchema>
export type IdeDiscovery = z.infer<typeof ideDiscoverySchema>

export interface IdeRpcMap {
  'ide/describe': { params: Record<string, never>; result: IdeInfo }
  'ide/getContext': { params: { snapshotId?: string }; result: IdeContextSnapshot }
  'ide/getWorkspaceFolders': { params: Record<string, never>; result: WorkspaceContext }
  'ide/getDiagnostics': { params: { uri?: string }; result: { items: IdeDiagnostic[]; truncated: boolean } }
  'ide/openFile': { params: { uri: string; position?: IdePosition }; result: { opened: true } }
  'ide/showDiff': { params: { uri: string; original: string; modified: string; title?: string }; result: { shown: true } }
}

export type IdeRpcMethod = keyof IdeRpcMap

