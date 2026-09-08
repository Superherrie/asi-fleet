// First Auto consolidated maintenance invoice ("5000006_ASI CONNECT ICS._33857DIV0000x_CI000xxxxx.xlsx", sheet "Data").
// Self-contained: also imported by scripts/import-fa-maintenance.mjs (node strips the types).
export interface MaintRow {
  invoice_no: string; line_id: string; order_id: string | null; cost_centre: string; billing_type: string
  excl: number; vat: number; total: number; order_date: string | null; completion_date: string | null; invoice_date: string | null
  supplier: string | null; reg: string; driver: string | null; vehicle_desc: string | null; item_desc: string | null
  cost_category: string | null; description: string | null
}
export interface MaintParse { rows: MaintRow[]; invoices: string[]; period: string | null; totals: { excl: number; vat: number; total: number } }

const normReg = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const normKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => { if (v == null || v === '') return 0; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n }
const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null
}

/** rows = sheet_to_json(header:1) of the "Data" sheet */
export function parseMaintenanceRows(rows: unknown[][]): MaintParse {
  const h = rows.findIndex((r) => r.map(normKey).includes('consolidatedinvoicenumber'))
  if (h < 0) throw new Error('Not a First Auto maintenance invoice (no ConsolidatedInvoiceNumber column)')
  const idx = new Map<string, number>(); rows[h].forEach((c, i) => { const k = normKey(c); if (k && !idx.has(k)) idx.set(k, i) })
  const c = (name: string) => idx.get(normKey(name)) ?? -1
  const col = {
    inv: c('ConsolidatedInvoiceNumber'), order: c('OrdersID'), line: c('OutgoingInvoiceLineID'), cc: c('CostCentre'), type: c('BillingItemType'),
    excl: c('BillingAmountExcl'), vat: c('BillingAmountVAT'), total: c('TotalBillingAmount'), odate: c('OrderDate'), cdate: c('CompletionDate'), idate: c('OutgoingInvoiceDate'),
    supplier: c('SupplierName'), reg: c('LicensePlate'), driver: c('Driver'), vdesc: c('VehicleDescription'), item: c('OrderItemShortDescription'), part: c('VehiclePartDescription'), cat: c('CostCategory'), desc: c('Description'),
  }
  const s = (r: unknown[], i: number) => (i >= 0 && r[i] != null && r[i] !== '' ? String(r[i]).replace(/\s+/g, ' ').trim() : null)
  const out: MaintRow[] = []
  for (const r of rows.slice(h + 1)) {
    if (!r[col.inv] || !r[col.line]) continue
    out.push({
      invoice_no: String(r[col.inv]).trim(), line_id: String(r[col.line]).trim(), order_id: s(r, col.order), cost_centre: s(r, col.cc) ?? '', billing_type: s(r, col.type) ?? 'Charge On',
      excl: num(r[col.excl]), vat: num(r[col.vat]), total: num(r[col.total]), order_date: iso(r[col.odate]), completion_date: iso(r[col.cdate]), invoice_date: iso(r[col.idate]),
      supplier: s(r, col.supplier), reg: normReg(r[col.reg]), driver: s(r, col.driver), vehicle_desc: s(r, col.vdesc), item_desc: s(r, col.item) ?? s(r, col.part), cost_category: s(r, col.cat), description: s(r, col.desc),
    })
  }
  const invoices = [...new Set(out.map((r) => r.invoice_no))]
  const dates = out.map((r) => r.invoice_date).filter((d): d is string => !!d).sort()
  const period = dates.length ? dates[dates.length - 1].slice(0, 7) : null
  return { rows: out, invoices, period, totals: { excl: r2(out.reduce((a, r) => a + r.excl, 0)), vat: r2(out.reduce((a, r) => a + r.vat, 0)), total: r2(out.reduce((a, r) => a + r.total, 0)) } }
}

/** Only real work on the vehicle is set off against a person's accrual; fees and interest stay company cost. */
export const isMaintenanceWork = (billingType: string) => /charge on/i.test(billingType)
