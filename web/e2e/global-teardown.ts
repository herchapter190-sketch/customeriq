import { readFileSync, rmSync } from 'node:fs'
import { fingerprint } from './guard'

/** Fails the run if the project database or backups/ changed, then removes the temp folder. */
export default function globalTeardown() {
  const root = process.env.CIQ_E2E_ROOT!
  const before = JSON.parse(readFileSync(`${root}/guard.json`, 'utf8'))
  const after = fingerprint()
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`The project database or backups/ changed during the e2e run.\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(after)}`)
  }
  // The e2e servers may still hold their SQLite files open on Windows; the OS temp folder is the fallback.
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    console.warn(`Could not remove ${root} yet (files in use); it is in the OS temp folder.`)
  }
}
