/**
 * Bridge facade: the single import surface for store slices and components.
 * Picks the real VSCode bridge (./api) or the mock (./mock/bridge) at startup.
 * Switch to mock: append `?mock` to the webview URL, or build with
 * VITE_DSH_MOCK=1.
 */

import type { BridgeClient } from './api'
import * as real from './api'
import { mockBridge } from './mock/bridge'

/** True when the mock bridge is selected (URL query `?mock`, VITE_DSH_MOCK=1, or a globalThis.__DSH_MOCK__ flag for tests). */
function selectMock(): boolean {
  if ((globalThis as { __DSH_MOCK__?: boolean }).__DSH_MOCK__ === true) return true
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mock')) return true
  return import.meta.env?.VITE_DSH_MOCK === '1'
}

/** Whether this webview runs on fake data. */
export const isMock = selectMock()

const client: BridgeClient = isMock ? mockBridge : real

export const rpc = client.rpc
export const onEvent = client.onEvent
export const onHostStatus = client.onHostStatus
export const onCommand = client.onCommand
export const onWorkspaceChanged = client.onWorkspaceChanged
export const waitInit = client.waitInit
export const respondApproval = client.respondApproval
export const respondQuestion = client.respondQuestion
export const onIdeContent = client.onIdeContent
export const requestIdeContent = client.requestIdeContent
export const fetchIdeContent = client.fetchIdeContent
export const onIdeContextMeta = client.onIdeContextMeta
export const requestIdeContextMeta = client.requestIdeContextMeta
export const addWorkspace = client.addWorkspace
export const selectWorkspace = client.selectWorkspace
export const openFolder = client.openFolder
export const exportSession = client.exportSession
export const openFile = client.openFile
export const openExternal = client.openExternal
export const setIdeContext = client.setIdeContext
export const setIdeContextEphemeral = client.setIdeContextEphemeral
export const setActiveSession = client.setActiveSession
export const waitSettingsInit = client.waitSettingsInit
export const onSettingsInit = client.onSettingsInit
export const onSettingsRefresh = client.onSettingsRefresh
export const onSettingsInitError = client.onSettingsInitError
export const openSettings = client.openSettings
export const closeSettings = client.closeSettings
