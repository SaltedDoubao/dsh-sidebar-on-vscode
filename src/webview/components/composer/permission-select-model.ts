import type { PermissionSelectProjection } from '../../../extension/protocol/projections'
import type { PermissionMode } from '../../types'

export const FULL_ACCESS_PERMISSION = 'danger-full-access'

/** Build the selector value shown before a history session has been selected. */
export function defaultPermissionProjection(mode: PermissionMode): PermissionSelectProjection {
  return {
    currentValue: mode === 'full-access' ? FULL_ACCESS_PERMISSION : mode,
    options: [
      { value: 'read-only', name: 'Read only' },
      { value: 'workspace-write', name: 'Workspace write' },
      { value: FULL_ACCESS_PERMISSION, name: 'Full access' },
    ],
  }
}
