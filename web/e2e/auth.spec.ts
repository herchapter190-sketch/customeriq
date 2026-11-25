import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { allowConsole, apiPost, expect, expectReady, mintCode, SHORT_URL, test, TOKEN } from './fixtures'

const SIGNED_OUT = /status of 401/ // the app's own session check while signed out
const BATCH = { names: ['kpis'], filters: {} }

async function signIn(context: BrowserContext, request: APIRequestContext, base: string) {
  const page = await context.newPage()
  await page.goto(`${base}/api/session/start?code=${await mintCode(request, base)}`)
  return page
}

test.describe('signed out', () => {
  test('pages ask for a login link and the API refuses data requests', async ({ page, request, consoleErrors }) => {
    await page.goto('/segments')
    await expect(page.getByRole('heading', { name: 'Sign in to the local API' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Not signed in' })).toBeVisible()
    for (const url of ['/api/dataset', '/api/meta', '/api/sql']) expect((await request.get(url)).status(), url).toBe(401)
    expect((await request.post('/api/analytics/batch', { data: BATCH })).status()).toBe(401)
    expect((await request.post('/api/dataset/clear', { data: { confirm: true } })).status()).toBe(401)
    expect((await request.post('/api/session/login-code')).status()).toBe(401)
    allowConsole(consoleErrors, SIGNED_OUT)
  })

  test('pasting the login link signs in; the cookie is HttpOnly, SameSite=Strict, /api only', async ({ page, request, baseURL, consoleErrors }) => {
    await page.goto('/')
    await page.getByLabel('Login link').fill(`${baseURL}/api/session/start?code=${await mintCode(request, baseURL!)}`)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expectReady(page, 'Executive Overview')
    await expect(page.getByRole('status').filter({ hasText: 'API connected' })).toBeVisible()
    const [cookie] = (await page.context().cookies()).filter((c) => c.name === 'customeriq_session')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api' })
    expect(await page.evaluate(() => document.cookie)).not.toContain('customeriq_session')
    allowConsole(consoleErrors, SIGNED_OUT)
  })

  test('a malformed link is rejected in the page', async ({ page, consoleErrors }) => {
    await page.goto('/')
    await page.getByLabel('Login link').fill('not a link')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('That does not look like a CustomerIQ login link.')
    allowConsole(consoleErrors, SIGNED_OUT)
  })
})

test('a login link works once; a reused or invented code is refused', async ({ browser, request, baseURL }) => {
  const code = await mintCode(request, baseURL!)
  const first = await browser.newContext({ baseURL })
  const page = await first.newPage()
  await page.goto(`/api/session/start?code=${code}`)
  await expectReady(page, 'Executive Overview')

  for (const reused of [code, 'invented-code']) {
    const other = await browser.newContext({ baseURL })
    const res = await other.request.get(`/api/session/start?code=${reused}`, { maxRedirects: 0 })
    expect(res.status()).toBe(401)
    expect((await res.json()).detail).toBe('Login link is invalid, expired or already used')
    expect((await other.cookies()).some((c) => c.name === 'customeriq_session')).toBe(false)
    await other.close()
  }
  await first.close()
})

test('logout ends the session, and the old cookie cannot be replayed', async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await signIn(context, request, baseURL!)
  await expectReady(page, 'Executive Overview')
  const cookies = await context.cookies()

  const out = await apiPost(page, '/api/session/logout', {})
  expect(out).toMatchObject({ status: 200, json: { logged_out: true } })
  expect((await context.request.get('/api/dataset')).status()).toBe(401)

  const replay = await browser.newContext({ baseURL })
  await replay.addCookies(cookies)
  expect((await replay.request.get('/api/dataset')).status()).toBe(401)
  await replay.close()
  await context.close()
})

test('state-changing requests need the CSRF token, an allowed Origin and same-site fetch metadata', async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await signIn(context, request, baseURL!)
  await expectReady(page, 'Executive Overview')
  const csrf = (await (await context.request.get('/api/session')).json()).csrf_token as string
  const post = (headers: Record<string, string>) => context.request.post('/api/analytics/batch', { data: BATCH, headers })

  expect((await post({ 'X-CSRF-Token': csrf })).status(), 'no Origin').toBe(403)
  expect((await post({ Origin: 'http://evil.example', 'X-CSRF-Token': csrf })).status(), 'foreign Origin').toBe(403)
  expect((await post({ Origin: baseURL! })).status(), 'no token').toBe(403)
  expect((await post({ Origin: baseURL!, 'X-CSRF-Token': 'wrong' })).status(), 'wrong token').toBe(403)
  expect((await post({ Origin: baseURL!, 'X-CSRF-Token': csrf, 'Sec-Fetch-Site': 'cross-site' })).status(), 'cross-site').toBe(403)
  expect((await post({ Origin: baseURL!, 'X-CSRF-Token': csrf, 'Sec-Fetch-Site': 'same-origin' })).status(), 'valid').toBe(200)

  // In the browser itself: a fetch without the token is refused; the app's own request works.
  const noToken = await page.evaluate(async (body) => (await fetch('/api/analytics/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, BATCH)
  expect(noToken).toBe(403)
  expect((await apiPost(page, '/api/analytics/batch', BATCH)).status).toBe(200)
  await context.close()
})

test('the script token is refused when a browser sends it', async ({ page, consoleErrors }) => {
  await page.goto('/') // the app page: its CSP allows same-origin fetch (API responses allow none)
  const statuses = await page.evaluate(async (token) => {
    const auth = { Authorization: `Bearer ${token}` }
    return [
      (await fetch('/api/dataset', { headers: auth })).status,
      (await fetch('/api/session/login-code', { method: 'POST', headers: auth })).status,
    ]
  }, TOKEN)
  expect(statuses).toEqual([401, 401])
  allowConsole(consoleErrors, SIGNED_OUT)
})

test.describe('expiry (server with 2 s login codes and 4 s sessions)', () => {
  test('an unused login link expires', async ({ browser, request }) => {
    const code = await mintCode(request, SHORT_URL)
    // Wait past the 2 s lifetime without touching the code: redeeming it early would also give a 401 later.
    await new Promise((r) => setTimeout(r, 2500))
    const context = await browser.newContext()
    const res = await context.request.get(`${SHORT_URL}/api/session/start?code=${code}`, { maxRedirects: 0 })
    expect(res.status()).toBe(401)
    await context.close()
  })

  test('a session expires and the page asks to sign in again', async ({ browser, request, consoleErrors }) => {
    const context = await browser.newContext()
    const page = await signIn(context, request, SHORT_URL)
    await expectReady(page, 'Executive Overview')
    await expect.poll(async () => (await context.request.get(`${SHORT_URL}/api/dataset`)).status(), { intervals: [1000], timeout: 10_000 }).toBe(401)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in to the local API' })).toBeVisible()
    await context.close()
    allowConsole(consoleErrors, SIGNED_OUT)
  })
})
