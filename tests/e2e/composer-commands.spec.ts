/**
 * Composer command-surface E2E against the REAL host:
 *   1. Slash commands: typing `/` pops the built-in host command suggestions
 *      (/goal, /compact, /plan) above the skill catalog; Escape dismisses the
 *      popup; picking inserts the token; sending a `/`-line delivers it as
 *      a durable command-input/result pair. It never reaches the model.
 *   2. Esc interrupt (live): with a real turn streaming, Escape cancels the
 *      turn (same action as the stop button). Skipped when the model does not
 *      start generating within the window (natural-trigger resilience, per
 *      the agreed E2E policy).
 */

import { test as base, expect, type Page } from 'playwright/test'
import { startHarness, type Harness } from '../../.temp/e2e-dist/harness.mjs'

const test = base.extend<{}, { harness: Harness }>({
  harness: [
    async ({}, use) => {
      const harness = await startHarness()
      try {
        await use(harness)
      } finally {
        await harness.stop()
      }
    },
    { scope: 'worker', auto: true },
  ],
})

async function openApp(page: Page, harness: Harness): Promise<void> {
  await page.goto(harness.pageUrl)
  await expect(page.locator('.chat-list')).toBeVisible()
}

test('slash popup lists host commands, Escape dismisses, picking inserts, sending delivers the line', async ({ page, harness }) => {
  await harness.createSession(harness.workspacePath, 'SLASH-CMD')
  await openApp(page, harness)
  await page.locator('.session-row', { hasText: 'SLASH-CMD' }).click()
  const input = page.locator('.composer-input')
  await expect(input).toBeVisible()

  // Typing "/" pops the Host-authoritative command directory.
  await input.fill('/')
  const popup = page.locator('.composer-suggest')
  await expect(popup).toBeVisible()
  const labels = await page.locator('.composer-suggest-label').allTextContents()
  expect(labels).toEqual(expect.arrayContaining(['/goal', '/compact', '/plan']))

  // Escape dismisses the popup without touching the draft.
  await input.press('Escape')
  await expect(popup).not.toBeVisible()
  await expect(input).toHaveValue('/')

  // Filtering narrows to the matching command (skills whose description also
  // matches may follow); Enter picks the highlight into the draft.
  await input.fill('/go')
  await expect(popup).toBeVisible()
  await expect(page.locator('.composer-suggest-label').first()).toHaveText('/goal')
  await input.press('Enter')
  await expect(input).toHaveValue('/goal ')

  // Sending executes through commands/execute. /goal owns the only
  // user-style command-input projection; the generic result is a command card.
  await input.fill('/goal 完成斜杠命令的 E2E 验证')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(page.locator('.command-input-row').last()).toContainText('/goal 完成斜杠命令的 E2E 验证', { timeout: 10_000 })
  await expect(page.locator('.command-card[data-command="goal"]').last()).toBeVisible()
})

test('real permission switch uses the command plane and waits for the projection', async ({ page, harness }) => {
  await harness.createSession(harness.workspacePath, 'PERMISSION-CMD')
  await openApp(page, harness)
  await page.locator('.session-row', { hasText: 'PERMISSION-CMD' }).click()

  const permission = page.locator('.permission-trigger')
  await expect(permission).toBeEnabled()
  await permission.click()
  const readOnly = page.locator('.permission-menu .composer-menu-item').first()
  await expect(readOnly).toContainText('只读')
  await readOnly.click()

  await expect(permission).toContainText('只读', { timeout: 10_000 })
  await expect(page.locator('.command-card[data-command="permission"]')).toHaveCount(0)
  await expect(page.locator('.msg-user', { hasText: '/permission' })).toHaveCount(0)

  // The lifecycle is durable in the Host log, but remains absent when the
  // conversation is reconstructed from history after a Webview reload.
  await page.reload()
  await expect(page.locator('.chat-list')).toBeVisible()
  await page.locator('.session-row', { hasText: 'PERMISSION-CMD' }).click()
  await expect(page.locator('.permission-trigger')).toContainText('只读', { timeout: 10_000 })
  await expect(page.locator('.command-card[data-command="permission"]')).toHaveCount(0)
  await expect(page.locator('.msg-user', { hasText: '/permission' })).toHaveCount(0)
})

test('Escape interrupts the running turn (live)', async ({ page, harness }, testInfo) => {
  test.skip(process.env.DSH_E2E_LIVE !== '1', 'set DSH_E2E_LIVE=1 with isolated test credentials to run live model coverage')
  test.setTimeout(240_000)
  await harness.createSession(harness.workspacePath, 'ESC-INT')
  await openApp(page, harness)
  await page.locator('.session-row', { hasText: 'ESC-INT' }).click()
  const input = page.locator('.composer-input')
  await expect(input).toBeVisible()

  await input.fill('请分 5 段详细描述你作为编码助手的能力，每段不少于 50 字')
  await input.press('Enter')

  const stop = page.locator('.composer-primary[aria-label="停止生成"]')
  try {
    await expect(stop).toBeVisible({ timeout: 120_000 })
  } catch {
    testInfo.skip(true, '模型未在窗口内开始生成（自然触发不可控），跳过 Esc 打断验证')
    return
  }

  // Escape while running cancels the turn: the stop button reverts to send.
  await input.press('Escape')
  await expect(page.locator('.composer-primary[aria-label="发送"]')).toBeVisible({ timeout: 60_000 })
  await expect(stop).not.toBeVisible()
})
