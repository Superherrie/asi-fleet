// Journal engine: turns imported lines into balanced GL journals for the management accountant.
// Output layout (Account / Branch / Description / Reference / Debit / Credit) is generic until the
// accountant's template is provided — swap the exporter in xlsx.ts, not the logic here.
import type { AvisLine, Branch, Card, Category, Claim, Employee, FaLine, GlMap, InsuranceLine, JournalLine, MaintLine, Setting, TrackingLine, Vehicle } from './types'
import { round2 } from './format'

export interface Ctx {
  branches: Branch[]; vehicles: Vehicle[]; employees: Employee[]; cards: Card[]; glmap: GlMap[]; settings: Setting[]
}
export interface JournalResult { lines: JournalLine[]; warnings: string[]; totalDebit: number; totalCredit: number }

const bcode = (ctx: Ctx, id: number | null | undefined) => ctx.branches.find((b) => b.id === id)?.code ?? ''
const setting = (ctx: Ctx, key: string) => ctx.settings.find((s) => s.key === key)?.value?.trim() || ''

function gl(ctx: Ctx, source: string, cost: string, cat: Category | null, warnings: string[]) {
  const m = ctx.glmap.find((g) => g.source === source && g.cost_type === cost && g.category === cat)
    ?? ctx.glmap.find((g) => g.source === source && g.cost_type === cost && g.category == null)
  if (!m) { const w = `No GL mapping for ${source}/${cost}/${cat ?? 'any'}`; if (!warnings.includes(w)) warnings.push(w); return { gl_account: 'UNMAPPED', gl_name: `${source} ${cost}` } }
  return { gl_account: m.gl_account, gl_name: m.gl_name }
}
function contra(ctx: Ctx, key: string, fallbackName: string, warnings: string[]) {
  const v = setting(ctx, key)
  if (!v) { const w = `Setting "${key}" is blank — set it under Admin → Settings`; if (!warnings.includes(w)) warnings.push(w) }
  return { gl_account: v || key.toUpperCase(), gl_name: fallbackName }
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

/** First Auto: company cards → expense per cost type (+VAT); staff cards → salary-deduction clearing (incl VAT). */
export function firstAutoJournal(ctx: Ctx, period: string, lines: FaLine[], summarise = true): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w)
  const dedAcc = contra(ctx, 'staff_deduction_account', 'Staff fleet card recoveries', w)
  const cred = contra(ctx, 'fa_creditor_account', 'First Auto (creditor)', w)
  let total = 0; let vatTotal = 0
  for (const l of lines) {
    const card = ctx.cards.find((c) => c.id === l.card_id)
    const ref = `${l.fa_driver_name ?? ''} ${l.fa_reg ?? ''}`.trim()
    total += l.grand_total
    if (!card || card.holder_type === 'unallocated') {
      w.push(`Card ${ref} is not allocated — posted to UNALLOCATED`)
      b.add({ gl_account: 'UNALLOCATED', gl_name: 'Unallocated fleet card', branch_code: bcode(ctx, card?.branch_id), category: card?.category ?? null, description: `First Auto ${period} ${ref}`, reference: ref, debit: l.grand_total, credit: 0, vehicle_id: null, employee_id: null, card_id: card?.id ?? null })
      continue
    }
    const branch = bcode(ctx, card.branch_id); const cat = card.category
    if (card.holder_type === 'staff' && card.deduct !== false) {
      // recovered from salary — the fleet card usage excluding toll; toll stays a company cost (matches payroll's sheet)
      const emp = ctx.employees.find((e) => e.id === card.employee_id)
      b.add({ ...dedAcc, branch_code: branch, category: cat, description: `Fleet card ${period} — ${emp?.full_name ?? ref} (salary deduction)`, reference: ref, debit: round2(l.grand_total - l.toll_excl - l.toll_vat), credit: 0, vehicle_id: null, employee_id: card.employee_id, card_id: card.id })
      if (l.toll_excl) b.add({ ...gl(ctx, 'first_auto', 'toll', cat, w), branch_code: branch, category: cat, description: `First Auto ${period} toll — ${emp?.full_name ?? ref}`, reference: ref, debit: l.toll_excl, credit: 0, vehicle_id: null, employee_id: card.employee_id, card_id: card.id })
      vatTotal += l.toll_vat
      continue
    }
    const veh = ctx.vehicles.find((v) => v.id === card.vehicle_id)
    const who = card.holder_type === 'staff' ? ctx.employees.find((e) => e.id === card.employee_id)?.full_name : veh?.registration
    for (const [exclKey, vatKey, cost] of FA_COSTS) {
      const excl = Number(l[exclKey] ?? 0); const vat = vatKey ? Number(l[vatKey] ?? 0) : 0
      if (excl) b.add({ ...gl(ctx, 'first_auto', cost, cat, w), branch_code: branch, category: cat, description: `First Auto ${period} ${cost} — ${who ?? ref}`, reference: ref, debit: excl, credit: 0, vehicle_id: veh?.id ?? null, employee_id: card.employee_id, card_id: card.id })
      vatTotal += vat
    }
    // reconcile rounding between the sum of parts and the statement's grand total
    const parts = FA_COSTS.reduce((s, [x, v]) => s + Number(l[x] ?? 0) + (v ? Number(l[v] ?? 0) : 0), 0)
    const diff = round2(l.grand_total - parts)
    if (Math.abs(diff) >= 0.01) b.add({ ...gl(ctx, 'first_auto', 'other', cat, w), branch_code: branch, category: cat, description: `First Auto ${period} rounding — ${veh?.registration ?? ref}`, reference: ref, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: card.id })
  }
  if (vatTotal) b.add({ ...vatAcc, branch_code: '000', category: null, description: `First Auto ${period} VAT input`, reference: null, debit: vatTotal, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `First Auto statement ${period}`, reference: null, debit: 0, credit: total, vehicle_id: null, employee_id: null, card_id: null })
  if (summarise) b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.vehicle_id ?? ''}|${l.employee_id ?? ''}|${l.description.replace(/ — .*/, '')}`)
  return b.result(w)
}

/** Avis: expense = TOTAL (rental + non-claimable VAT), VAT input = VAT CLAIMABLE, creditor = AMOUNT DUE. */
export function avisJournal(ctx: Ctx, period: string, lines: AvisLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'avis_creditor_account', 'Avis Fleet (creditor)', w)
  let vat = 0, due = 0
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const branch = veh ? bcode(ctx, veh.branch_id) : bcode(ctx, l.branch_id); const cat = veh?.category ?? 'Ops Cabling'
    if (!veh) w.push(`Avis vehicle ${l.reg} is not on the fleet master`)
    const cost = /FINE/i.test(l.transaction_type ?? '') ? 'fines' : /LIC/i.test(l.transaction_type ?? '') ? 'licence' : /REPAIR|EXCKM|CHG/i.test(l.transaction_type ?? '') ? 'other' : 'lease'
    const map = ctx.glmap.some((g) => g.source === 'avis' && g.cost_type === cost) ? gl(ctx, 'avis', cost, cat, w) : gl(ctx, 'avis', 'lease', cat, w)
    b.add({ ...map, branch_code: branch, category: cat, description: `Avis ${period} ${l.transaction_type ?? ''} — ${l.reg}`, reference: l.document_no, debit: l.total > 0 ? l.total : 0, credit: l.total < 0 ? -l.total : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat_claimable; due += l.amount_due
  }
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `Avis ${period} VAT input`, reference: null, debit: vat > 0 ? vat : 0, credit: vat < 0 ? -vat : 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `Avis statement ${period}`, reference: null, debit: due < 0 ? -due : 0, credit: due > 0 ? due : 0, vehicle_id: null, employee_id: null, card_id: null })
  b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.vehicle_id ?? ''}|${l.description.replace(/ — .*/, '')}`)
  return b.result(w)
}

export function insuranceJournal(ctx: Ctx, period: string, lines: InsuranceLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'insurance_creditor_account', 'Insurer (creditor)', w)
  let vat = 0, total = 0
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const branch = veh ? bcode(ctx, veh.branch_id) : bcode(ctx, l.branch_id); const cat = veh?.category ?? 'Ops Cabling'
    if (!veh) w.push(`Insured vehicle ${l.reg} is not on the fleet master`)
    b.add({ ...gl(ctx, 'insurance', 'insurance', cat, w), branch_code: branch, category: cat, description: `Insurance ${period} — ${l.reg}`, reference: null, debit: l.premium, credit: 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat; total += l.premium + l.vat
  }
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `Insurance ${period} VAT input`, reference: null, debit: vat, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `Insurance premium ${period}`, reference: null, debit: 0, credit: total, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}

export function trackingJournal(ctx: Ctx, period: string, provider: string, lines: TrackingLine[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const vatAcc = contra(ctx, 'vat_input_account', 'VAT Input', w); const cred = contra(ctx, 'tracking_creditor_account', `${provider} (creditor)`, w)
  let vat = 0, total = 0
  for (const l of lines) {
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id)
    const branch = veh ? bcode(ctx, veh.branch_id) : bcode(ctx, l.branch_id); const cat = veh?.category ?? 'Ops Cabling'
    if (!veh) w.push(`${provider} vehicle ${l.reg} is not on the fleet master`)
    b.add({ ...gl(ctx, 'tracking', 'tracking', cat, w), branch_code: branch, category: cat, description: `${provider} ${period} — ${l.reg}`, reference: l.invoice, debit: l.amount_excl > 0 ? l.amount_excl : 0, credit: l.amount_excl < 0 ? -l.amount_excl : 0, vehicle_id: veh?.id ?? null, employee_id: null, card_id: null })
    vat += l.vat; total += l.total
  }
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
  const companyCost = new Set(ctx.employees.filter((e) => { const cs = ctx.cards.filter((c) => c.holder_type === 'staff' && c.employee_id === e.id); return cs.length > 0 && cs.every((c) => c.deduct === false) }).map((e) => e.id))
  let vat = 0, total = 0
  for (const l of lines) {
    total += l.total
    const branch = bcode(ctx, l.branch_id); const cat = l.category ?? 'Ops Cabling'; const ref = `${l.invoice_no} ${l.reg ?? ''}`.trim()
    const work = /charge on/i.test(l.billing_type)
    if (l.employee_id && work && !companyCost.has(l.employee_id)) {
      const emp = ctx.employees.find((e) => e.id === l.employee_id)
      b.add({ ...accrual, branch_code: branch, category: cat, description: `Maintenance ${period} — ${emp?.full_name ?? l.reg} (utilised from accrual)`, reference: ref, debit: l.total, credit: 0, vehicle_id: null, employee_id: l.employee_id, card_id: l.card_id })
      continue
    }
    if (!l.employee_id && !l.vehicle_id) w.push(`Maintenance line for ${l.reg} is not linked to a person or fleet vehicle`)
    const veh = ctx.vehicles.find((v) => v.id === l.vehicle_id); const who = veh?.registration ?? ctx.employees.find((e) => e.id === l.employee_id)?.full_name ?? l.reg
    b.add({ ...gl(ctx, 'first_auto', work ? 'maint' : 'maint_fees', cat, w), branch_code: branch, category: cat, description: `Maintenance ${period} ${work ? 'work' : l.billing_type.toLowerCase()} — ${who}`, reference: ref, debit: l.excl, credit: 0, vehicle_id: veh?.id ?? null, employee_id: l.employee_id, card_id: l.card_id })
    vat += l.vat
  }
  if (vat) b.add({ ...vatAcc, branch_code: '000', category: null, description: `First Auto maintenance ${period} VAT input`, reference: null, debit: vat, credit: 0, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...cred, branch_code: '000', category: null, description: `First Auto maintenance invoice(s) ${period}`, reference: null, debit: 0, credit: round2(total), vehicle_id: null, employee_id: null, card_id: null })
  b.summarise((l) => `${l.gl_account}|${l.branch_code}|${l.vehicle_id ?? ''}|${l.employee_id ?? ''}|${l.description.replace(/ — .*/, '')}`)
  return b.result(w)
}

/** Claims: fuel portion → expense + claims payable (payroll); maintenance portion → expense + accrual liability. */
export function claimsJournal(ctx: Ctx, period: string, claims: Claim[]): JournalResult {
  const w: string[] = []; const b = new Builder()
  const pay = contra(ctx, 'claims_payable_account', 'Travel claims payable (payroll)', w)
  const acc = contra(ctx, 'maintenance_accrual_account', 'Maintenance accrual', w)
  let fuel = 0, maint = 0
  for (const c of claims) {
    const emp = ctx.employees.find((e) => e.id === c.employee_id); const branch = bcode(ctx, emp?.branch_id)
    b.add({ ...gl(ctx, 'claims', 'claim_fuel', c.category, w), branch_code: branch, category: c.category, description: `Travel claim ${period} fuel — ${emp?.full_name ?? c.employee_id} (${c.business_km} km)`, reference: emp?.emp_no ?? null, debit: c.fuel_amount, credit: 0, vehicle_id: null, employee_id: c.employee_id, card_id: null })
    b.add({ ...gl(ctx, 'claims', 'claim_maint', c.category, w), branch_code: branch, category: c.category, description: `Travel claim ${period} maintenance — ${emp?.full_name ?? c.employee_id}`, reference: emp?.emp_no ?? null, debit: c.maint_amount, credit: 0, vehicle_id: null, employee_id: c.employee_id, card_id: null })
    fuel += c.fuel_amount; maint += c.maint_amount
  }
  b.add({ ...pay, branch_code: '000', category: null, description: `Travel claims ${period} — fuel paid via payroll`, reference: null, debit: 0, credit: fuel, vehicle_id: null, employee_id: null, card_id: null })
  b.add({ ...acc, branch_code: '000', category: null, description: `Travel claims ${period} — maintenance accrued`, reference: null, debit: 0, credit: maint, vehicle_id: null, employee_id: null, card_id: null })
  return b.result(w)
}
