import { test as base, expect } from 'playwright/test'
import { startHarness, type Harness } from '../../.temp/e2e-dist/harness.mjs'

const test = base.extend<{}, { settingsHarness: Harness }>({
  settingsHarness: [
    async ({}, use) => {
      const harness = await startHarness()
      try { await use(harness) } finally { await harness.stop() }
    },
    { scope: 'worker', auto: true },
  ],
})

test('independent settings surface has no legacy modal and navigates all sections', async ({ page, settingsHarness }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto(settingsHarness.settingsPageUrl)
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.settings-overlay, .settings-dialog, .settings-mask')).toHaveCount(0)
  await expect(page.locator('.app-shell, .chat-list, .composer-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Open config file|打开配置文件/ })).toBeVisible()

  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(4)
  await expect(page.locator('[data-region="GeneralSection"]')).toBeVisible()
  await tabs.nth(1).click()
  await expect(page.locator('[data-region="ModelsSection"]')).toBeVisible()
  await tabs.nth(2).click()
  await expect(page.locator('[data-region="PluginsSection"]')).toBeVisible()
  await expect(page.locator('.settings-tabs')).toBeVisible()
  await tabs.nth(3).click()
  await expect(page.locator('[data-region="PresetsSection"]')).toBeVisible()
})

test('settings layout switches from editor rail to compact top navigation', async ({ page, settingsHarness }) => {
  await page.setViewportSize({ width: 640, height: 640 })
  await page.goto(settingsHarness.settingsPageUrl)
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 60_000 })
  expect(await page.locator('.settings-page').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBeGreaterThan(1)

  await page.setViewportSize({ width: 480, height: 640 })
  await expect.poll(() => page.locator('.settings-nav-list').evaluate((node) => getComputedStyle(node).flexDirection)).toBe('row')
  expect(await page.locator('.settings-page').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1)
})
