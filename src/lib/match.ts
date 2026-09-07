import type { Branch, Card, Category, Employee, Vehicle } from './types'

export const normReg = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const normKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

const CAT_BY_DIGIT: Record<string, Category> = { '0': 'Admin', '1': 'Ops Cabling', '2': 'Ops Admin', '3': 'Sales', '4': 'Exec' }

/** "2151-GAU-GAUTENG OPS CABLING" → { category, branchCode } */
export function parseFaNameCode(nameCode: string): { category: Category | null; branchCode: string | null } {
  const m = String(nameCode).trim().match(/^(\d{4})-?\s*([A-Z0-9]{3})\b/)
  if (!m) return { category: null, branchCode: null }
  return { category: CAT_BY_DIGIT[m[1][3]] ?? null, branchCode: m[2] }
}

/** "4373-DON RAMPERSADH" → "4373" */
export const empNoFromDriver = (driver: string) => driver.trim().match(/^(\d{4})-/)?.[1] ?? null

export class BranchMatcher {
  private map = new Map<string, Branch>()
  branches: Branch[]
  constructor(branches: Branch[]) {
    this.branches = branches
    for (const b of branches) {
      this.map.set(b.code.toUpperCase(), b)
      this.map.set(normKey(b.name).toUpperCase(), b)
      for (const a of b.aliases ?? []) this.map.set(normKey(a).toUpperCase(), b)
    }
  }
  find(s: unknown): Branch | null {
    const k = normKey(s).toUpperCase()
    if (!k) return null
    if (this.map.has(k)) return this.map.get(k)!
    // "ESL - POOL", "ZZZ - RJR ELEC" → first token
    const first = k.split(/[\s-]+/)[0]
    if (first && this.map.has(first)) return this.map.get(first)!
    for (const [alias, b] of this.map) if (alias.length > 3 && k.includes(alias)) return b
    return null
  }
  byId(id: number | null | undefined) { return this.branches.find((b) => b.id === id) ?? null }
  code(id: number | null | undefined) { return this.byId(id)?.code ?? '' }
}

export function vehicleIndex(vehicles: Vehicle[]) {
  return new Map(vehicles.map((v) => [normReg(v.registration), v]))
}
export function cardIndex(cards: Card[]) {
  return new Map(cards.map((c) => [`${c.fa_driver_name.trim().toUpperCase()}|${normReg(c.fa_reg)}`, c]))
}
export function employeeByEmpNo(employees: Employee[]) {
  return new Map(employees.filter((e) => e.emp_no).map((e) => [String(e.emp_no).padStart(4, '0'), e]))
}
export function employeeByName(employees: Employee[]) {
  return new Map(employees.map((e) => [normKey(e.full_name), e]))
}
