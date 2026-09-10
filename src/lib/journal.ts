// Journal engine: turns imported lines into balanced GL journals for the management accountant.
// Output layout (Account / Branch / Description / Reference / Debit / Credit) is generic until the
// accountant's template is provided — swap the exporter in xlsx.ts, not the logic here.
import type { Allocation, AvisLine, Branch, Card, Category, Claim, Deduction, Employee, FaLine, GlMap, InsuranceLine, JournalLine, MaintLine, Setting, TrackingLine, Vehicle } from './types'
import { round2 } from './format'
import { place } from './alloc'
import { cardDeducts, maintenanceToAccrual } from './rules'

export interface Ctx {
  branches: Branch[]; vehicles: Vehicle[]; employees: Employee[]; cards: Card[]; glmap: GlMap[]; settings: Setting[]; allocations: Allocation[]
}
export interface JournalResult { lines: JournalLine[]; warnings: string[]; totalDebit: number; totalCredit: number }

const bcode = (ctx: Ctx, id: number | null | undefined) => ctx.branches.find((b) => b.id === id)?.code ?? ''
/** Branch code + category for a cost in `period`: the person's / vehicle's allocation in force that month, else what the line / card carries. */
function where(ctx: Ctx, ref: { employee_id?: number | null; vehicle_id?: number | null; branch_id?: number | null; category?: Category | null }, period: string) {
  const p = place(ctx, ref, period)
  return { branch: bcode(ctx, p.branch_id), cat: p.category, branch_id: p.branch_id, via: p.via }
}
/** Herman's rule: every vehicle cost must map to the fleet master. A registration that is not on the master is posted to UNALLOCATED
 *  (branch 000) and listed once per journal, so it is added under Fleet → Vehicles (or disputed with the supplier) before posting. */
const UNALLOC = { gl_account: 'UNALLOCATED', gl_name: 'Registration not on fleet master' }
function flushUnmatched(w: string[], bucket: Map<string, number>, supplier: string, extra = '') {
  if (!bucket.size) return
  const total = round2([...bucket.values()].reduce((a, c) => a + c, 0))
  w.push(`${bucket.size} registration${bucket.size > 1 ? 's' : ''} on the ${supplier} statement ${bucket.size > 1 ? 'are' : 'is'} not on the fleet master — R ${total.toFixed(2)} posted to UNALLOCATED (branch 000). Add each under Fleet → Vehicles with its branch and category, then regenerate${extra}: ${[...bucket.entries()].map(([r, v]) => `${r} R ${round2(v).toFixed(2)}`).join('; ')}`)
}
/** Statement / invoice cost centre differs from the app's allocation — collected into one warning per journal. */
function noteMismatch(bucket: Map<string, string>, ref: string, printed: string | null | undefined, used: string) {
  const p = (printed ?? '').trim().toUpperCase(); if (p && used && p !== used && !bucket.has(ref)) bucket.set(ref, `${ref}: statement ${p} → ${used}`)
}
function flushMismatch(w: string[], bucket: Map<string, string>, what: string) {
  if (!bucket.size) return
  const items = [...bucket.values()]; w.push(`${bucket.size} ${what} carry a different cost centre on the supplier's statement than the app allocation (allocation used): ${items.slice(0, 8).join('; ')}${items.length > 8 ? '; …' : ''}`)
}
const setting = (ctx: Ctx, key: string) => ctx.settings.find((s) => s.key === key)?.value?.trim() || ''
/** "Jul'26" — the accountant's month label in transaction descriptions */
const mon = (period: string) => { const [y, m] = period.split('-').map(Number); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}'${String(y).slice(2)}` }

function gl(ctx: Ctx, source: string, cost: string, cat: Category | null, warnings: string[]) {
  const m = ctx.glmap.find((g) => g.source === source && g.cost_type === cost && g.category === cat)
    ?? ctx.glmap.find((g) => g.source === source && g.cost_type === cost && g.category == null)
  if (!m) { const w = `No GL mapping for ${source}/${cost}/${cat ?? 'any'}`; if (!warnings.includes(w)) warnings.push(w); return { gl_account: 'UNMAPPED', gl_name: `${source} ${cost}` } }
  return { gl_account: m.gl_account, gl_name: m.gl_name }
}
function contra(ctx: Ctx, key: string, fallbackName: string, warnings: string[]) {
  const v = setting(ctx, key)
  if (!v) { const w = `Account not yet known: ${fallbackName} — set "${key}" under Admin → Settings`; if (!warnings.includes(w)) warnings.push(w) }
  return { gl_account: v || `?? ${fallbackName}`, gl_name: fallbackName }
}

class Builder {
  lines: JournalLine[] = []
  add(l: Omit<JournalLine, 'line_no'>) {
    if (!l.debit && !l.credit) return
    this.lines.push({ ...l, line_no: this.lines.length + 1, debit: round2(l.debit), credit: round2(l.credit) })
  }
  /** merge lines with the same account/branch/description into one */
  summarise(keep: (l: JournalLine) => string) {
    const m = new Map<string, JournalLine>()
    for (const l of this.lines) {
      const k = keep(l); const e = m.get(k)
      if (e) { e.debit = round2(e.debit + l.debit); e.credit = round2(e.credit + l.credit) } else m.set(k, { ...l })
    }
    this.lines = [...m.values()].map((l, i) => ({ ...l, line_no: i + 1 }))
  }
  result(warnings: string[]): JournalResult {
    const totalDebit = round2(this.lines.reduce((s, l) => s + l.debit, 0)); const totalCredit = round2(this.lines.reduce((s, l) => s + l.credit, 0))
    if (Math.abs(totalDebit - totalCredit) > 0.05) warnings.push(`Journal does not balance: Dr ${totalDebit} vs Cr ${totalCredit}`)
    return { lines: this.lines, warnings, totalDebit, totalCredit }
  }
}

const FA_COSTS: [keyof FaLine, keyof FaLine | null, string][] = [
  ['fuel', null, 'fuel'], ['oil_excl', 'oil_vat', 'oil'], ['repairs_excl', 'repairs_vat', 'repairs'], ['tyres_excl', 'tyres_vat', 'tyres'],
  ['accident_excl', 'accident_vat', 'accident'], ['maint_excl', 'maint_vat', 'maint'], ['overhaul_excl', 'overhaul_vat', 'overhaul'],
  ['other_excl', 'other_vat', 'other'], ['toll_excl', 'toll_vat', 'toll'], ['fees_excl', 'fees_vat', 'fees'],
]

/** First Auto fuel-card statement — as the accountant posts it: every line expensed by cost type to the card's category & branch
 *  (staff cards included; the fuel + oil recovery comes back through payroll), card fees to Bank Charges, all VAT to 904000,
 *  creditor = grand total (the debit order). Staff-card repairs/tyres/service are set off against the person's accrual (900500). */
export function firstAutoJournal(ctx: Ctx, period: string, lines: FaLine[], summarise = true): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w)
  const accrual = contra(ctx, 'maintenance_accrual_account', 'Maintenance accrual (staff)', w)
  const cred = contra(ctx, 'fa_creditor_account', 'First Auto (creditor)', w)
  let total = 0; let vatTotal = 0; const mism = new Map<string, string>()
  for (const l of lines) {
    const card = ctx.cards.find((c) => c.id === l.card_id)
    const ref = `${l.fa_driver_name ?? ''} ${l.fa_reg ?? ''}`.trim()
    total += l.grand_total
    if (!card || card.holder_type === 'unallocated') {
      w.push(`Card ${ref} is not allocated — posted to UNALLOCATED`)
      b.add({ gl_account: 'UNALLOCATED', gl_name: 'Unallocated fleet card', branch_code: bcode(ctx, card?.branch_id), category: card?.category ?? null, description: `First Auto ${period} ${ref}`, reference: ref, debit: l.grand_total, credit: 0, vehicle_id: null, employee_id: null, card_id: card?.id ?? null })
      continue
    }
    const { branch, cat } = where(ctx, card, period); const veh = ctx.vehicles.find((v) => v.id === card.vehicle_id)
    noteMismatch(mism, ref, (l.fa_name_code ?? '').split('-')[1], branch)
    const toAccrual = card.holder_type === 'staff' && cardDeducts(card, period)   // own vehicle: repairs/tyres/service come out of the person's accrual
    const desc = `FIRST AUTO EXP - ${l.fa_reg ?? ''} - ${l.fa_driver_name ?? ''} - ${mon(period)}`
    for (const [exclKey, vatKey, cost] of FA_COSTS) {
      const excl = Number(l[exclKey] ?? 0); const vat = vatKey ? Number(l[vatKey] ?? 0) : 0
      const maintType = ['repairs', 'tyres', 'accident', 'maint', 'overhaul', 'other'].includes(cost)
      const staffMaint = toAccrual && maintType   // private-vehicle work: set off against the person's accrual, incl VAT (no input VAT on private use), same as the WesBank CI invoices
      if (excl) b.add({ ...(staffMaint ? accrual : gl(ctx, 'first_auto', cost, cat, w)), branch_code: branch, category: cat, description: desc, reference: ref, debit: staffMaint ? round2(excl + vat) : excl, credit: 0, vehicle_id: veh?.id ?? null, employee_id: card.employee_id, card_id: card.id })
      if (!staffMaint) vatTotal += vat
    }
    // reconcile rounding between the sum of parts and the statement's grand total
    const parts = FA_COSTS.reduce((s, [x, v]) => s + Number(l[x] ?? 0) + (v ? Number(l[v] ?? 0) : 0), 0)
    const diff = round2(l.grand_total - parts)
    if (Math.abs(diff) >= 0.01) b.add({ ...gl(ctx, 'first_auto', 'other', cat, w), branch_code: branch, category: cat, description: desc, reference: ref, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: card.id })
  }
  flushMismatch(w, mism, 'fleet cards')
  if (vatTotal) b.add({ ...vatAcc, branch_code: '000', category: null, description: `FIRST AUTO VAT - ${mon(period)}`, reference: null, debit: vatTotal, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `FIRST AUTO - ${mon(period)}`, reference: null, debit: 0, credit: total, vehicle_id: null, employee_id: null, card_id: null })
  if (summarise) b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.card_id ?? ''}|${l.description}`)
  return b.result(w)
}

/** Avis: expense = TOTAL column (rental + the VAT Avis marks non-claimable on passenger vehicles) to 218100 by branch, REPAIR lines to 216100,
 *  VAT input = VAT CLAIMABLE only (904000), creditor = AMOUNT DUE (906000); one line per Avis transaction. Confirmed by Herman 2026-09-09. */
export function avisJournal(ctx: Ctx, period: string, lines: AvisLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'avis_creditor_account', 'Avis Fleet (creditor)', w)
  let vat = 0, due = 0
  const unmatched = new Map<string, number>(); let finesUnmapped = 0; let finesOffCount = 0
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const w0 = where(ctx, { vehicle_id: veh?.id, branch_id: l.branch_id }, period); const branch = w0.branch; const cat = w0.cat ?? 'Ops Cabling'
    const cost = /FINE/i.test(l.transaction_type ?? '') ? 'fines' : /LIC/i.test(l.transaction_type ?? '') ? 'licence' : /REPAIR|EXCKM|CHG/i.test(l.transaction_type ?? '') ? 'other' : 'lease'
    if (!veh) { unmatched.set(l.reg ?? '?', (unmatched.get(l.reg ?? '?') ?? 0) + l.amount_due); if (cost === 'fines') finesOffCount++ }
    const mapped = ctx.glmap.some((g) => g.source === 'avis' && g.cost_type === cost)
    if (cost === 'fines' && !mapped) finesUnmapped += l.total
    const map = !veh ? UNALLOC : mapped ? gl(ctx, 'avis', cost, cat, w) : gl(ctx, 'avis', 'lease', cat, w)
    b.add({ ...map, branch_code: veh ? branch : '000', category: veh ? cat : null, description: `${l.reg} AVIS ZEDA ${mon(period)} Bill`, reference: l.document_no, debit: l.total > 0 ? l.total : 0, credit: l.total < 0 ? -l.total : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat_claimable; due += l.amount_due
  }
  flushUnmatched(w, unmatched, 'Avis', finesOffCount ? ` (${finesOffCount} of the lines are R57.50 fine-administration fees — Avis manages fines for the whole fleet, so if a registration is not ours it belongs in the fines dispute, not on the master)` : '')
  if (finesUnmapped) w.push(`No Avis "fines" GL account mapped yet — R ${round2(finesUnmapped).toFixed(2)} of fine-administration fees posted to the lease account; set the fines account under Admin → GL map`)
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `AVIS ZEDA ${mon(period)} Bill`, reference: null, debit: vat > 0 ? vat : 0, credit: vat < 0 ? -vat : 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `AVIS ZEDA ${mon(period)} Bill`, reference: null, debit: due < 0 ? -due : 0, credit: due > 0 ? due : 0, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}

export function insuranceJournal(ctx: Ctx, period: string, lines: InsuranceLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'insurance_creditor_account', 'Insurer (creditor)', w)
  let vat = 0, total = 0; const unmatchedI = new Map<string, number>()
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const w0 = where(ctx, { vehicle_id: veh?.id, branch_id: l.branch_id }, period); const branch = w0.branch; const cat = w0.cat ?? 'Ops Cabling'
    if (!veh) unmatchedI.set(l.reg ?? '?', (unmatchedI.get(l.reg ?? '?') ?? 0) + l.premium + l.vat)
    b.add({ ...(veh ? gl(ctx, 'insurance', 'insurance', cat, w) : UNALLOC), branch_code: veh ? branch : '000', category: veh ? cat : null, description: `Insurance ${period} — ${l.reg}`, reference: null, debit: l.premium, credit: 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat; total += l.premium + l.vat
  }
  flushUnmatched(w, unmatchedI, 'insurance')
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `Insurance ${period} VAT input`, reference: null, debit: vat, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `Insurance premium ${period}`, reference: null, debit: 0, credit: total, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}

export function trackingJournal(ctx: Ctx, period: string, provider: string, lines: TrackingLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'tracking_creditor_account', `${provider} (creditor)`, w)
  let vat = 0, total = 0; const unmatchedT = new Map<string, number>()
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const w0 = where(ctx, { vehicle_id: veh?.id, branch_id: l.branch_id }, period); const branch = w0.branch; const cat = w0.cat ?? 'Ops Cabling'
    if (!veh) unmatchedT.set(l.reg ?? '?', (unmatchedT.get(l.reg ?? '?') ?? 0) + l.total)
    b.add({ ...(veh ? gl(ctx, 'tracking', 'tracking', cat, w) : UNALLOC), branch_code: veh ? branch : '000', category: veh ? cat : null, description: `${provider} ${period} — ${l.reg}`, reference: l.invoice, debit: l.amount_excl > 0 ? l.amount_excl : 0, credit: l.amount_excl < 0 ? -l.amount_excl : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat; total += l.total
  }
  flushUnmatched(w, unmatchedT, provider)
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `${provider} ${period} VAT input`, reference: null, debit: vat, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `${provider} invoice ${period}`, reference: null, debit: 0, credit: total, vehicle_id: null, employee_id: null, card_id: null })
  b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.vehicle_id ?? ''}|${l.description.replace(/ — .*/, '')}`)
  return b.result(w)
}

/** First Auto managed-maintenance charge-back: company vehicles → maintenance expense (+VAT); staff private vehicles →
 *  set off against the maintenance accrual liability (incl VAT, no input VAT on private use); fees/interest → company cost. */
export function maintenanceJournal(ctx: Ctx, period: string, lines: MaintLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'fa_creditor_account', 'First Auto (creditor)', w)
  const accrual = contra(ctx, 'maintenance_accrual_account', 'Maintenance accrual (staff)', w)
  // directors (all staff cards deduct = false): maintenance is company cost, like their fuel
  const companyCost = new Set(ctx.employees.filter((e) => !maintenanceToAccrual(ctx.cards.filter((c) => c.holder_type === 'staff' && c.employee_id === e.id), period)).map((e) => e.id))
  let vat = 0, total = 0; const mismM = new Map<string, string>(); const unmatchedM = new Map<string, number>()
  for (const l of lines) {
    total += l.total
    const w0 = where(ctx, { employee_id: l.employee_id, vehicle_id: l.vehicle_id, branch_id: l.branch_id, category: l.category }, period); const branch = w0.branch; const cat = w0.cat ?? 'Ops Cabling'; const ref = `${l.invoice_no} ${l.reg ?? ''}`.trim()
    if (w0.via !== 'line') noteMismatch(mismM, l.reg ?? ref, bcode(ctx, l.branch_id), branch)
    const work = /charge on/i.test(l.billing_type)
    if (l.employee_id && work && !companyCost.has(l.employee_id)) {
      const emp = ctx.employees.find((e) => e.id === l.employee_id)
      b.add({ ...accrual, branch_code: branch, category: cat, description: `${emp?.full_name ?? l.reg} - Maintenance Utilised - ${mon(period)} - ${l.supplier ?? ''}`.trim(), reference: ref, debit: l.total, credit: 0, vehicle_id: null, employee_id: l.employee_id, card_id: l.card_id })
      continue
    }
    const orphan = !l.employee_id && !l.vehicle_id
    if (orphan) unmatchedM.set(l.reg ?? '?', (unmatchedM.get(l.reg ?? '?') ?? 0) + l.total)
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id); const who = veh?.registration ?? ctx.employees.find((e) => e.id === l.employee_id)?.full_name ?? l.reg
    b.add({ ...(orphan ? UNALLOC : gl(ctx, 'first_auto', work ? 'maint' : 'maint_fees', cat, w)), branch_code: orphan ? '000' : branch, category: orphan ? null : cat, description: `${who} - First Auto ${work ? 'Maintenance' : l.billing_type} - ${mon(period)}`, reference: ref, debit: l.excl, credit: 0, vehicle_id: veh?.id ?? null, employee_id: l.employee_id, card_id: l.card_id })
    vat += l.vat
  }
  flushMismatch(w, mismM, 'maintenance lines'); flushUnmatched(w, unmatchedM, 'WesBank maintenance')
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `First Auto Maintenance - ${mon(period)}`, reference: null, debit: vat, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `First Auto Maintenance - ${mon(period)}`, reference: null, debit: 0, credit: round2(total), vehicle_id: null, employee_id: null, card_id: null })
  b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.vehicle_id ?? ''}|${l.employee_id ?? ''}|${l.description.replace(/ — .*/, '')}`)
  return b.result(w)
}

/** Salary recoveries: the fuel + oil on each staff member's fleet card (already expensed gross by the First Auto journal) is
 *  recovered from the next payroll. Per person Cr the Fuel/Oil expense of their branch & category (reversing that part of the
 *  First Auto expense); one Dr to the staff deduction clearing account, which payroll credits when the deduction is taken. */
export function deductionsJournal(ctx: Ctx, period: string, rows: Deduction[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const clearing = contra(ctx, 'staff_deduction_account', 'Staff fleet-card recoveries (payroll clearing)', w)
  const byEmp = new Map<number, number>()
  for (const d of rows) if (d.amount) byEmp.set(d.employee_id, round2((byEmp.get(d.employee_id) ?? 0) + Number(d.amount)))
  const ordered = [...byEmp.entries()].map(([id, amt]) => ({ emp: ctx.employees.find((e) => e.id === id), id, amt })).sort((a, c) => (a.emp?.emp_no ?? '').localeCompare(c.emp?.emp_no ?? ''))
  let total = 0
  for (const { emp, id, amt } of ordered) {
    const { branch, cat } = where(ctx, { employee_id: id }, period)
    b.add({ ...gl(ctx, 'first_auto', 'fuel', cat, w), branch_code: branch, category: cat, description: `${emp?.full_name ?? id} - Fleet Card Recovery - ${mon(period)}`, reference: emp?.emp_no ?? null, debit: 0, credit: amt, vehicle_id: null, employee_id: id, card_id: null })
    total = round2(total + amt)
  }
  if (total) b.add({ ...clearing, branch_code: '000', category: null, description: `Fleet Card Recoveries - ${mon(period)} usage (deducted ${mon(nextPeriod(period))} payroll)`, reference: null, debit: total, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}
const nextPeriod = (p: string) => { const [y, m] = p.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Claims: the fuel reimbursement paid via payroll → expense by branch + claims payable. (The maintenance provision is its own journal.) */
export function claimsJournal(ctx: Ctx, period: string, claims: Claim[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const pay = contra(ctx, 'claims_payable_account', 'Travel claims payable (payroll)', w)
  let fuel = 0
  const sorted = [...claims].sort((a, b2) => (ctx.employees.find((e) => e.id === a.employee_id)?.emp_no ?? '').localeCompare(ctx.employees.find((e) => e.id === b2.employee_id)?.emp_no ?? ''))
  const who = (c: Claim) => { const emp = ctx.employees.find((e) => e.id === c.employee_id); return { emp, branch: where(ctx, { employee_id: c.employee_id }, period).branch, name: emp?.full_name ?? String(c.employee_id) } }
  for (const c of sorted) {
    const { emp, branch, name } = who(c)
    b.add({ ...gl(ctx, 'claims', 'claim_fuel', c.category, w), branch_code: branch, category: c.category, description: `${name} - Travel Reimbursement - ${mon(c.period)}`, reference: emp?.emp_no ?? null, debit: c.fuel_amount, credit: 0, vehicle_id: null, employee_id: c.employee_id, card_id: null })
    fuel += c.fuel_amount
  }
  b.add({ ...pay, branch_code: '000', category: null, description: `Travel Reimbursement - ${mon(period)}`, reference: null, debit: 0, credit: fuel, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}

/** Maintenance accrual: raises the provision that payroll pays into each person's accrual — per person Dr maintenance expense
 *  (category, branch) / Cr 900500 (branch). Balances to the payroll sheet: the month's claims plus late claims paid with them (each
 *  keeps its own month in the description). Mirrors the accountant's posted "Maint. Accrual Jnl" (July 2026). */
export function provisionJournal(ctx: Ctx, period: string, claims: Claim[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const acc = contra(ctx, 'maintenance_accrual_account', 'Maintenance accrual', w)
  let maint = 0
  const sorted = [...claims].filter((c) => c.maint_amount).sort((a, b2) => (ctx.employees.find((e) => e.id === a.employee_id)?.emp_no ?? '').localeCompare(ctx.employees.find((e) => e.id === b2.employee_id)?.emp_no ?? ''))
  const who = (c: Claim) => { const emp = ctx.employees.find((e) => e.id === c.employee_id); return { emp, branch: where(ctx, { employee_id: c.employee_id }, period).branch, name: emp?.full_name ?? String(c.employee_id) } }
  for (const c of sorted) {
    const { emp, branch, name } = who(c)
    b.add({ ...gl(ctx, 'claims', 'claim_maint', c.category, w), branch_code: branch, category: c.category, description: `${name} - Maintenance Accrual - ${mon(c.period)}`, reference: emp?.emp_no ?? null, debit: c.maint_amount, credit: 0, vehicle_id: null, employee_id: c.employee_id, card_id: null })
    maint += c.maint_amount
  }
  for (const c of sorted) {
    const { emp, branch, name } = who(c)
    b.add({ ...acc, branch_code: branch, category: c.category, description: `${name} - Maintenance Accrual - ${mon(c.period)}`, reference: emp?.emp_no ?? null, debit: 0, credit: c.maint_amount, vehicle_id: null, employee_id: c.employee_id, card_id: null })
  }
  void maint
  return b.result(w)
}

