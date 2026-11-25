import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import path from 'node:path'
import { ROUTES } from '../src/routes'

export { expect, ROUTES }
export const ROOT = process.env.CIQ_E2E_ROOT!
export const TOKEN = process.env.CIQ_E2E_TOKEN!
export const SHORT_URL = process.env.CIQ_E2E_SHORT_URL!
export const STATE = path.join(ROOT, 'state.json')
export type Mode = 'standard' | '3d'

/**
 * Every test fails on a browser console error or uncaught page error. A test that expects
 * some (for example 401s while signed out) removes them with `allowConsole`.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      await use(errors)
      expect(errors, 'browser console errors').toEqual([])
    },
    { auto: true },
  ],
})

export function allowConsole(errors: string[], pattern: RegExp) {
  const keep = errors.filter((e) => !pattern.test(e))
  errors.splice(0, errors.length, ...keep)
}

/** Mint a single-use login code the way `python -m src.api login-link` does (bearer token, not a browser). */
export async function mintCode(request: APIRequestContext, baseURL: string): Promise<string> {
  const res = await request.post(`${baseURL}/api/session/login-code`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  expect(res.status()).toBe(200)
  return (await res.json()).code
}

/**
 * Choose the view mode before any page script runs (the app reads localStorage on load).
 * `still` emulates prefers-reduced-motion, so 3D draws on demand instead of every frame: layout
 * tests stay fast on a shared GPU. scene3d.spec.ts checks rendering with full motion.
 */
export async function useMode(page: Page, mode: Mode, { still = false } = {}) {
  await page.addInitScript((m) => window.localStorage.setItem('customeriq.viewMode', m), mode)
  if (still) await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** The page finished loading its data: heading shown, no spinner, no error panel. */
export async function expectReady(page: Page, title: string) {
  await expect(page).toHaveTitle(`${title} · CustomerIQ`)
  await expect(page.locator('main h1').first()).toBeVisible()
  await expect(page.locator('main .loading').filter({ visible: true })).toHaveCount(0)
  await expect(page.locator('main .notice--warn')).toHaveCount(0)
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
  expect(scroll, 'page is wider than the viewport').toBeLessThanOrEqual(width)
}

/** JSON POST from inside the page, exactly as the app sends it (session cookie, CSRF token, same origin). */
export async function apiPost(page: Page, url: string, body: unknown): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ({ url, body }) => {
      const s = await (await fetch('/api/session')).json()
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf_token ?? '' },
        body: JSON.stringify(body),
      })
      return { status: res.status, json: await res.json().catch(() => null) }
    },
    { url, body },
  )
}
