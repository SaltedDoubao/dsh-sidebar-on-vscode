/**
 * StatsLine (owned by W4): the one-line muted summary under the composer
 * card — turns/steps, LLM/tool wall time, TTFT/decode speed, cache-hit rate,
 * billed tokens. Every figure rides the store's durable whole-log projections
 * (sessionStats / tokenUsage), so paging and compaction cannot change them.
 * Pure helpers mirror the dsh web StatsLine. Pipe-separated groups; a group
 * with no data drops out whole, and a fully empty line renders null.
 * Contract: ARCHITECTURE.md section 5.3 — no props, reads the store slices.
 */

import type { JSX } from 'react'
import type {
  SessionStatsProjection,
  TokenUsageProjection,
} from '../../../extension/protocol/projections'
import { useAppStore } from '../../store'

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/**
 * Compact decode throughput: one decimal under 10 tok/s, rounded from there on.
 * @param tps - tokens per second.
 * @returns display string.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0
    ? null
    : Math.round(usage.cacheReadTokens / denominator * 100)
}

/** Pipe-separated stat groups built from the sessionStats projection. */
export function statsGroups(stats: SessionStatsProjection, zh = false): string[] {
  const groups: string[] = []
  if (stats.steps === 0) return groups
  groups.push(zh ? `${stats.turns} 轮次 · ${stats.steps} 步骤` : `${stats.turns} turns · ${stats.steps} steps`)
  const durations: string[] = []
  if (stats.llmMs > 0) durations.push(`${zh ? '模型耗时' : 'LLM'} ${formatDuration(stats.llmMs)}`)
  if (stats.toolMs > 0) durations.push(`${zh ? '工具调用' : 'Tool call'} ${formatDuration(stats.toolMs)}`)
  if (durations.length > 0) groups.push(durations.join(' · '))
  const speeds: string[] = []
  if (stats.ttftSteps > 0) {
    speeds.push(`${zh ? '首字延迟均值' : 'TTFT avg'} ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
  }
  if (stats.decodeMs > 0) {
    speeds.push(`${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`)
  }
  if (speeds.length > 0) groups.push(speeds.join(' · '))
  return groups
}

export function StatsLine(): JSX.Element | null {
  const stats = useAppStore((s) => s.sessionStats)
  const usage = useAppStore((s) => s.tokenUsage)
  const zh = useAppStore((s) => s.uiPrefs.language === 'zh')
  const groups: string[] = stats === null ? [] : statsGroups(stats, zh)
  // Billing rides the durable projection, so these survive paging and
  // compaction. Gated on actual token activity: a session whose steps all
  // settled without billing shows its counts without a zero-token group.
  if (usage !== null && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(`${zh ? '缓存命中' : 'Cache hit'} ${cacheHit}%`)
    groups.push(`${zh ? '输入' : 'Input'} ${formatTokens(billedInputTokens(usage))} tok · ${zh ? '输出' : 'Output'} ${formatTokens(usage.outputTokens)} tok`)
  }
  if (groups.length === 0) return null
  return <div className="stats-line">{groups.join(' | ')}</div>
}
