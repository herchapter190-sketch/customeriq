import { expect, expectReady, ROUTES, test } from './fixtures'

test('rail links open every page and mark the current one', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expectReady(page, ROUTES[0].title)
  const rail = page.getByRole('navigation', { name: 'Primary' })
  for (const route of [...ROUTES.slice(1), ROUTES[0]]) {
    await rail.getByRole('link', { name: route.title }).click()
    await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/' : route.path}$`))
    await expectReady(page, route.title)
    await expect(rail.getByRole('link', { name: route.title })).toHaveAttribute('aria-current', 'page')
  }
})

test('back and forward follow the history', async ({ page }) => {
  await page.goto('/segments')
  await expectReady(page, 'Customer Segmentation')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Cohort Retention' }).click()
  await expectReady(page, 'Cohort Retention')
  await page.goBack()
  await expectReady(page, 'Customer Segmentation')
  await page.goForward()
  await expectReady(page, 'Cohort Retention')
})

for (const route of ROUTES.slice(1)) {
  test(`refresh keeps ${route.path}`, async ({ page }) => {
    await page.goto(route.path)
    await expectReady(page, route.title)
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`${route.path}$`))
    await expectReady(page, route.title)
  })
}

test.describe('phone menu', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('opens, navigates and closes', async ({ page }) => {
    await page.goto('/')
    await expectReady(page, ROUTES[0].title)
    const menu = page.getByRole('button', { name: 'Menu' })
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await expect(page.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Inactive Customers' }).click()
    await expectReady(page, 'Inactive Customers')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
  })
})

test('unknown page shows Not found; unknown API paths and files stay JSON 404s', async ({ page, request }) => {
  await page.goto('/no-such-page')
  await expect(page).toHaveTitle('Not found · CustomerIQ')
  for (const url of ['/api/no-such-route', '/assets/missing.js', '/missing.png']) {
    const res = await request.get(url)
    expect(res.status(), url).toBe(404)
    expect(res.headers()['content-type'], url).toContain('application/json')
  }
})
