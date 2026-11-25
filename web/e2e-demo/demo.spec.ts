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
      await expect(main.getByRole('tab')).toHaveText(['What is loaded now'])
      await expect(main.locator('input[type=file]')).toHaveCount(0)
      await expect(main.locator('input[type=checkbox], input[type=number]')).toHaveCount(0)
      for (const name of [/import/i, /clear/i, /load/i, /raw.*csv/i, /template/i]) {
        await expect(main.getByRole('button', { name })).toHaveCount(0)
      }
      await expect(main.getByRole('heading', { name: /clear dataset/i })).toHaveCount(0)
      await expect(main.locator('.stepper')).toHaveCount(0)
      await expect(main.getByText('Rejected rows · first 100')).toBeVisible()
    })
  }

  test('write routes do not exist on the server', async ({ request }) => {
    for (const url of ['/api/import/preview', '/api/import/commit', '/api/dataset/demo', '/api/dataset/clear']) {
      // Not registered: 404, or 405 where the GET-only SPA fallback matches the path. Never a 2xx.
      expect([404, 405], url).toContain((await request.post(url, { data: { confirm: true } })).status())
    }
    expect(await (await request.get('/api/session')).json()).toEqual({ authenticated: true, mode: 'demo' })
  })
})
