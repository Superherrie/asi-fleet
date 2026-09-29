// Parser for CBS copier tax invoices (CBS Rentals (Pty) Ltd = rental, Corporate Business Solutions (Pty) Ltd = service / click charges).
// Works on layout text lines so the same code runs in the browser (pdfjs) and in node scripts. One invoice per page; statement pages are skipped.

export interface CopierMeter { open: number | null; close: number | null; qty: number; rate: number; charge: number; read_date: string | null }
export interface CopierInvoice {
  supplier_entity: string; account_no: string | null; customer_name: string | null; invoice_no: string; invoice_date: string | null; period: string | null
  kind: 'rental' | 'service'; contract_no: string | null; serial_no: string; model: string | null; site: string | null
  rental_excl: number; rental_for: string | null; admin_fee: number
  mono: CopierMeter | null; colour: CopierMeter | null; scan: CopierMeter | null
  subtotal: number; vat: number; total: number
}

const amt = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const MONEY = String.raw`(\d{1,3}(?: \d{3})*,\d{2})`

/** "0 27 891 28 345 454" with usage 454 → opening 27 891, closing 28 345 (the leading units figure is optional). */
function readings(tokens: string[], qty: number): { open: number | null; close: number | null } {
  const t = [...tokens]
  // strip the usage figure off the end
  for (let n = 1; n <= Math.min(3, t.length); n++) if (Number(t.slice(-n).join('')) === qty) { t.splice(-n); break }
  for (const skip of [1, 0]) {
    const r = t.slice(skip)
    for (let i = 1; i < r.length; i++) { const open = Number(r.slice(0, i).join('')), close = Number(r.slice(i).join('')); if (close - open === qty) return { open, close } }
  }
  return { open: null, close: null }
}

function meter(lines: string[], label: RegExp): CopierMeter | null {
  // charge level line: "<label> 0 to 10000 0,9734 454 441,92"  (scanner: "0 to 0,0266 401 10,67")
  const lvl = lines.find((l) => label.test(l) && /\bto\b/i.test(l))
  if (!lvl) return null
  const m = lvl.match(new RegExp(String.raw`to\s*(?:\d+\s+)?(\d+,\d{3,4})\s+(\d+)\s+` + MONEY + String.raw`\s*$`, 'i'))
  if (!m) return null
  const rate = amt(m[1]), qty = Number(m[2]), charge = amt(m[3])
  const idx = lines.findIndex((l) => label.test(l) && !/\bto\b/i.test(l))
  let open: number | null = null, close: number | null = null, read_date: string | null = null
  if (idx >= 0) {
    // strip the trailing charge by VALUE: "454 441,92" must not be read as the amount 454 441,92
    const tk = lines[idx].replace(label, '').trim().split(/\s+/)
    for (let k = 1; k <= Math.min(3, tk.length); k++) if (Math.abs(amt(tk.slice(-k).join(' ')) - charge) < 0.005) { tk.splice(-k); break }
    ;({ open, close } = readings(tk.filter((x) => /^\d+$/.test(x)), qty))
    const d = (lines[idx + 1] ?? '').match(/Reading Date\s*:\s*(\d{4})\/(\d{2})\/(\d{2})/i); if (d) read_date = `${d[1]}-${d[2]}-${d[3]}`
  }
  return { open, close, qty, rate, charge, read_date }
}

/** Splits the document into pages (blank line between pages) and parses every "Tax Invoice" page. */
export function parseCopierInvoices(lines: string[]): CopierInvoice[] {
  const pages: string[][] = [[]]
  for (const l of lines) { if (/^Tax Invoice\s*$/i.test(l.trim()) && pages[pages.length - 1].length) pages.push([]); if (/^Statement\s*$/i.test(l.trim()) && pages[pages.length - 1].length) pages.push([]); pages[pages.length - 1].push(l.replace(/\s+/g, ' ').trim()) }
  const out: CopierInvoice[] = []
  for (const p of pages) {
    if (!/^Tax Invoice$/i.test(p[0] ?? '')) continue
    const text = p.join('\n'); const get = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null
    const invoice_no = get(/Document No\.?\s*:\s*(\S+)/i); const serial = get(/Serial No\.?\s*:\s*([A-Z0-9/]+)/i)
    if (!invoice_no || !serial) continue
    const d = text.match(/\bDate\s*:\s*(\d{4})\/(\d{2})\/(\d{2})/); const invoice_date = d ? `${d[1]}-${d[2]}-${d[3]}` : null
    const rent = text.match(new RegExp(String.raw`Equipment Rental\s*-?\s*([A-Za-z]+)?\s+` + MONEY, 'i'))
    const fee = text.match(new RegExp(String.raw`Admin Fees?\s+` + MONEY, 'i'))
    const sub = text.match(new RegExp(String.raw`Sub Total ZAR\s+` + MONEY, 'i')); const vat = text.match(new RegExp(String.raw`VAT ZAR\s+` + MONEY, 'i')); const tot = text.match(new RegExp(String.raw`(?<!Sub )Total ZAR\s+` + MONEY, 'i'))
    // shipping address: the text after "Shipping Address :" plus the right-hand remainder of the following lines up to "Order No."
    const si = p.findIndex((l) => /Shipping Address\s*:/i.test(l)); const site: string[] = []
    if (si >= 0) { site.push(p[si].replace(/^.*Shipping Address\s*:\s*/i, '')); for (let i = si + 1; i < p.length && !/^Order No/i.test(p[i]); i++) site.push(p[i].replace(/^Model No\.?\s*:\s*\S+(?:\s+(?=[A-Za-z]*\d)\S+)?\s*/i, '')) }
    const loc = get(/Location\s*:\s*(.+)/i)
    const cust = text.match(/Customer\s*:\s*(\S+)\s+(.+)/i)
    out.push({
      supplier_entity: p[1] ?? '', account_no: cust?.[1] ?? null, customer_name: cust?.[2]?.trim() ?? null, invoice_no, invoice_date, period: invoice_date ? invoice_date.slice(0, 7) : null,
      kind: rent ? 'rental' : 'service', contract_no: get(/Contract\s*:\s*(\S+)/i), serial_no: serial.toUpperCase(), model: get(/Model No\.?\s*:\s*([A-Za-z0-9]+(?: (?=[A-Za-z]*\d)[A-Za-z0-9]+)?)/i),
      site: [loc && loc !== '.' ? loc : null, ...site].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim() || null,
      rental_excl: rent ? amt(rent[2]) : 0, rental_for: rent?.[1] ?? null, admin_fee: fee ? amt(fee[1]) : 0,
      mono: meter(p, /^Mono meter Copies/i), colour: meter(p, /^Colour Meter Copies/i), scan: meter(p, /^Scanner Meter Copies/i),
      subtotal: sub ? amt(sub[1]) : 0, vat: vat ? amt(vat[1]) : 0, total: tot ? amt(tot[1]) : 0,
    })
  }
  return out
}

/** Does the invoice add up? Returns the difference between the printed subtotal and rental + admin fee + click charges. */
export const invoiceGap = (i: CopierInvoice) => round2(i.subtotal - (i.rental_excl + i.admin_fee + (i.mono?.charge ?? 0) + (i.colour?.charge ?? 0) + (i.scan?.charge ?? 0)))
