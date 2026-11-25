import { expect, mintCode, STATE, test } from './fixtures'

// One browser session shared by the read-only tests (the API keeps at most 20 sessions).
test('sign in once with a login link', async ({ page, request, baseURL }) => {
  const code = await mintCode(request, baseURL!)
  await page.goto(`/api/session/start?code=${code}`)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status').filter({ hasText: 'API connected' })).toBeVisible()
  await page.context().storageState({ path: STATE })
})
