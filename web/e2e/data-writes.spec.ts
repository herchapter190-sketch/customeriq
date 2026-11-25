import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { allowConsole, expect, expectReady, ROOT, test } from './fixtures'

/*
 * Replaces the dataset of the throwaway e2e server only (e2e/serve.py builds it under ROOT).
 * Runs after all read-only tests (project dependency) and in order, because each step changes the data.
 */
test.describe.configure({ mode: 'serial' })

const PORT = Number(process.env.CIQ_E2E_PORT || 8551)
const BACKUPS = path.join(ROOT, String(PORT), 'backups')
const backups = () => (existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => /^auto-customeriq-.*\.db$/.test(f)).length : 0)
const dataset = async (page: Page) => page.evaluate(async () => (await fetch('/api/dataset')).json())

const CSV = [
  'InvoiceNo,CustomerID,InvoiceDate,StockCode,Description,Quantity,UnitPrice,Country',
  '500001,E-1,2024-03-01 10:00,SKU-1,Mug,2,8.5,France',
  '500001,E-1,2024-03-01 10:00,SKU-2,Towel,1,6.0,France',
  '500002,E-2,2024-03-05 12:30,SKU-1,Mug,4,8.5,Spain',
  '500003,E-1,2024-04-02 09:15,SKU-3,Bowl,3,12.0,France',
  '500004,,2024-04-03 11:00,SKU-1,Mug,1,8.5,Spain', // missing customer: rejected
]
  // Data rows end with a delimiter the header lacks (common in spreadsheet exports); columns must stay aligned.
  .map((line, i) => (i ? line + ',' : line))
  .join('\n')

async function openTab(page: Page, name: string) {
  await page.goto('/data')
  await expectReady(page, 'Data Management')
  await page.getByRole('tab', { name }).click()
}

test('a file that cannot be read is refused without changing anything', async ({ page, consoleErrors }) => {
  const file = path.join(ROOT, 'notes.json')
  writeFileSync(file, '{}')
  const before = backups()
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByRole('alert')).toContainText('Unsupported file type')
  expect((await dataset(page)).meta.is_synthetic).toBe(true)
  expect(backups()).toBe(before)
  allowConsole(consoleErrors, /status of 400/) // the upload refusal this test provokes
})

test('import: preview, mapping and validation, then a confirmed commit with a verified backup', async ({ page }) => {
  const file = path.join(ROOT, 'e2e_import.csv')
  writeFileSync(file, CSV)
  const before = backups()
  // A large import outlasts the client's 60 s request timeout; the commit must keep waiting, not report a failure.
  await page.clock.install()
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/api/import/commit', async (route) => {
    await held
    await route.continue()
  })
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByRole('heading', { name: '1 · e2e_import.csv' })).toBeVisible()
  expect(backups(), 'preview writes nothing').toBe(before)

  const commit = page.getByRole('button', { name: 'Import and replace current dataset' })
  await expect(commit).toBeDisabled()
  await page.getByLabel('Replace the current dataset with this file.', { exact: false }).check()
  await commit.click()
  await page.clock.runFor(120_000)
  release()
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Imported 4 transaction lines.' })).toContainText('backed up first')

  const info = await dataset(page)
  expect(info.has_data).toBe(true)
  expect(info.meta.source_name).toBe('e2e_import.csv')
  expect(info.meta.is_synthetic).toBe(false)
  // Shifted columns would put prices in Quantity and countries in UnitPrice.
  expect(info.overview).toMatchObject({ customers: 2, countries: 2, net_revenue: 93 })
  expect(backups()).toBe(before + 1)
})

test('demo data replaces the imported file', async ({ page }) => {
  test.setTimeout(90_000)
  const before = backups()
  await openTab(page, 'Try the demo data')
  await page.getByLabel('Customers to simulate (200–6,000)').fill('200')
  const load = page.getByRole('button', { name: 'Load synthetic demo dataset' })
  await expect(load).toBeDisabled()
  await page.getByLabel('Replace the current dataset with synthetic demo data.', { exact: false }).check()
  await load.click()
  await expect.poll(async () => (await dataset(page)).meta.is_synthetic, { timeout: 60_000 }).toBe(true)
  // On success the page moves to the summary of what is now loaded.
  await expect(page.getByRole('tab', { name: 'What is loaded now' })).toHaveAttribute('aria-selected', 'true')
  expect(backups()).toBe(before + 1)
})

test('clear removes the dataset after confirmation, and pages explain the empty state', async ({ page }) => {
  const before = backups()
  await openTab(page, 'What is loaded now')
  const clear = page.getByRole('button', { name: 'Clear dataset' })
  await expect(clear).toBeDisabled()
  await page.getByLabel('I understand this removes the loaded dataset', { exact: false }).check()
  await clear.click()
  await expect.poll(async () => (await dataset(page)).has_data).toBe(false)
  expect(backups()).toBe(before + 1)

  await page.goto('/segments')
  await expect(page.getByRole('heading', { name: 'No dataset is loaded yet' })).toBeVisible()
  await page.getByRole('link', { name: 'Open Data Management' }).click()
  await expect(page).toHaveTitle('Data Management · CustomerIQ')
})
