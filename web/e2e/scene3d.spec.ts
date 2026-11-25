import { expect, expectReady, ROUTES, test, useMode } from './fixtures'

const THREE_D_CHUNK = /\/assets\/(vendor-3d|Stage|[A-Za-z]+Scene)-[\w-]+\.js$/
const SCENE_CHUNK: Record<string, string> = {
  segments: 'SegmentsScene', revenue: 'RevenueScene', cohorts: 'CohortsScene', behaviour: 'BehaviourScene',
  inactive: 'InactiveScene', data: 'DataScene', sql: 'SqlScene', reports: 'ReportsScene',
}

test('Standard mode never downloads the 3D engine; switching to 3D loads it on demand', async ({ page }) => {
  test.setTimeout(120_000)
  const scripts: string[] = []
  page.on('request', (r) => r.resourceType() === 'script' && scripts.push(new URL(r.url()).pathname))
  await useMode(page, 'standard')
  await page.goto('/')
  await expectReady(page, ROUTES[0].title)
  const rail = page.getByRole('navigation', { name: 'Primary' })
  for (const route of ROUTES.slice(1)) {
    await rail.getByRole('link', { name: route.title }).click()
    await expectReady(page, route.title)
  }
  expect(scripts.filter((s) => THREE_D_CHUNK.test(s)), '3D chunks fetched in Standard mode').toEqual([])

  const engine = page.waitForRequest((r) => /\/assets\/vendor-3d-/.test(r.url()))
  await page.getByRole('button', { name: '3D Exploration' }).click()
  await engine
  await expect(page.getByRole('button', { name: '3D Exploration' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.stage:not(.stage--2d) canvas')).toBeAttached()

  await page.getByRole('button', { name: 'Standard' }).click()
  await expect(page.locator('.stage')).toHaveCount(0)
})

test('?3d in the URL opens 3D Exploration', async ({ page }) => {
  await page.goto('/revenue?3d')
  await expectReady(page, 'Revenue Analytics')
  await expect(page.locator('html')).toHaveAttribute('data-mode', '3d')
  await expect(page.locator('.stage:not(.stage--2d) canvas')).toBeAttached()
})

for (const route of ROUTES) {
  test(`3D scene renders on ${route.title}`, async ({ page }) => {
    const chunk = SCENE_CHUNK[route.slug]
    const sceneRequest = chunk ? page.waitForRequest((r) => r.url().includes(`/assets/${chunk}-`)) : null
    await useMode(page, '3d')
    await page.goto(route.path)
    await expectReady(page, route.title)
    if (sceneRequest) await sceneRequest // each page's scene is its own lazily loaded chunk
    const stage = page.locator('.stage:not(.stage--2d)')
    const canvas = stage.locator('canvas')
    await expect(canvas).toBeAttached()
    expect(await canvas.evaluate((c: HTMLCanvasElement) => c.width > 0 && c.height > 0)).toBe(true)
    // The canvas draws something: the stage looks different with the canvas hidden.
    await expect
      .poll(async () => {
        const drawn = await stage.screenshot({ animations: 'disabled' })
        await canvas.evaluate((c) => (c.style.visibility = 'hidden'))
        const blank = await stage.screenshot({ animations: 'disabled' })
        await canvas.evaluate((c) => (c.style.visibility = ''))
        return drawn.equals(blank)
      }, { message: 'the WebGL canvas drew nothing' })
      .toBe(false)
  })
}
