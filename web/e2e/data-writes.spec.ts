import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { CSV_LABELS } from '../src/lib/domain'
import { allowConsole, expect, expectReady, ROOT, ROUTES, test } from './fixtures'

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
  await expect(page.getByRole('region', { name: 'First rows of e2e_import.csv' }).locator('tbody tr').first()).toBeVisible()
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

// Representative exports: UCI Online Retail II columns with £ prices and a cancellation, and a two-sheet
// workbook of line totals (no unit price) with a currency column. Six customers over six months.
const RETAIL = (() => {
  const lines = ['Invoice,StockCode,Description,Quantity,InvoiceDate,Price,Customer ID,Country']
  let inv = 600000
  for (let m = 1; m <= 6; m++)
    for (let c = 1; c <= 6; c++)
      if (c <= 7 - m) lines.push(`${++inv},SKU-${c},Item ${c},${c},2024-0${m}-1${c} 10:00,£${(2.5 * c).toFixed(2)},R-${c},${c % 2 ? 'United Kingdom' : 'France'}`)
  lines.push('C600001,SKU-1,Item 1,-1,2024-01-20 10:00,£2.50,R-1,United Kingdom')
  return lines.join('\n')
})()
// Sales: sum over m, c<=7-m of c * 2.5c; minus the 2.50 return.
const RETAIL_NET = (() => {
  let t = -2.5
  for (let m = 1; m <= 6; m++) for (let c = 1; c <= 7 - m; c++) t += c * 2.5 * c
  return t
})()
const venvPython = () => {
  const venv = path.resolve(import.meta.dirname, '..', '..', '.venv')
  const win = path.join(venv, 'Scripts', 'python.exe')
  return existsSync(win) ? win : path.join(venv, 'bin', 'python')
}
// Built with the app's own pandas/openpyxl: sheet 1 is a notes sheet, the orders are on sheet 2.
const XLSX_SCRIPT = `
import sys, pandas as pd
rows = [(f"#10{i:02d}", f"W-{i % 4}", f"2024-{1 + i % 5:02d}-0{1 + i % 8} 09:00", f"SKU-{i % 3}", 1 + i % 3, round((1 + i % 3) * 4.25, 2), "USD")
        for i in range(20)]
with pd.ExcelWriter(sys.argv[1], engine="openpyxl") as xw:
    pd.DataFrame({"Note": ["Exported from the shop admin"]}).to_excel(xw, sheet_name="Read me", index=False)
    pd.DataFrame(rows, columns=["Order ID", "Customer", "Order Date", "SKU", "Qty", "Line Total", "Currency"]).to_excel(xw, sheet_name="Orders", index=False)
`

async function commitImport(page: Page) {
  await page.getByLabel('Replace the current dataset with this file.', { exact: false }).check()
  await page.getByRole('button', { name: 'Import and replace current dataset' }).click()
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible({ timeout: 60_000 })
}

/** Every page renders the imported dataset without an error, and all exports carry its rows. */
async function expectEverywhere(page: Page, source: string, symbol: string, customer: string) {
  for (const route of ROUTES) {
    await test.step(route.title, async () => {
      await page.goto(route.path)
      await expectReady(page, route.title)
      if (route.slug !== 'data') {
        await expect(page.locator('.filters__badge .is-real')).toHaveText('Your imported data')
        await expect(page.locator('.filters__badge')).toContainText(`Source: ${source}`)
        await expect(page.getByLabel('Currency')).toHaveValue(symbol)
      } else {
        await expect(page.getByText(source).first()).toBeVisible()
      }
      if (route.slug === 'overview') await expect(page.locator('main').getByText(symbol.trim(), { exact: false }).filter({ visible: true }).first()).toBeVisible()
    })
  }
  await page.goto('/reports')
  await expectReady(page, 'Reports & Exports')
  const save = async (button: string) => {
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
    return readFileSync(await file.path())
  }
  expect((await save('Download PDF')).subarray(0, 5).toString()).toBe('%PDF-')
  expect((await save('Download workbook')).subarray(0, 2).toString()).toBe('PK')
  await page.getByLabel('CSV table').selectOption({ label: CSV_LABELS.revenue_by_customer })
  expect((await save('Download CSV')).toString('utf8')).toContain(customer)
}

test('a representative CSV (£ prices, a cancellation) reaches all nine pages and the exports', async ({ page }) => {
  test.setTimeout(180_000)
  const file = path.join(ROOT, 'online_retail.csv')
  writeFileSync(file, RETAIL)
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByRole('heading', { name: '1 · online_retail.csv' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Sheet', exact: true })).toHaveCount(0) // CSV has no sheets
  await commitImport(page)
  const info = await dataset(page)
  expect(info.meta.currency).toBe('GBP')
  expect(info.overview).toMatchObject({ customers: 6, return_rows: 1 })
  expect(info.overview.net_revenue).toBeCloseTo(RETAIL_NET, 2)
  await expectEverywhere(page, 'online_retail.csv', '£', 'R-6')
})

test('an Excel workbook: choose the sheet, import line totals without unit prices', async ({ page }) => {
  test.setTimeout(180_000)
  const file = path.join(ROOT, 'shop_orders.xlsx')
  execFileSync(venvPython(), ['-I', '-c', XLSX_SCRIPT, file])
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  const sheet = page.getByRole('combobox', { name: 'Sheet', exact: true })
  await expect(sheet).toHaveValue('Read me') // first sheet with data rows: not the orders
  await expect(page.getByText('Map the required fields', { exact: false })).toBeVisible()
  await sheet.selectOption('Orders')
  await expect(page.getByText('20 rows · 7 columns', { exact: false })).toBeVisible()
  await expect(page.getByText('Map the required fields', { exact: false })).toHaveCount(0)
  await expect(page.getByText('unit price was derived as line total / quantity', { exact: false })).toBeVisible()
  await commitImport(page)
  const info = await dataset(page)
  expect(info.meta.currency).toBe('USD')
  expect(info.overview).toMatchObject({ customers: 4 })
  // 20 lines of qty (1..3) x 4.25, cycling 1,2,3: 7*1 + 7*2 + 6*3 = 39 units.
  expect(info.overview.net_revenue).toBeCloseTo(39 * 4.25, 2)
  await expectEverywhere(page, 'shop_orders.xlsx', '$', 'W-3')
})

test('a file mixing currencies is refused before anything is written', async ({ page, consoleErrors }) => {
  const file = path.join(ROOT, 'mixed.csv')
  writeFileSync(file, ['Invoice,Customer ID,InvoiceDate,Quantity,Price', '1,A,2024-01-01,1,$5.00', '2,B,2024-01-02,1,€5.00'].join('\n'))
  const before = backups()
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByText('Mixed currencies found ($, EUR)', { exact: false }).first()).toBeVisible()
  await page.getByLabel('Replace the current dataset with this file.', { exact: false }).check()
  await page.getByRole('button', { name: 'Import and replace current dataset' }).click()
  await expect(page.locator('.status-line.is-bad').filter({ hasText: 'Mixed currencies' }).last()).toBeVisible()
  expect((await dataset(page)).meta.source_name).toBe('shop_orders.xlsx')
  expect(backups()).toBe(before)
  allowConsole(consoleErrors, /status of 422/) // the refusal this test provokes
})

test('bare "$" prices need a chosen dollar before import', async ({ page }) => {
  const file = path.join(ROOT, 'dollars.csv')
  writeFileSync(file, ['Invoice,Customer ID,InvoiceDate,Quantity,Price', '1,A,2024-01-01,1,$5.00', '2,B,2024-01-02,2,$7.50'].join('\n'))
  await openTab(page, 'Import your data')
  await page.locator('input[type=file]').setInputFiles(file)
  const currency = page.getByRole('combobox', { name: 'Currency *', exact: true })
  await expect(currency).toHaveValue('')
  await expect(page.getByText('could be USD, CAD or AUD', { exact: false })).toBeVisible()
  await page.getByLabel('Replace the current dataset with this file.', { exact: false }).check()
  const importBtn = page.getByRole('button', { name: 'Import and replace current dataset' })
  await expect(importBtn).toBeDisabled()
  await currency.selectOption('CAD')
  await expect(currency).toHaveValue('CAD')
  await expect(page.getByText('could be USD, CAD or AUD', { exact: false })).toHaveCount(0)
  await expect(importBtn).toBeEnabled()
  await importBtn.click()
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible({ timeout: 60_000 })
  const info = await dataset(page)
  expect(info.meta.currency).toBe('CAD')
  expect(info.overview.net_revenue).toBeCloseTo(20, 2)
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
