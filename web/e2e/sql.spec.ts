import { readFileSync } from 'node:fs'
import { allowConsole, apiPost, expect, expectReady, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('/sql')
  await expectReady(page, 'SQL Library')
})

const library = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Query library' })
const queries = (page: import('@playwright/test').Page) => library(page).locator('button[aria-current]')

test('lists all 24 documented queries and filters them by search', async ({ page }) => {
  await expect(queries(page)).toHaveCount(24)
  await page.getByLabel('Search queries').fill('cohort')
  await expect.poll(() => queries(page).count()).toBeLessThan(24)
  expect(await queries(page).count()).toBeGreaterThan(0)
  await page.getByLabel('Search queries').fill('zzzz-no-such-query')
  await expect(queries(page)).toHaveCount(0)
  await page.getByLabel('Search queries').fill('')
  await expect(queries(page)).toHaveCount(24)
})

test('runs a query and downloads its result as CSV', async ({ page }) => {
  await queries(page).filter({ hasText: 'monthly_revenue' }).first().click()
  await expect(page.locator('main h2').filter({ hasText: 'monthly_revenue' })).toBeVisible()
  await page.getByRole('button', { name: 'Run with current filters' }).click()
  await expect(page.getByRole('heading', { name: /Result · [\d,]+ rows/ })).toBeVisible()
  await expect(page.locator('main table tbody tr').first()).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download result (CSV)' }).click()])
  expect(download.suggestedFilename()).toBe('monthly_revenue.csv')
  expect(readFileSync(await download.path(), 'utf8').split(/\r?\n/).filter(Boolean).length).toBeGreaterThan(1)
})

test('customer_orders needs a customer ID before it can run', async ({ page }) => {
  const top = await apiPost(page, '/api/sql/revenue_by_customer', {})
  expect(top.status).toBe(200)
  const idCol = top.json.result.columns.indexOf('customer_id')
  const customer = String(top.json.result.data[0][idCol])

  await queries(page).filter({ hasText: 'customer_orders' }).first().click()
  const run = page.getByRole('button', { name: 'Run with current filters' })
  await expect(run).toBeDisabled()
  await page.getByLabel('Customer ID (required)').fill(customer)
  await run.click()
  await expect(page.getByRole('heading', { name: /Result · [\d,]+ rows/ })).toBeVisible()
  await expect(page.locator('main table tbody tr').first()).toBeVisible()
})

test('the API runs only library files and keeps their SQL text private', async ({ page, consoleErrors }) => {
  const list = await page.evaluate(async () => (await fetch('/api/sql')).json())
  expect(list.queries).toHaveLength(24)
  expect(list.queries.every((q: Record<string, unknown>) => !('sql' in q))).toBe(true)
  expect((await apiPost(page, '/api/sql/no_such_query', {})).status).toBe(404)
  expect((await apiPost(page, '/api/sql/customer_orders', {})).status).toBe(422)
  allowConsole(consoleErrors, /status of (404|422)/) // the refusals this test provokes
})
