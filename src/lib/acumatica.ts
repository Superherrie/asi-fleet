// Acumatica GL journal import layout (as used by the management accountant):
// Branch | Transaction Date | Period ID | Account | Description | Subaccount | Project/Contract | Project Task | Ref. Number | Quantity | UOM | Debit Amount | Credit Amount | Transaction Description
import type { JournalLine } from './types'

/** Financial year starts 1 July: July 2026 = 01-2027 */
export function periodId(period: string) {
  const [y, m] = period.split('-').map(Number)
  const fm = ((m - 7 + 12) % 12) + 1
  const fy = m >= 7 ? y + 1 : y
  return `${String(fm).padStart(2, '0')}-${fy}`
}
/** last day of the month as an Excel-friendly ISO date */
export function monthEnd(period: string) {
  const [y, m] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
/** Branch → subaccount segment. Head office / none = 000. */
export const subaccount = (branchCode: string | null | undefined) => `${(branchCode || '000').toUpperCase()}-000-000`

export const ACU_HEADER = ['Branch', 'Transaction Date', 'Period ID', 'Account', 'Description', 'Subaccount', 'Project/Contract', 'Project Task', 'Ref. Number', 'Quantity', 'UOM', 'Debit Amount', 'Credit Amount', 'Transaction Description']

export function acumaticaRows(period: string, lines: JournalLine[], opts: { branch?: string; ref?: string }): (string | number | null)[][] {
  const date = monthEnd(period); const pid = periodId(period)
  const rows: (string | number | null)[][] = [ACU_HEADER]
  for (const l of lines) rows.push([opts.branch || 'ICS', date, pid, l.gl_account, '', subaccount(l.branch_code), 'x', '', opts.ref || 'HDV', 1, '', l.debit ? l.debit : null, l.credit ? l.credit : null, l.description])
  return rows
}
