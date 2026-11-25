import { writeFileSync } from 'node:fs'
import { fingerprint } from './guard'

/** Records the project database and backups/ so teardown can prove the suite never touched them. */
export default function globalSetup() {
  writeFileSync(`${process.env.CIQ_E2E_ROOT}/guard.json`, JSON.stringify(fingerprint()))
}
