const zar = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

export const money = (n: number | null | undefined) => (n == null ? '' : zar.format(n))
export const num = (n: number | null | undefined, dp = 0) =>
  n == null ? '' : dp ? new Intl.NumberFormat('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n) : int.format(n)
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = MONTHS

/** 'YYYY-MM' → 'Aug 2026' */
export function periodLabel(p: string) {
  const [y, m] = p.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
export function currentPeriod(offsetMonths = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offsetMonths)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function prevPeriod(p: string, n = 1) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export function periodRange(from: string, to: string) {
  const out: string[] = []
  let p = from
  while (p <= to) { out.push(p); p = prevPeriod(p, -1) }
  return out
}
export function daysInPeriod(p: string) {
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/** Excel serial or date-ish string → 'YYYY-MM-DD' */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return d.toISOString().slice(0, 10)
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
export const periodOf = (iso: string | null) => (iso ? iso.slice(0, 7) : null)
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export const toNum = (v: unknown): number => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/[,\sR]/g, '').replace(/\((.*)\)/, '-$1'))
  return isNaN(n) ? 0 : n
}
