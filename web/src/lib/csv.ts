/**
 * Formula-safe CSV, mirroring src/reports/safe_export.py: text that a spreadsheet could
 * evaluate (=, +, -, @, tab, CR) gets a leading quote, except plain numbers like "-12.5".
 * Used only for tables the page already holds (SQL results, findings); every analytical
 * export is produced by the API.
 */
const PREFIXES = ['=', '+', '-', '@', '\t', '\r']
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function escapeCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  let text = String(value)
  if (PREFIXES.some((p) => text.startsWith(p)) && !PLAIN_NUMBER.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(columns: string[], data: unknown[][]): Blob {
  const lines = [columns.map(escapeCell).join(','), ...data.map((row) => row.map(escapeCell).join(','))]
  return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
}
