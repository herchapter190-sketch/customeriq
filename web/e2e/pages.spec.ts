import { allowConsole, expect, expectNoHorizontalOverflow, expectReady, ROUTES, test, useMode, type Mode } from './fixtures'

for (const mode of ['standard', '3d'] as Mode[]) {
  test.describe(`${mode} mode`, () => {
    for (const route of ROUTES) {
      test(`${route.title} loads directly`, async ({ page }) => {
        await useMode(page, mode, { still: true })
        await page.goto(route.path)
        await expectReady(page, route.title)
        await expect(page.locator('main .eyebrow').first()).toHaveText(route.title)
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        if (mode === '3d') {
          await expect(page.locator('.stage:not(.stage--2d) canvas')).toBeAttached()
        } else {
          await expect(page.locator('.stage')).toHaveCount(0)
        }
        await expectNoHorizontalOverflow(page)
      })
    }
  })
}

test('a failed insights request shows an error with retry, not an endless spinner', async ({ page, consoleErrors }) => {
  let fail = true
  await page.route('**/api/analytics/insights', (route) =>
    fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal server error"}' }) : route.continue(),
  )
  await page.goto('/')
  const panel = page.locator('section.insights')
  await expect(panel.getByRole('heading', { name: 'This view could not be loaded' })).toBeVisible()
  fail = false
  await panel.getByRole('button', { name: 'Retry' }).click()
  await expect(panel.locator('.insights__list li').first()).toBeVisible()
  allowConsole(consoleErrors, /status of 500/) // the failure this test provokes
})
