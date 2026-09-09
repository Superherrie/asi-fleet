// Client-side parsers for the monthly source files. Each returns plain rows the
// import pages match to masters and then commit.
import * as XLSX from 'xlsx'
import { normKey, normReg } from './match'
import { periodOf, round2, toIsoDate, toNum } from './format'

export type Row = unknown[]

export async function readWorkbook(file: File) {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: false })
}
export function sheetRows(wb: XLSX.WorkBook, name?: string): Row[] {
  const ws = wb.Sheets[name ?? wb.SheetNames[0]]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[]
}
/** find the header row: first row containing all `must` keys (normalised) */
export function findHeader(rows: Row[], must: string[], maxScan = 30) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const keys = rows[i].map(normKey)
    if (must.every((m) => keys.includes(m))) return i
  }
  return -1
}
/** header name → first column index (normalised) */
export function colIndex(header: Row) {
  const idx = new Map<string, number>()
  header.forEach((h, i) => { const k = normKey(h); if (k && !idx.has(k)) idx.set(k, i) })
  return idx
}
function pick(idx: Map<string, number>, ...names: string[]) {
  for (const n of names) { const i = idx.get(normKey(n)); if (i != null) return i }
  return -1
}

// ---------------------------------------------------------------------------
// First Auto statement
// ---------------------------------------------------------------------------
export interface FaRow {
  fa_name_code: string; fa_code: string; fa_driver_name: string; fa_reg: string; make: string; model: string
  fuel: number; oil_excl: number; oil_vat: number; repairs_excl: number; repairs_vat: number; tyres_excl: number; tyres_vat: number
  accident_excl: number; accident_vat: number; maint_excl: number; maint_vat: number; overhaul_excl: number; overhaul_vat: number
  other_excl: number; other_vat: number; toll_excl: number; toll_vat: number; expenses_excl: number; expenses_vat: number
  fees_excl: number; fees_vat: number; grand_total: number; odo_close: number | null; odo_prev: number | null
  kms: number | null; litres: number | null; consumption: number | null
}
export interface FaParse { period: string | null; rows: FaRow[]; sheet: string }

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }

export function parseFirstAuto(wb: XLSX.WorkBook): FaParse {
  // pick the first sheet that has the statement header
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name)
    const h = findHeader(rows, ['driver name', 'reg num'])
    if (h < 0) continue
    const idx0 = colIndex(rows[h])
    if (idx0.has('fuel month') || idx0.has('direct var cost month')) return parseFirstAutoCsv(rows, h, name)
    if (idx0.has('fuel value') && idx0.has('grand total')) return parseFirstAutoDetailed(rows, h, name)
    let period: string | null = null
    for (const r of rows.slice(0, h)) for (const c of r) {
      const m = String(c).match(/Monthend Date:\s*([A-Za-z]+)\s+(\d{4})/i)
      if (m && MONTHS[m[1].toLowerCase()]) period = `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}`
    }
    const idx = colIndex(rows[h])
    const c = (...n: string[]) => pick(idx, ...n)
    const col = {
      name: c('name'), code: c('code'), driver: c('driver name'), reg: c('reg num', 'reg no', 'registration'), make: c('make'), model: c('model'),
      fuel: c('fuel mth sum', 'fuel'), oil_v: c('oil vat'), oil_x: c('oil excl vat'), rep_v: c('repairs vat'), rep_x: c('repairs excl vat'),
      tyr_v: c('tyres vat'), tyr_x: c('tyres excl vat'), acc_v: c('accident vat'), acc_x: c('accident excl vat'),
      mnt_v: c('maint serv vat', 'maint vat'), mnt_x: c('maint excl vat'), ovh_v: c('overhaul vat'), ovh_x: c('overhaul excl vat'),
      oth_v: c('other vat'), oth_x: c('other excl vat'), toll_v: c('toll vat'), toll_x: c('toll excl vat'),
      exp_v: c('total expenses vat'), exp_x: c('total expenses excl vat'),
      fee_fixed: c('fixed fee'), fee_lost: c('fee lost card sum'), fee_int: c('fee interest sum'), fee_mag: c('fee magnetic media sum'),
      fee_txn: c('transaction fee'), fee_scr: c('fee inv scrutiny sum'), fee_vat: c('vat fees levied'), fee_tot: c('total fees'),
      lost_j: c('lost card journal sum 1', 'lost card journal sum'), grand: c('grand total'),
      odo_c: c('odo close this mth'), litres: c('litre total sum'), odo_p: c('odo prev mth num'), kms: c('kms'), cons: c('consump med mth sum'),
    }
    const v = (r: Row, i: number) => (i >= 0 ? toNum(r[i]) : 0)
    const nv = (r: Row, i: number) => (i >= 0 && r[i] !== '' ? toNum(r[i]) : null)
    const out: FaRow[] = []
    for (const r of rows.slice(h + 1)) {
      const reg = normReg(r[col.reg]); const driver = String(r[col.driver] ?? '').trim()
      if (!reg && !driver) continue
      if (/^total/i.test(String(r[col.name] ?? ''))) continue
      // The Combined Statement merges the fuel card with the WesBank maintenance (CI) invoices. Keep the fuel-card part only:
      // maintenance columns and the "Inv Scrutiny" fee (= CI contract billing + interest) are imported from the CI invoices themselves.
      const fees_excl = round2([col.fee_fixed, col.fee_lost, col.fee_int, col.fee_mag, col.fee_txn, col.lost_j].reduce((s, i) => s + v(r, i), 0))
      const fees_vat = round2((v(r, col.fee_fixed) + v(r, col.fee_mag) + v(r, col.fee_txn) + v(r, col.lost_j)) * 0.15) // 'VAT fees levied' also carries VAT on the CI contract billing; interest / var fee is non-VATable
      const expenses_excl = round2(v(r, col.fuel) + v(r, col.oil_x) + v(r, col.toll_x))
      const expenses_vat = round2(v(r, col.oil_v) + v(r, col.toll_v))
      const grand_total = round2(expenses_excl + expenses_vat + fees_excl + fees_vat)
      out.push({
        fa_name_code: String(r[col.name] ?? '').trim(), fa_code: String(r[col.code] ?? '').trim(), fa_driver_name: driver, fa_reg: reg,
        make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
        fuel: v(r, col.fuel), oil_excl: v(r, col.oil_x), oil_vat: v(r, col.oil_v), repairs_excl: 0, repairs_vat: 0,
        tyres_excl: 0, tyres_vat: 0, accident_excl: 0, accident_vat: 0,
        maint_excl: 0, maint_vat: 0, overhaul_excl: 0, overhaul_vat: 0,
        other_excl: 0, other_vat: 0, toll_excl: v(r, col.toll_x), toll_vat: v(r, col.toll_v),
        expenses_excl, expenses_vat, fees_excl, fees_vat, grand_total,
        odo_close: nv(r, col.odo_c), odo_prev: nv(r, col.odo_p), kms: nv(r, col.kms), litres: nv(r, col.litres), consumption: nv(r, col.cons),
      })
    }
    return { period, rows: out, sheet: name }
  }
  throw new Error('No sheet with a First Auto header (Driver Name / Reg Num) found')
}

/** First Auto "Detailed FA Report" — the fuel-card statement itself: Fuel Value, Oil Value, Repair and Maint, Tyre Value, Accident, Other,
 *  Toll Value (all incl VAT), Fixed/Var/Trans/Mag/Lost Card fees, Invoice Scr, Vat On Fees, Grand Total (= the fuel-card debit order), Opening/Closing Odo, Span, Litres. */
function parseFirstAutoDetailed(rows: Row[], h: number, sheet: string): FaParse {
  const idx = colIndex(rows[h]); const c = (...n: string[]) => pick(idx, ...n)
  const col = { code: c('cost code'), name: c('cost name'), driver: c('driver'), reg: c('reg num'), yr: c('yr_mth'), make: c('make'), model: c('model'), odoO: c('opening odo'), odoC: c('closing odo'), span: c('span'), litres: c('litres'),
    fuel: c('fuel value'), oil: c('oil value'), rm: c('repair and maint'), tyres: c('tyre value'), acc: c('accident value'), other: c('other value'), toll: c('toll value'),
    fixed: c('fixed fee'), varf: c('var fee'), trans: c('trans fee'), mag: c('mag fee'), lost: c('lost card fee'), scr: c('invoice scr'), feeVat: c('vat on fees'), grand: c('grand total') }
  const v = (r: Row, i: number) => (i >= 0 ? toNum(r[i]) : 0); const nv = (r: Row, i: number) => (i >= 0 && r[i] !== '' ? toNum(r[i]) : null)
  const split = (incl: number) => { const excl = round2(incl / 1.15); return { excl, vat: round2(incl - excl) } }
  let period: string | null = null
  const out: FaRow[] = []
  for (const r of rows.slice(h + 1)) {
    const reg = normReg(r[col.reg]); const driver = String(r[col.driver] ?? '').trim(); if (!reg && !driver) continue
    const oil = split(v(r, col.oil)), rm = split(v(r, col.rm)), tyres = split(v(r, col.tyres)), acc = split(v(r, col.acc)), other = split(v(r, col.other)), toll = split(v(r, col.toll))
    const fees_excl = round2(v(r, col.fixed) + v(r, col.varf) + v(r, col.trans) + v(r, col.mag) + v(r, col.lost) + v(r, col.scr)); const fees_vat = v(r, col.feeVat)
    const expenses_excl = round2(v(r, col.fuel) + oil.excl + rm.excl + tyres.excl + acc.excl + other.excl + toll.excl); const expenses_vat = round2(oil.vat + rm.vat + tyres.vat + acc.vat + other.vat + toll.vat)
    const grand_total = col.grand >= 0 ? v(r, col.grand) : round2(expenses_excl + expenses_vat + fees_excl + fees_vat)
    const ym = String(r[col.yr] ?? ''); if (!period && /^\d{6}$/.test(ym)) period = `${ym.slice(0, 4)}-${ym.slice(4)}`
    out.push({ fa_name_code: String(r[col.name] ?? '').trim(), fa_code: String(r[col.code] ?? '').trim(), fa_driver_name: driver, fa_reg: reg, make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
      fuel: v(r, col.fuel), oil_excl: oil.excl, oil_vat: oil.vat, repairs_excl: rm.excl, repairs_vat: rm.vat, tyres_excl: tyres.excl, tyres_vat: tyres.vat, accident_excl: acc.excl, accident_vat: acc.vat,
      maint_excl: 0, maint_vat: 0, overhaul_excl: 0, overhaul_vat: 0, other_excl: other.excl, other_vat: other.vat, toll_excl: toll.excl, toll_vat: toll.vat,
      expenses_excl, expenses_vat, fees_excl, fees_vat, grand_total, odo_close: nv(r, col.odoC), odo_prev: nv(r, col.odoO), kms: nv(r, col.span), litres: nv(r, col.litres), consumption: null })
  }
  // YR_MTH on this report is the vehicle's first-registration month, not the statement month → period comes from the file name / picker
  return { period: null, rows: out, sheet }
}

/** The 2026 CSV export: "Cost Name, Reg Num, Driver Name, ... Fuel Month, Oil Month, Maint Services Month, Repairs Month, Tyres Month,
 *  Overhaul Month, Exchanges Month, Direct Var Cost Month, ... Toll Month". Amounts carry no VAT split. */
function parseFirstAutoCsv(rows: Row[], h: number, sheet: string): FaParse {
  const idx = colIndex(rows[h]); const c = (...n: string[]) => pick(idx, ...n)
  const col = {
    name: c('cost name', 'name'), reg: c('reg num'), driver: c('driver name'), me: c('month end date'), make: c('make'), model: c('model'),
    km: c('kms span month'), litres: c('litre_actual_mth'), cons: c('fuel_consump_actual'), fuel: c('fuel month'), oil: c('oil month'), maint: c('maint services month'),
    repairs: c('repairs month'), tyres: c('tyres month'), overhaul: c('overhaul month'), exch: c('exchanges month'), dv: c('direct var cost month'), toll: c('toll month'),
  }
  const v = (r: Row, i: number) => (i >= 0 ? toNum(r[i]) : 0)
  const nv = (r: Row, i: number) => (i >= 0 && r[i] !== '' ? toNum(r[i]) : null)
  let period: string | null = null
  const me = rows[h + 1]?.[col.me]
  if (me != null && me !== '') period = periodOf(toIsoDate(me))
  const out: FaRow[] = []
  for (const r of rows.slice(h + 1)) {
    const reg = normReg(r[col.reg]); const driver = String(r[col.driver] ?? '').trim()
    if (!reg && !driver) continue
    const other = v(r, col.exch)
    const dv = col.dv >= 0 ? v(r, col.dv) : v(r, col.fuel) + v(r, col.oil) + v(r, col.maint) + v(r, col.repairs) + v(r, col.tyres) + v(r, col.overhaul) + other
    const toll = v(r, col.toll)
    out.push({
      fa_name_code: String(r[col.name] ?? '').trim(), fa_code: '', fa_driver_name: driver, fa_reg: reg, make: String(r[col.make] ?? '').trim(), model: String(r[col.model] ?? '').trim(),
      fuel: v(r, col.fuel), oil_excl: v(r, col.oil), oil_vat: 0, repairs_excl: v(r, col.repairs), repairs_vat: 0, tyres_excl: v(r, col.tyres), tyres_vat: 0, accident_excl: 0, accident_vat: 0,
      maint_excl: v(r, col.maint), maint_vat: 0, overhaul_excl: v(r, col.overhaul), overhaul_vat: 0, other_excl: other, other_vat: 0, toll_excl: toll, toll_vat: 0,
      expenses_excl: round2(dv + toll), expenses_vat: 0, fees_excl: 0, fees_vat: 0, grand_total: round2(dv + toll),
      odo_close: null, odo_prev: null, kms: nv(r, col.km), litres: nv(r, col.litres), consumption: nv(r, col.cons),
    })
  }
  return { period, rows: out, sheet }
}

// ---------------------------------------------------------------------------
// Avis monthly data
// ---------------------------------------------------------------------------
export interface AvisRow {
  driver_name: string; reg: string; mva_number: string; kilometers: number | null; rental_excl: number; vat: number; amount_due: number
  vat_claimable: number; total: number; cost_centre_name: string; vehicle_type: string; product: string; transaction_type: string
  make_model: string; transaction_date: string | null; document_no: string; transaction_number: string
}
export function parseAvis(wb: XLSX.WorkBook): { rows: AvisRow[]; sheet: string } {
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name)
    const h = findHeader(rows, ['reg no', 'rental'])
    if (h < 0) continue
    const idx = colIndex(rows[h]); const c = (...n: string[]) => pick(idx, ...n)
    const col = {
      driver: c('driver name'), reg: c('reg no', 'reg num', 'registration'), mva: c('mva number'), km: c('kilometers', 'kilometres', 'km'),
      rental: c('rental'), vat: c('vat'), due: c('amount due'), vatc: c('vat claimable'), total: c('total'), cc: c('cost centre', 'centre name'),
      vtype: c('vehicle type'), product: c('product'), ttype: c('transaction type'), mm: c('make_model', 'make model', 'make/model'),
      tdate: c('transaction date', 'date'), doc: c('document no', 'document number', 'invoice no'), tno: c('transaction number'),
    }
    const s = (r: Row, i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    const v = (r: Row, i: number) => (i >= 0 ? toNum(r[i]) : 0)
    const out: AvisRow[] = []
    for (const r of rows.slice(h + 1)) {
      const reg = normReg(r[col.reg]); if (!reg) continue
      const rental = v(r, col.rental); const vat = v(r, col.vat); const vatc = v(r, col.vatc)
      const due = col.due >= 0 ? v(r, col.due) : rental + vat
      const total = col.total >= 0 ? v(r, col.total) : due - vatc
      out.push({
        driver_name: s(r, col.driver), reg, mva_number: s(r, col.mva), kilometers: col.km >= 0 && r[col.km] !== '' ? toNum(r[col.km]) : null,
        rental_excl: rental, vat, amount_due: due, vat_claimable: vatc, total, cost_centre_name: s(r, col.cc), vehicle_type: s(r, col.vtype),
        product: s(r, col.product), transaction_type: s(r, col.ttype), make_model: s(r, col.mm), transaction_date: toIsoDate(r[col.tdate]),
        document_no: s(r, col.doc), transaction_number: s(r, col.tno),
      })
    }
    return { rows: out, sheet: name }
  }
  throw new Error('No sheet with an Avis header (REG NO / RENTAL) found')
}

// ---------------------------------------------------------------------------
// Insurance schedule
// ---------------------------------------------------------------------------
export interface InsuranceRow {
  reg: string; year: number | null; make: string; model: string; branch_name: string; tracking_unit: string
  retail_value: number | null; premium_incl: number; rate: number | null
}
export function parseInsurance(wb: XLSX.WorkBook): { rows: InsuranceRow[]; sheet: string } {
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name)
    const h = findHeader(rows, ['reg no'])
    if (h < 0) continue
    const idx = colIndex(rows[h]); const c = (...n: string[]) => pick(idx, ...n)
    const col = {
      reg: c('reg no', 'reg num', 'registration'), year: c('year'), make: c('make'), model: c('model'), branch: c('branch', 'cost centre'),
      trk: c('tracking unit', 'tracking'), value: c('latest retail value', 'retail value', 'sum insured', 'insured value'),
      prem: c('average deduction', 'premium', 'monthly premium', 'incl'), rate: c('rate'),
    }
    const s = (r: Row, i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    const out: InsuranceRow[] = []
    for (const r of rows.slice(h + 1)) {
      const reg = normReg(r[col.reg]); if (!reg || reg.length < 5) continue
      const premium = toNum(r[col.prem]); if (!premium) continue
      out.push({
        reg, year: col.year >= 0 && r[col.year] !== '' ? toNum(r[col.year]) : null, make: s(r, col.make), model: s(r, col.model),
        branch_name: s(r, col.branch), tracking_unit: s(r, col.trk), retail_value: col.value >= 0 && r[col.value] !== '' ? toNum(r[col.value]) : null,
        premium_incl: premium, rate: col.rate >= 0 && r[col.rate] !== '' ? toNum(r[col.rate]) : null,
      })
    }
    return { rows: out, sheet: name }
  }
  throw new Error('No sheet with an insurance header (Reg no) found')
}

// ---------------------------------------------------------------------------
// Tracking invoices (Cartrack layout + generic fallback by header synonyms)
// ---------------------------------------------------------------------------
export interface TrackingRow {
  invoice: string; invoice_date: string | null; item_code: string; reg: string; description: string; quantity: number | null
  amount_excl: number; vat: number; total: number; branch_name: string; contract_id: string
}
export function parseTracking(wb: XLSX.WorkBook, vatRate: number): { rows: TrackingRow[]; sheet: string; assumedVat: boolean } {
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb, name)
    let h = findHeader(rows, ['reg num']); if (h < 0) h = findHeader(rows, ['registration']); if (h < 0) h = findHeader(rows, ['reg no'])
    if (h < 0) h = findHeader(rows, ['vehicle'])
    if (h < 0) continue
    const idx = colIndex(rows[h]); const c = (...n: string[]) => pick(idx, ...n)
    const col = {
      inv: c('invoice', 'invoice no', 'invoice number', 'document', 'doc no'), date: c('date', 'invoice date', 'transaction date'),
      item: c('item code', 'code', 'product'), reg: c('reg num', 'registration', 'reg no', 'vehicle', 'vehicle reg'),
      desc: c('description', 'details', 'narrative'), qty: c('quantity', 'qty'),
      amt: c('amount excl', 'excl', 'nett', 'net', 'amount'), vat: c('vat', 'tax'), total: c('total incl', 'incl', 'gross', 'total'),
      branch: c('branch', 'cost centre', 'department'), contract: c('contract id', 'contract', 'account'),
    }
    const s = (r: Row, i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    const out: TrackingRow[] = []
    const assumedVat = col.vat < 0
    for (const r of rows.slice(h + 1)) {
      const reg = normReg(r[col.reg]); if (!reg) continue
      const total = col.total >= 0 ? toNum(r[col.total]) : toNum(r[col.amt]) * (col.qty >= 0 ? toNum(r[col.qty]) || 1 : 1)
      if (!total && !toNum(r[col.amt])) continue
      let amount_excl: number, vat: number
      if (col.vat >= 0) { vat = toNum(r[col.vat]); amount_excl = col.amt >= 0 && col.amt !== col.total ? toNum(r[col.amt]) : total - vat }
      else { amount_excl = total; vat = Math.round(total * vatRate) / 100 } // provider lists excl amounts; VAT added at import
      out.push({
        invoice: s(r, col.inv), invoice_date: toIsoDate(r[col.date]), item_code: s(r, col.item), reg, description: s(r, col.desc),
        quantity: col.qty >= 0 && r[col.qty] !== '' ? toNum(r[col.qty]) : null, amount_excl, vat, total: amount_excl + vat,
        branch_name: s(r, col.branch), contract_id: s(r, col.contract),
      })
    }
    return { rows: out, sheet: name, assumedVat }
  }
  throw new Error('No sheet with a vehicle registration column found')
}

// ---------------------------------------------------------------------------
// Travel log workbook ("Electronic" sheet of the standard template)
// ---------------------------------------------------------------------------
export interface TravelLogParse {
  emp_no: string; employee_name: string; branch: string; department: string; vehicle_reg: string; period: string | null
  opening_odo: number | null; opening_date: string | null; closing_odo: number | null; closing_date: string | null
  business_km: number; private_km: number
  lines: { trip_date: string | null; opening_km: number | null; closing_km: number | null; private_km: number; business_km: number; destination: string; reason: string }[]
}
export function parseTravelLogWorkbook(wb: XLSX.WorkBook): TravelLogParse {
  const name = wb.SheetNames.find((n) => /electronic/i.test(n)) ?? wb.SheetNames[0]
  const rows = sheetRows(wb, name)
  const cell = (r: number, c: number) => rows[r]?.[c] ?? ''
  const labelRow = (label: string) => rows.findIndex((r) => normKey(r[0]) === label)
  const rEmp = labelRow('employee no'), rName = labelRow('employee name'), rBranch = labelRow('branch'), rDept = labelRow('department'),
    rReg = labelRow('vehicle registration number'), rMonth = labelRow('month')
  const val = (r: number) => (r >= 0 ? String(cell(r, 2)).trim() : '')
  // right-hand summary block: label in col 5, value in col 8
  const rightRow = (re: RegExp) => rows.findIndex((r) => re.test(String(r[5] ?? '')))
  const rOpen = rightRow(/^opening odometer/i), rBiz = rightRow(/^total business km/i), rClose = rightRow(/^closing odometer/i), rPriv = rightRow(/^total private km/i)
  const rv = (r: number) => (r >= 0 && cell(r, 8) !== '' ? toNum(cell(r, 8)) : null)
  const dateBelow = (r: number) => (r >= 0 ? toIsoDate(cell(r + 1, 6)) : null)
  const monthCell = rMonth >= 0 ? cell(rMonth, 2) : ''
  let period: string | null = null
  if (typeof monthCell === 'number') period = toIsoDate(monthCell)?.slice(0, 7) ?? null
  else { const m = String(monthCell).match(/([A-Za-z]+)\D+(\d{2,4})/); if (m) { const mm = Object.keys(MONTHS).find((k) => k.startsWith(m[1].toLowerCase().slice(0, 3))); if (mm) period = `${m[2].length === 2 ? '20' + m[2] : m[2]}-${String(MONTHS[mm]).padStart(2, '0')}` } }
  const hdr = rows.findIndex((r) => normKey(r[0]) === 'date' && normKey(r[1]).startsWith('opening'))
  const lines: TravelLogParse['lines'] = []
  if (hdr >= 0) for (const r of rows.slice(hdr + 2)) {
    const d = toIsoDate(r[0]); const hasKm = r[1] !== '' && r[2] !== '' && (toNum(r[1]) || toNum(r[2]))
    if (!d && !hasKm && !String(r[5]).trim()) continue
    if (!d && !hasKm) continue
    lines.push({ trip_date: d, opening_km: r[1] === '' ? null : toNum(r[1]), closing_km: r[2] === '' ? null : toNum(r[2]),
      private_km: toNum(r[3]), business_km: toNum(r[4]), destination: String(r[5] ?? '').trim(), reason: String(r[7] ?? r[6] ?? '').trim() })
  }
  if (!period) period = lines.find((l) => l.trip_date)?.trip_date?.slice(0, 7) ?? null
  return {
    emp_no: val(rEmp).replace(/\D/g, '').padStart(4, '0').slice(-4), employee_name: val(rName), branch: val(rBranch), department: val(rDept),
    vehicle_reg: normReg(val(rReg)), period, opening_odo: rv(rOpen), opening_date: dateBelow(rOpen), closing_odo: rv(rClose), closing_date: dateBelow(rClose),
    business_km: rv(rBiz) ?? lines.reduce((s, l) => s + l.business_km, 0), private_km: rv(rPriv) ?? lines.reduce((s, l) => s + l.private_km, 0), lines,
  }
}

// ---------------------------------------------------------------------------
// Accrual opening balances: columns Emp No | Name | Balance
// ---------------------------------------------------------------------------
export interface OpeningRow { emp_no: string; name: string; balance: number }
export function parseOpeningBalances(wb: XLSX.WorkBook): OpeningRow[] {
  const rows = sheetRows(wb)
  const h = findHeader(rows, ['emp no']) >= 0 ? findHeader(rows, ['emp no']) : findHeader(rows, ['employee no'])
  const idx = h >= 0 ? colIndex(rows[h]) : new Map([['emp no', 0], ['name', 1], ['balance', 2]])
  const e = pick(idx, 'emp no', 'employee no', 'emp'); const n = pick(idx, 'name', 'employee name', 'employee'); const b = pick(idx, 'balance', 'opening balance', 'amount', 'accrual')
  return rows.slice(h + 1).filter((r) => String(r[e] ?? '').trim()).map((r) => ({
    emp_no: String(r[e]).replace(/\D/g, '').padStart(4, '0').slice(-4), name: String(r[n] ?? '').trim(), balance: toNum(r[b]),
  }))
}
