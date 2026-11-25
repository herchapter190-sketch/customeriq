import { expect, expectReady, test, useMode } from '../e2e/fixtures'

test.describe('public demo: Data Management is read-only', () => {
  for (const mode of ['standard', '3d'] as const) {
    test(`no import, clear, load or raw CSV controls (${mode})`, async ({ page }) => {
      await useMode(page, mode, { still: true })
      await page.goto('/data')
      await expectReady(page, 'Data Management')
      const main = page.locator('main')
      await expect(main.getByRole('status').filter({ hasText: 'public demo is read-only' })).toBeVisible()
      await expect(main.getByText('Synthetic', { exact: false }).first()).toBeVisible()
      await expect(main.getByRole('tab')).toHaveText(['What is loaded now', 'How importing works'])
      await expect(main.locator('input[type=file]')).toHaveCount(0)
      await expect(main.locator('input[type=checkbox], input[type=number]')).toHaveCount(0)
      for (const name of [/import/i, /clear/i, /load/i, /raw.*csv/i, /template/i]) {
        await expect(main.getByRole('button', { name })).toHaveCount(0)
      }
      await expect(main.getByRole('heading', { name: /clear dataset/i })).toHaveCount(0)
      await expect(main.locator('.stepper')).toHaveCount(0)
      await expect(main.getByText('Rejected rows · first 100')).toBeVisible()

      // The import guide explains the steps but still offers nothing that uploads or writes.
      await main.getByRole('tab', { name: 'How importing works' }).click()
      await expect(main.getByText('Importing is turned off here')).toBeVisible()
      await expect(main.locator('.howto li')).toHaveCount(5)
      await expect(main.locator('input')).toHaveCount(0)
      await expect(main.getByRole('button')).toHaveText(['Download the CSV template'])
    })
  }

  test('rail and overview explain the demo, its import path and the 3D tour', async ({ page }) => {
    await useMode(page, 'standard', { still: true })
    await page.goto('/')
    await expectReady(page, 'Executive Overview')
    await expect(page.getByText('Public demo · read-only')).toBeVisible()
    await expect(page.locator('.filters__badge')).toContainText('Synthetic demo data')
    await page.getByRole('link', { name: 'How to import data' }).click()
    await expect(page.getByRole('tab', { name: 'How importing works' })).toHaveAttribute('aria-selected', 'true')

    await useMode(page, '3d', { still: true })
    await page.goto('/')
    await expect(page.getByText('Tour · stop 1 of 6')).toBeVisible()
    await page.getByRole('link', { name: /^Next:/ }).click()
    await expect(page).toHaveURL(/\/segments$/)
    await expect(page.getByText('Tour · stop 2 of 6')).toBeVisible()
  })

  test('write routes do not exist on the server', async ({ request }) => {
    for (const url of ['/api/import/preview', '/api/import/commit', '/api/dataset/demo', '/api/dataset/clear']) {
      // Not registered: 404, or 405 where the GET-only SPA fallback matches the path. Never a 2xx.
      expect([404, 405], url).toContain((await request.post(url, { data: { confirm: true } })).status())
    }
    expect(await (await request.get('/api/session')).json()).toEqual({ authenticated: true, mode: 'demo' })
  })
})
