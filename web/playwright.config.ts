import { defineConfig } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
 * Browser tests for the built web app (run `npm run build` first, then `npm run test:e2e`).
 * Two throwaway servers (e2e/serve.py) run the real API on their own temp databases:
 *   main  (CIQ_E2E_PORT, default 8551): everything else
 *   short (port + 1): login codes expire after 2 s and sessions after 4 s, for the expiry tests
 * The project database and backups/ are never opened; global-teardown checks they are unchanged.
 */
// Set once in the runner process; workers inherit the environment, so every worker sees the same values.
// A fixed folder (not mkdtemp): on Windows the servers still hold their SQLite files when teardown runs,
// so each run reuses and replaces the last run's leftovers instead of adding another folder.
process.env.CIQ_E2E_ROOT ||= path.join(tmpdir(), 'ciq-e2e-run')
mkdirSync(process.env.CIQ_E2E_ROOT, { recursive: true })
process.env.CIQ_E2E_TOKEN ||= randomBytes(32).toString('base64url')

const PORT = Number(process.env.CIQ_E2E_PORT || 8551)
const SHORT_PORT = PORT + 1
process.env.CIQ_E2E_SHORT_URL = `http://127.0.0.1:${SHORT_PORT}`
const ROOT = process.env.CIQ_E2E_ROOT
const here = import.meta.dirname
const venv = path.resolve(here, '..', '.venv')
const python = existsSync(path.join(venv, 'Scripts', 'python.exe')) ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')
const serve = (port: number, extra = '') => ({
  command: `"${python}" e2e/serve.py --root "${ROOT}" --port ${port} ${extra}`.trim(),
  url: `http://127.0.0.1:${port}/api/health`,
  // Never attach to a server we did not start: it could be pointed at real data.
  reuseExistingServer: false,
  timeout: 120_000,
  env: { CUSTOMERIQ_API_TOKEN: process.env.CIQ_E2E_TOKEN! },
})
const STATE = path.join(ROOT, 'state.json') // same path as e2e/fixtures.ts

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // One local Python server and one integrated GPU are shared by every worker; more workers only add timeouts.
  workers: 2,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  // Traces of failed tests stay here after teardown removes ROOT (outside the repo, replaced each run).
  outputDir: path.join(tmpdir(), 'ciq-e2e-results'),
  use: {
    // Full Chromium in new headless mode can use the GPU for WebGL; the default headless shell
    // renders 3D in software (SwiftShader), which is slow enough to time out the 3D tests.
    channel: 'chromium',
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'off',
    acceptDownloads: true,
  },
  webServer: [serve(PORT), serve(SHORT_PORT, '--short-ttl')],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'app', testIgnore: /(auth\.spec|data-writes\.spec|auth\.setup)\.ts/, dependencies: ['setup'], use: { storageState: STATE } },
    { name: 'auth', testMatch: /auth\.spec\.ts/ },
    // Writes replace the shared dataset, so they run after every read-only test has finished.
    { name: 'writes', testMatch: /data-writes\.spec\.ts/, dependencies: ['app', 'auth'], use: { storageState: STATE } },
  ],
})
