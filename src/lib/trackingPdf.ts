// Parsers for the tracking companies' PDF tax invoices, working on plain text lines so the same code runs
// in the browser (pdfjs text) and in node (pdftotext). Cartrack = content-order lines; Tracker = layout lines.
import type { TrackingRow } from './parsers'

// self-contained helpers (this file is also imported by node scripts, which cannot resolve extension-less imports)
const normReg = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const amt = (s: string) => Number(String(s).replace(/[R\s,]/g, '')) || 0

export interface TrackingPdfParse { provider: 'Cartrack' | 'Tracker'; period: string | null; invoices: { invoice: string; date: string | null; excl: number; vat: number; total: number }[]; rows: TrackingRow[] }

/** Make the lines add up to the invoice exactly: any cent of rounding goes onto the largest line of that invoice. */
function reconcile(p: TrackingPdfParse) {
  for (const inv of p.invoices) {
    const lines = p.rows.filter((r) => r.invoice === inv.invoice); if (!lines.length) continue
    const big = lines.reduce((a, b) => (b.total > a.total ? b : a))
    const dTotal = round2(inv.total - lines.reduce((s, r) => s + r.total, 0)); const dExcl = round2(inv.excl - lines.reduce((s, r) => s + r.amount_excl, 0))
    if (Math.abs(dTotal) < 1 || Math.abs(dExcl) < 1) { big.amount_excl = round2(big.amount_excl + dExcl); big.total = round2(big.total + dTotal); big.vat = round2(big.total - big.amount_excl) }
  }
  return p
}

/** Which provider printed this document? */
export function detectProvider(text: string): 'Cartrack' | 'Tracker' | null {
  if (/cartrack/i.test(text)) return 'Cartrack'
  if (/tracker\.co\.za|Tracker Connect/i.test(text)) return 'Tracker'
  return null
}

/** Registration inside a Cartrack description, ignoring VIN / T-S / PO tokens. "MY26BBGPS1" (second unit) → MY26BBGP. */
function regFrom(desc: string) {
  const clean = desc.replace(/VIN:\s*\S+/gi, ' ').replace(/T\/?S:\s*\S+/gi, ' ').replace(/PO:\s*\S+/gi, ' ').replace(/Order:\s*\S+/gi, ' ').replace(/Client:.*?CC/gi, ' ')
  const m = clean.match(/\b([A-Z]{2,3}\s?\d{2,3}\s?[A-Z]{2,3}\s?(?:GP|MP|NW|NC|ZN|WC|EC|FS|L)?)(S\d)?\b/) ?? clean.match(/\b(TEMP-[A-Z0-9]+)\b/)
  return m ? normReg(m[1]) : ''
}

/** Cartrack: lines in content order (pdftotext -raw / pdfjs item order). */
export function parseCartrackLines(lines: string[]): TrackingPdfParse {
  const L = lines.map((l) => l.trim()).filter(Boolean)
  const invoice = L.find((l) => /Tax Invoice\s+INV-/i.test(l))?.match(/INV-\d+/)?.[0] ?? ''
  const date = L.find((l) => /^Date:\s*\d{4}-\d{2}-\d{2}/.test(l))?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  const rows: TrackingRow[] = []
  let period: string | null = null
  for (let i = 0; i < L.length; i++) {
    const head = L[i].match(/^(\d{4}\/\d{3})\s+R\s*([\d ,.]+)$/)
    if (!head) continue
    const code = head[1]; const total = amt(head[2])
    const desc: string[] = []; const nums: number[] = []
    let j = i + 1
    for (; j < L.length && nums.length < 3; j++) {
      const n = L[j].match(/^R\s*([\d ,.]+)$/)
      if (n) nums.push(amt(n[1])); else if (nums.length === 0 && !/^\d+\.\d\d$/.test(L[j])) desc.push(L[j])
    }
    if (j < L.length && /^\d+\.\d\d$/.test(L[j])) j++
    const [vat = 0, excl = 0] = nums
    const d = desc.join(' ')
    const pm = d.match(/\(([A-Za-z]{3})\s*(\d{2})\)/); if (pm && MONTHS[pm[1].toLowerCase()]) period ??= `20${pm[2]}-${String(MONTHS[pm[1].toLowerCase()]).padStart(2, '0')}`
    rows.push({ invoice, invoice_date: date, item_code: code, reg: regFrom(d), description: d.replace(/\s+/g, ' ').slice(0, 200), quantity: 1, amount_excl: excl, vat, total, branch_name: '', contract_id: '' })
    i = j - 1
  }
  // trailing totals: "R <vat> R <total>" then "R <excl>"
  const tl = L.find((l) => /^R\s*[\d ,.]+\s+R\s*[\d ,.]+$/.test(l)); const te = tl ? L[L.indexOf(tl) + 1] : ''
  const m = tl?.match(/^R\s*([\d ,.]+)\s+R\s*([\d ,.]+)$/)
  const inv = { invoice, date, excl: te ? amt(te) : round2(rows.reduce((s, r) => s + r.amount_excl, 0)), vat: m ? amt(m[1]) : round2(rows.reduce((s, r) => s + r.vat, 0)), total: m ? amt(m[2]) : round2(rows.reduce((s, r) => s + r.total, 0)) }
  return reconcile({ provider: 'Cartrack', period, invoices: [inv], rows })
}

/** Tracker Connect: layout lines; a PDF may hold several invoices. */
export function parseTrackerLines(lines: string[]): TrackingPdfParse {
  const rows: TrackingRow[] = []; const invoices: TrackingPdfParse['invoices'] = []
  let period: string | null = null; let invoice = ''; let date: string | null = null; let cur: TrackingRow[] = []
  const flush = (excl: number, vat: number, total: number) => { if (cur.length) { const f = excl && cur.length ? vat / excl : 0.15; for (const r of cur) { r.vat = round2(r.amount_excl * f); r.total = round2(r.amount_excl + r.vat) } invoices.push({ invoice, date, excl, vat, total }); rows.push(...cur); cur = [] } }
  let pendingTotals: { excl?: number; vat?: number } = {}
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue
    const inv = l.match(/\b(INV\d{8,})\b/); if (inv) invoice = inv[1]
    const dt = l.match(/\b(\d{2})-([A-Z]{3})-(\d{4})\b/); if (dt && MONTHS[dt[2].toLowerCase()]) date = `${dt[3]}-${String(MONTHS[dt[2].toLowerCase()]).padStart(2, '0')}-${dt[1]}`
    const pm = l.match(/\(([A-Z]{3})\)/); if (pm && MONTHS[pm[1].toLowerCase()] && date) period ??= `${date.slice(0, 4)}-${String(MONTHS[pm[1].toLowerCase()]).padStart(2, '0')}`
    const line = l.match(/^([A-Z0-9-]{5,})\s+(\d+\.\d\d)\s+([\d,]+\.\d\d)\s+([\d,]+\.\d\d)$/)
    if (line) { cur.push({ invoice, invoice_date: date, item_code: '', reg: normReg(line[1]), description: `Tracker subscription ${period ?? ''} ${line[1]}`.trim(), quantity: Number(line[2]), amount_excl: amt(line[4]), vat: 0, total: 0, branch_name: '', contract_id: '' }); continue }
    const te = l.match(/Total Excl\. VAT\s+([\d,]+\.\d\d)/); if (te) pendingTotals.excl = amt(te[1])
    const tv = l.match(/^VAT\s+([\d,]+\.\d\d)/); if (tv) pendingTotals.vat = amt(tv[1])
    const td = l.match(/^([\d,]+\.\d\d)$/) ?? l.match(/Total Due\s+([\d,]+\.\d\d)/)
    if (td && pendingTotals.excl != null) { flush(pendingTotals.excl, pendingTotals.vat ?? 0, amt(td[1])); pendingTotals = {} }
  }
  if (cur.length) flush(round2(cur.reduce((s, r) => s + r.amount_excl, 0)), 0, 0)
  return reconcile({ provider: 'Tracker', period, invoices, rows })
}
