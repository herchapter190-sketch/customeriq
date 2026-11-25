import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const PROJECT = path.resolve(import.meta.dirname, '..', '..')
const DB = process.env.CUSTOMERIQ_DB ? path.resolve(PROJECT, process.env.CUSTOMERIQ_DB) : path.join(PROJECT, 'data', 'customeriq.db')
const BACKUPS = path.join(PROJECT, 'backups')

/** SHA-256 and mtime of the real database (plus its WAL), and the list of real backups. */
export function fingerprint() {
  const file = (p: string) => (existsSync(p) ? { sha256: createHash('sha256').update(readFileSync(p)).digest('hex'), mtime: statSync(p).mtimeMs } : null)
  return {
    db: file(DB),
    wal: file(`${DB}-wal`),
    backups: existsSync(BACKUPS) ? readdirSync(BACKUPS).sort() : [],
  }
}
