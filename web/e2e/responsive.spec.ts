import { expect, expectNoHorizontalOverflow, expectReady, ROUTES, test, useMode, type Mode } from './fixtures'

const WIDTHS = [360, 390, 430, 768, 1024, 1440]

for (const mode of ['standard', '3d'] as Mode[]) {
  for (const width of WIDTHS) {
    test(`${mode} at ${width}px: every page fits the viewport`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
      await useMode(page, mode, { still: true })
      for (const route of ROUTES) {
        await test.step(route.title, async () => {
          await page.goto(route.path)
          await expectReady(page, route.title)
          await expectNoHorizontalOverflow(page)
          // Either the rail or the phone menu button must offer navigation.
          const rail = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: route.title })
          const menu = page.getByRole('button', { name: 'Menu' })
          expect((await rail.isVisible()) || (await menu.isVisible()), 'navigation is reachable').toBe(true)
        })
      }
    })
  }
}
