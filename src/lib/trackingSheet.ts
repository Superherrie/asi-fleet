// Monthly tracking allocation sheet for Creditors: the same allocation the tracking journal would post (branch, category, GL account),
// laid out per vehicle so the invoices can be captured against the right cost centres by hand.
import type { TrackingLine, Vehicle } from './types'
import type { Ctx } from './journal'
import { trackingJournal, glAccountFor } from './journal'
import { place } from './alloc'
import { round2, periodLabel } from './format'
import { acumaticaRows, subaccount } from './acumatica'

export interface Sheet { name: string; rows: (string | number | null)[][]; widths?: number[] }

export function trackingAllocationSheets(ctx: Ctx, period: string, lines: TrackingLine[]): Sheet[] {
  const providers = [...new Set(lines.map((l) => l.provider))].sort()
  const bname = (code: string) => ctx.branches.find((b) => b.code === code)?.name ?? code
  const w: string[] = []
  // one row per invoice line, allocated exactly as the journal does it
  const alloc = lines.map((l) => {
    const veh: Vehicle | undefined = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const p = place(ctx, { vehicle_id: veh?.id, branch_id: l.branch_id }, period)
    const branch = veh ? (ctx.branches.find((b) => b.id === p.branch_id)?.code ?? 'ZZZ') : 'ZZZ'; const cat = veh ? (p.category ?? 'Ops Cabling') : 'Ops Cabling'
    const g = glAccountFor(ctx, 'tracking', 'tracking', veh ? cat : 'Ops Cabling', w)
    const note = !veh ? 'Not on fleet master - allocated to ZZZ (Other)' : !veh.active ? `Vehicle ${veh.disposal_type ?? 'inactive'}${veh.disposal_date ? ' ' + veh.disposal_date : ''} - unit still billed, to be cancelled` : ''
    return { l, veh, branch, cat, g, note }
  }).sort((a, b) => a.l.provider.localeCompare(b.l.provider) || a.branch.localeCompare(b.branch) || (a.l.reg ?? '').localeCompare(b.l.reg ?? ''))
  const rows: (string | number | null)[][] = [['Provider', 'Invoice', 'Invoice date', 'Registration', 'Vehicle', 'Branch', 'Branch name', 'Category', 'GL account', 'GL name', 'Subaccount', 'Excl VAT', 'VAT', 'Incl VAT', 'Description', 'Note']]
  for (const a of alloc) rows.push([a.l.provider, a.l.invoice, a.l.invoice_date, a.l.reg, a.veh ? `${a.veh.make ?? ''} ${a.veh.model ?? ''}`.trim() : '', a.branch, bname(a.branch), a.cat, a.g.gl_account, a.g.gl_name, subaccount(a.branch), round2(a.l.amount_excl), round2(a.l.vat), round2(a.l.total), a.l.description, a.note])
  type A = (typeof alloc)[number]
  const sum = (k: 'amount_excl' | 'vat' | 'total', f: (a: A) => boolean = () => true) => round2(alloc.filter(f).reduce((s, a) => s + a.l[k], 0))
  rows.push(['Total', null, null, null, null, null, null, null, null, null, null, sum('amount_excl'), sum('vat'), sum('total'), null, null])

  // branch x provider summary = what Creditors captures per cost centre
  const branches = [...new Set(alloc.map((a) => a.branch))].sort()
  const head: (string | number | null)[] = ['Branch', 'Branch name', 'Subaccount']; for (const p of providers) head.push(`${p} excl`, `${p} VAT`, `${p} incl`); head.push('Total excl', 'Total VAT', 'Total incl')
  const summary: (string | number | null)[][] = [head]
  for (const b of branches) {
    const r: (string | number | null)[] = [b, bname(b), subaccount(b)]
    for (const p of providers) r.push(sum('amount_excl', (a) => a.branch === b && a.l.provider === p), sum('vat', (a) => a.branch === b && a.l.provider === p), sum('total', (a) => a.branch === b && a.l.provider === p))
    r.push(sum('amount_excl', (a) => a.branch === b), sum('vat', (a) => a.branch === b), sum('total', (a) => a.branch === b)); summary.push(r)
  }
  const tot: (string | number | null)[] = ['Total', null, null]; for (const p of providers) tot.push(sum('amount_excl', (a) => a.l.provider === p), sum('vat', (a) => a.l.provider === p), sum('total', (a) => a.l.provider === p)); tot.push(sum('amount_excl'), sum('vat'), sum('total')); summary.push(tot)
  const gls = [...new Set(alloc.map((a) => a.g.gl_account))].sort()
  summary.push([], ['GL accounts used', null, null, 'Excl VAT'], ...gls.map((g): (string | number | null)[] => [g, alloc.find((a) => a.g.gl_account === g)!.g.gl_name, null, sum('amount_excl', (a) => a.g.gl_account === g)]))
  summary.push([], [`Period ${periodLabel(period)}. Allocation follows the fleet master in force for the month (vehicle -> branch and category); vehicles not on the master are allocated to ZZZ (Other). VAT is input VAT on the invoice; the creditor is credited with the incl total.`])

  // the journal lines themselves, one block per provider, in the Acumatica layout
  const jnl: (string | number | null)[][] = []
  for (const p of providers) {
    const r = trackingJournal(ctx, period, p, lines.filter((l) => l.provider === p)); const acu = acumaticaRows(period, r.lines, {})
    if (jnl.length) { jnl.push([]); acu.shift() }
    jnl.push(...acu); if (r.warnings.length) jnl.push(...r.warnings.map((x): (string | number | null)[] => [`Note: ${x}`]))
  }
  return [
    { name: 'By branch', rows: summary, widths: [10, 24, 14, ...providers.flatMap(() => [12, 10, 12]), 12, 10, 12] },
    { name: 'Per vehicle', rows, widths: [10, 16, 12, 13, 28, 8, 20, 12, 10, 34, 14, 11, 9, 11, 50, 44] },
    { name: 'Journal', rows: jnl, widths: [8, 14, 10, 10, 12, 14, 10, 10, 10, 8, 6, 14, 14, 60] },
  ]
}
