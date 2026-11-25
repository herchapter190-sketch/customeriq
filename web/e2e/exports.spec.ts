import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { CSV_LABELS } from '../src/lib/domain'
import { expect, expectReady, test } from './fixtures'

const CSV_EXPORTS = ['revenue_by_customer', 'rfm_customers', 'segment_summary', 'monthly_revenue',
  'product_performance', 'inactive_customers', 'cohort_long', 'monthly_acquisition']

async function download(page: Page, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  return { name: file.suggestedFilename(), body: readFileSync(await file.path()) }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/reports')
  await expectReady(page, 'Reports & Exports')
})

test('PDF report downloads as a real PDF', async ({ page }) => {
  test.setTimeout(90_000)
  const { name, body } = await download(page, 'Download PDF')
  expect(name).toMatch(/^customeriq_report_\d{8}_\d{4}\.pdf$/)
  expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  expect(body.length).toBeGreaterThan(10_000)
  await expect(page.getByRole('status').filter({ hasText: `Saved ${name}` })).toBeVisible()
})

test('Excel workbook downloads as a real XLSX', async ({ page }) => {
  const { name, body } = await download(page, 'Download workbook')
  expect(name).toMatch(/^customeriq_report_\d{8}_\d{4}\.xlsx$/)
  expect(body.subarray(0, 2).toString()).toBe('PK') // zip container
  expect(body.includes('xl/workbook.xml')).toBe(true)
})

test('all eight CSV tables download with a header and rows', async ({ page }) => {
  const select = page.getByLabel('CSV table')
  await expect(select.locator('option')).toHaveCount(CSV_EXPORTS.length)
  for (const table of CSV_EXPORTS) {
    await test.step(table, async () => {
      await select.selectOption({ label: CSV_LABELS[table] })
      const { name, body } = await download(page, 'Download CSV')
      expect(name).toMatch(new RegExp(`^customeriq_${table}_\\d{8}_\\d{4}\\.csv$`))
      const lines = body.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
      expect(lines.length, `${table} rows`).toBeGreaterThan(1)
      expect(lines[0].split(',').length, `${table} columns`).toBeGreaterThan(1)
    })
  }
})
