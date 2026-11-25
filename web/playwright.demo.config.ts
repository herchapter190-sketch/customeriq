import { defineConfig } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
 * Browser check of the public read-only demo (run `npm run build` first, then
 * `npx playwright test -c playwright.demo.config.ts`). Runs the real deploy path: scripts/build_demo_db.py
 * builds a synthetic database in a temp folder, then `python -m src.api.demo` serves a copy of it.
 * Separate from playwright.config.ts so the local suite and its servers are unchanged.
 */
const PORT = Number(process.env.CIQ_E2E_DEMO_PORT || 8553)
const ROOT = (process.env.CIQ_E2E_ROOT ||= path.join(tmpdir(), 'ciq-e2e-demo'))
const DB = path.join(ROOT, 'customeriq-demo.db')
rmSync(DB, { force: true }) // the build script refuses an existing output
mkdirSync(ROOT, { recursive: true })
const here = import.meta.dirname
const venv = path.resolve(here, '..', '.venv')
const python = existsSync(path.join(venv, 'Scripts', 'python.exe')) ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')

export default defineConfig({
  testDir: 'e2e-demo',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  outputDir: path.join(tmpdir(), 'ciq-e2e-demo-results'),
  use: { channel: 'chromium', baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `"${python}" scripts/build_demo_db.py "${DB}" --customers 400 && "${python}" -m src.api.demo`,
    cwd: path.resolve(here, '..'),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CUSTOMERIQ_MODE: 'demo',
      CUSTOMERIQ_DEMO_DB: DB,
      CUSTOMERIQ_ALLOWED_HOSTS: '127.0.0.1',
      CUSTOMERIQ_ALLOWED_ORIGINS: `http://127.0.0.1:${PORT}`,
      PORT: String(PORT),
    },
  },
})
