// New vehicles: a registration a supplier bills that is not on the fleet master and has no decision recorded.
// Herman's rule (13 Nov 2026): never assume such a registration belongs in branch ZZZ. It stays open, and is flagged across the
// app, until someone adds it to the master with its branch and category, or records that it is not ours (fleet_reg_decisions).
import { supabase, fetchAll } from './supabase'
import { normReg } from './match'
import type { Category, Ownership, RegDecision } from './types'

export interface NewReg {
  key: string; reg: string
  /** suppliers that billed it, e.g. "Avis", "Tracking · Cartrack" */
  sources: string[]
  first: string; last: string; lines: number; amount: number
  /** how the supplier describes it */
  desc: string
  make: string | null; model: string | null; year: number | null; mva: string | null
  /** the supplier's own cost centre for it: a hint only, the app's allocation is the master */
  supplierBranch: string
  ownership: Ownership
  ids: { avis: number[]; insurance: number[]; tracking: number[]; maint: number[]; cards: number[] }
}
export interface NewRegState { open: NewReg[]; decisions: RegDecision[]; notOurs: Set<string> }

export const NEW_REG_EVENT = 'fleet-newregs-changed'
// the menu count, the banners and the list all read the same data: one load is shared for a few seconds
let shared: { at: number; p: Promise<NewRegState> } | null = null
export const invalidateNewRegs = () => { shared = null }
export function loadNewRegsShared(): Promise<NewRegState> {
  if (!shared || Date.now() - shared.at > 15000) { const p = loadNewRegs(); shared = { at: Date.now(), p }; p.catch(() => { if (shared?.p === p) shared = null }) }
  return shared.p
}
/** Something changed (an import, a decision, a vehicle added): reload wherever the open registrations are shown. */
export const announceNewRegs = () => { invalidateNewRegs(); window.dispatchEvent(new Event(NEW_REG_EVENT)) }

/** Registrations decided "not ours" (normalised). Used by the journals: only these may post to branch ZZZ. */
export async function loadNotOurs(): Promise<Set<string>> {
  const { data, error } = await supabase.from('fleet_reg_decisions').select('registration,decision')
  if (error) throw new Error(error.message)
  return new Set((data ?? []).filter((d) => d.decision === 'not_ours').map((d) => normReg(d.registration)))
}

type AvisL = { id: number; period: string; reg: string | null; amount_due: number; transaction_type: string | null; make_model: string | null; mva_number: string | null; cost_centre_name: string | null }
type InsL = { id: number; period: string; reg: string | null; premium: number; vat: number; year: number | null; make: string | null; model: string | null; branch_name: string | null }
type TrkL = { id: number; period: string; provider: string; reg: string | null; total: number; description: string | null; branch_name: string | null }
type MntL = { id: number; period: string; reg: string | null; total: number; billing_type: string; vehicle_desc: string | null; cost_centre: string | null }
type FaL = { id: number; period: string; card_id: number | null; fa_driver_name: string | null; fa_reg: string | null; grand_total: number; make: string | null; model: string | null; fa_name_code: string | null }

/** Every billed registration that is neither on the fleet master nor decided. Reads the supplier lines that did not match a vehicle on import. */
export async function loadNewRegs(): Promise<NewRegState> {
  const [vehicles, cards, decisionsRes, avis, ins, trk, mnt] = await Promise.all([
    fetchAll<{ id: number; registration: string; alt_regs?: string[] }>(() => supabase.from('fleet_vehicles').select('id,registration,alt_regs').order('id')),
    fetchAll<{ id: number; holder_type: string; fa_reg: string; fa_driver_name: string }>(() => supabase.from('fleet_cards').select('id,holder_type,fa_reg,fa_driver_name').order('id')),
    supabase.from('fleet_reg_decisions').select('*').order('decided_at', { ascending: false }),
    fetchAll<AvisL>(() => supabase.from('fleet_avis_lines').select('id,period,reg,amount_due,transaction_type,make_model,mva_number,cost_centre_name').is('vehicle_id', null).order('id')),
    fetchAll<InsL>(() => supabase.from('fleet_insurance_lines').select('id,period,reg,premium,vat,year,make,model,branch_name').is('vehicle_id', null).order('id')),
    fetchAll<TrkL>(() => supabase.from('fleet_tracking_lines').select('id,period,provider,reg,total,description,branch_name').is('vehicle_id', null).order('id')),
    fetchAll<MntL>(() => supabase.from('fleet_maint_lines').select('id,period,reg,total,billing_type,vehicle_desc,cost_centre').is('vehicle_id', null).is('employee_id', null).order('id')),
  ])
  if (decisionsRes.error) throw new Error(decisionsRes.error.message)
  const decisions = (decisionsRes.data ?? []) as RegDecision[]
  const notOurs = new Set(decisions.filter((d) => d.decision === 'not_ours').map((d) => normReg(d.registration)))
  const unalloc = cards.filter((c) => c.holder_type === 'unallocated')
  const fa = unalloc.length ? await fetchAll<FaL>(() => supabase.from('fleet_fa_lines').select('id,period,card_id,fa_driver_name,fa_reg,grand_total,make,model,fa_name_code').in('card_id', unalloc.map((c) => c.id)).order('id')) : []

  const onMaster = new Set<string>(); for (const v of vehicles) { onMaster.add(normReg(v.registration)); for (const r of v.alt_regs ?? []) onMaster.add(normReg(r)) }
  const map = new Map<string, NewReg & { branches: Set<string>; srcSet: Set<string>; descs: Set<string> }>()
  const touch = (rawReg: string | null, source: string, period: string, amount: number) => {
    const key = normReg(rawReg); if (!key || onMaster.has(key) || notOurs.has(key)) return null
    let e = map.get(key)
    if (!e) { e = { key, reg: key, sources: [], first: period, last: period, lines: 0, amount: 0, desc: '', make: null, model: null, year: null, mva: null, supplierBranch: '', ownership: 'owned', ids: { avis: [], insurance: [], tracking: [], maint: [], cards: [] }, branches: new Set(), srcSet: new Set(), descs: new Set() }; map.set(key, e) }
    e.srcSet.add(source); e.lines++; e.amount += Number(amount) || 0
    if (period < e.first) e.first = period; if (period > e.last) e.last = period
    return e
  }
  for (const l of avis) {
    const e = touch(l.reg, 'Avis', l.period, l.amount_due); if (!e) continue
    e.ids.avis.push(l.id); if (l.cost_centre_name) e.branches.add(l.cost_centre_name)
    const fine = /FINE/i.test(l.transaction_type ?? ''); e.descs.add(fine ? 'fine administration fee' : 'rental')
    if (!fine) e.ownership = 'avis'
    if (l.make_model) { const [make, ...rest] = l.make_model.split('_'); e.make ??= make || null; e.model ??= rest.join(' ') || null }
    if (l.mva_number) e.mva ??= l.mva_number
  }
  for (const l of ins) {
    const e = touch(l.reg, 'Insurance', l.period, Number(l.premium) + Number(l.vat)); if (!e) continue
    e.ids.insurance.push(l.id); if (l.branch_name) e.branches.add(l.branch_name); e.descs.add('insurance premium')
    e.make ??= l.make; e.model ??= l.model; e.year ??= l.year
  }
  for (const l of trk) {
    const e = touch(l.reg, `Tracking · ${l.provider}`, l.period, l.total); if (!e) continue
    e.ids.tracking.push(l.id); if (l.branch_name) e.branches.add(l.branch_name); e.descs.add('tracking unit')
  }
  for (const l of mnt) {
    const e = touch(l.reg, 'FA Maintenance', l.period, l.total); if (!e) continue
    e.ids.maint.push(l.id); if (l.cost_centre) e.branches.add(l.cost_centre); e.descs.add('maintenance')
    if (l.vehicle_desc && !e.make) { const [make, ...rest] = l.vehicle_desc.trim().split(/\s+/); e.make = make || null; e.model = rest.join(' ') || null }
  }
  for (const l of fa) {
    const e = touch(l.fa_reg, 'First Auto', l.period, l.grand_total); if (!e) continue
    if (l.card_id && !e.ids.cards.includes(l.card_id)) e.ids.cards.push(l.card_id)
    if (l.fa_name_code) e.branches.add(l.fa_name_code); e.descs.add(`fuel card ${l.fa_driver_name ?? ''}`.trim())
    e.make ??= l.make; e.model ??= l.model
  }
  const open = [...map.values()].map(({ branches, srcSet, descs, ...e }) => ({ ...e, sources: [...srcSet].sort(), supplierBranch: [...branches].join(', '), desc: [...descs].join(', '), amount: Math.round(e.amount * 100) / 100 }))
    .sort((a, b) => b.last.localeCompare(a.last) || b.amount - a.amount)
  return { open, decisions, notOurs }
}

/** Add the registration to the fleet master with the chosen allocation, effective from the first month it was billed, and tie the
 *  supplier lines (and any unallocated fuel card) that carried it to the new vehicle so the journals and dashboard pick it up. */
export async function addNewRegToMaster(r: NewReg, a: { branch_id: number; category: Category; ownership: Ownership }): Promise<number> {
  const { data, error } = await supabase.from('fleet_vehicles').insert({
    registration: r.reg, year: r.year, make: r.make, model: r.model, branch_id: a.branch_id, category: a.category, ownership: a.ownership, avis_mva: r.mva,
    notes: `Added from New vehicles: first billed by ${r.sources.join(', ')} in ${r.first}`,
  }).select('id').single()
  if (error) throw new Error(error.message)
  const id = data.id as number
  const { error: aErr } = await supabase.from('fleet_allocations').insert({ vehicle_id: id, branch_id: a.branch_id, category: a.category, effective_from: r.first, note: 'Opening allocation' })
  if (aErr) throw new Error(aErr.message)
  await linkLines(r, id, a)
  return id
}
async function linkLines(r: NewReg, vehicleId: number, a: { branch_id: number; category: Category }) {
  const upd = async (table: string, ids: number[], patch: object) => { for (let i = 0; i < ids.length; i += 200) { const { error } = await supabase.from(table).update(patch).in('id', ids.slice(i, i + 200)); if (error) throw new Error(error.message) } }
  await upd('fleet_avis_lines', r.ids.avis, { vehicle_id: vehicleId, branch_id: a.branch_id })
  await upd('fleet_insurance_lines', r.ids.insurance, { vehicle_id: vehicleId, branch_id: a.branch_id })
  await upd('fleet_tracking_lines', r.ids.tracking, { vehicle_id: vehicleId, branch_id: a.branch_id })
  await upd('fleet_maint_lines', r.ids.maint, { vehicle_id: vehicleId, branch_id: a.branch_id, category: a.category })
  await upd('fleet_cards', r.ids.cards, { holder_type: 'vehicle', vehicle_id: vehicleId, employee_id: null })
}

/** Record that these registrations are not ours. Their costs then post to branch ZZZ (Other), as a decision and not an assumption. */
export async function markNotOurs(regs: string[], note: string) {
  const user = (await supabase.auth.getUser()).data.user
  const { data: prof } = user ? await supabase.from('fleet_profiles').select('full_name,email').eq('user_id', user.id).maybeSingle() : { data: null }
  const rows = regs.map((reg) => ({ registration: normReg(reg), decision: 'not_ours', note: note.trim() || null, decided_by: user?.id ?? null, decided_by_name: prof?.full_name || prof?.email || user?.email || null, decided_at: new Date().toISOString() }))
  const { error } = await supabase.from('fleet_reg_decisions').upsert(rows, { onConflict: 'registration' })
  if (error) throw new Error(error.message)
}
/** Withdraw a "not ours" decision: the registration needs a decision again. */
export async function reopenReg(reg: string) {
  const { error } = await supabase.from('fleet_reg_decisions').delete().eq('registration', normReg(reg))
  if (error) throw new Error(error.message)
}
