// Branch / category placement of a cost: the allocation in force for the month of the cost.
// Staff first (own vehicle, fuel card, claims), then the vehicle, then whatever the line / card carries
// (unallocated cards, registrations not on the master).
import type { Allocation, Category } from './types'

export interface Placement { branch_id: number | null; category: Category | null; via: 'employee' | 'vehicle' | 'line' | 'none' }
export interface AllocCtx {
  allocations: Allocation[]
  vehicles: { id: number; branch_id: number | null; category: Category }[]
  employees: { id: number; branch_id: number | null; category: Category }[]
}
export interface AllocKey { vehicle_id?: number | null; employee_id?: number | null }

/** The allocation row that applies to `period` (latest effective_from <= period; before the first row, the first row). */
export function allocFor(allocs: Allocation[], key: AllocKey, period: string): Allocation | null {
  const rows = allocs.filter((a) => (key.employee_id ? a.employee_id === key.employee_id : key.vehicle_id ? a.vehicle_id === key.vehicle_id : false))
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  let cur = sorted[0]
  for (const r of sorted) if (r.effective_from <= period) cur = r
  return cur
}

/** Where a cost goes: employee allocation → vehicle allocation → the line's own branch / category. */
export function place(ctx: AllocCtx, ref: AllocKey & { branch_id?: number | null; category?: Category | null }, period: string): Placement {
  if (ref.employee_id) {
    const a = allocFor(ctx.allocations, { employee_id: ref.employee_id }, period)
    if (a) return { branch_id: a.branch_id, category: a.category, via: 'employee' }
    const e = ctx.employees.find((x) => x.id === ref.employee_id)
    if (e) return { branch_id: e.branch_id, category: e.category, via: 'employee' }
  }
  if (ref.vehicle_id) {
    const a = allocFor(ctx.allocations, { vehicle_id: ref.vehicle_id }, period)
    if (a) return { branch_id: a.branch_id, category: a.category, via: 'vehicle' }
    const v = ctx.vehicles.find((x) => x.id === ref.vehicle_id)
    if (v) return { branch_id: v.branch_id, category: v.category, via: 'vehicle' }
  }
  if (ref.branch_id != null || ref.category != null) return { branch_id: ref.branch_id ?? null, category: ref.category ?? null, via: 'line' }
  return { branch_id: null, category: null, via: 'none' }
}

/** Allocation history for one vehicle / person, newest first. */
export function history(allocs: Allocation[], key: AllocKey): Allocation[] {
  return allocs.filter((a) => (key.employee_id ? a.employee_id === key.employee_id : a.vehicle_id === key.vehicle_id)).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
}
