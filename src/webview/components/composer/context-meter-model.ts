import type { ContextBreakdownProjection, ContextPressureProjection } from '../../../extension/protocol/projections'

export interface ContextUsage {
  usedTokens: number
  contextWindow: number
  percent: number
}

export interface ContextSegment {
  key: string
  color: string
  width: number
}

export const CONTEXT_PARTS: Array<{ key: keyof ContextBreakdownProjection; color: string }> = [
  { key: 'systemTokens', color: 'system' },
  { key: 'toolsTokens', color: 'tools' },
  { key: 'messageTokens', color: 'messages' },
]

/** Resolve the provider sample used by both the ring and its detail panel. */
export function contextUsage(pressure: ContextPressureProjection | null): ContextUsage | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  if (usedTokens === undefined || contextWindow === undefined || contextWindow <= 0) return null
  return { usedTokens, contextWindow, percent: Math.max(0, Math.min(100, Math.round(usedTokens / contextWindow * 100))) }
}

export function contextOccupancy(pressure: ContextPressureProjection | null): number | null {
  return contextUsage(pressure)?.percent ?? null
}

/** Split the provider-exact occupied width by the heuristic composition. */
export function contextSegments(percent: number, breakdown: ContextBreakdownProjection | null): ContextSegment[] {
  if (percent <= 0) return []
  if (breakdown === null) return [{ key: 'total', color: '', width: percent }]
  const total = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  if (total <= 0) return []
  return CONTEXT_PARTS.map((row) => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / total })).filter((part) => part.width > 0)
}

export function contextTooltip(percent: number, zh: boolean): string {
  return zh ? `上下文已用: ${percent}%` : `Context used: ${percent}%`
}
