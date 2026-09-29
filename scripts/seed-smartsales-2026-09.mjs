// Smart Sales Solutions (Pty) Ltd t/a Corporate Business Solutions - North: invoice pack of September 2026 ("Smartsales September 2026 (1).pdf", 35 scanned pages).
// The pack has no text layer, so the invoices were transcribed by hand. Copier invoices are loaded into fleet_copier_invoices; PABX / VoIP invoices are only totalled.
//   node scripts/seed-smartsales-2026-09.mjs [--apply]
import fs from 'node:fs'; import { createClient } from '@supabase/supabase-js'
for (const l of fs.readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim() }
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const apply = process.argv.includes('--apply')
const SUPPLIER = 'Smart Sales Solutions (Pty) Ltd t/a Corporate Business Solutions - North', CUSTOMER = 'Interconnect Systems (Pty) Ltd', FILE = 'Smartsales September 2026 (1).pdf'

// [page, invoice, date, serial, model, site, rental, rental_for, mono [open, close, qty, rate, charge], colour [...], excl, incl]
const COPIERS = [
  [1, 'INV00008064', '2026-09-21', 'AA2M021514039', 'Bizhub C250i', '11 Suffert Street, New Germany, Durban', 2900, 'Oct 2026', [53573, 54924, 1351, 0.10, 135.10], [110154, 110612, 458, 0.66, 302.28], 3337.39, 3838.00],
  [13, 'INV00007998', '2026-09-15', 'AA2M021120875', 'Bizhub C250i', 'Rustenburg', 3300, 'Oct 2026', null, null, 3300, 3795.00],
  [18, 'INV00008020', '2026-09-21', 'W2W8Z57449', 'TA2552ci', 'Vereeniging', 1699, 'Oct 2026', null, null, 1699, 1953.85],
  [19, 'INV00008019', '2026-09-21', 'ACVD021023897', 'Bizhub C257i', 'Port Elizabeth', 1690, 'Oct 2026', null, null, 1690, 1943.50],
  [20, 'INV00008026', '2026-09-21', 'RVP1507763', 'TA2554ci', '20 Kalk Street, Kathu', 3166.48, 'Oct 2026', null, null, 3166.48, 3641.45],
  [21, 'INV00008047', '2026-09-21', 'RUY1623664', 'TA352ci', 'ABSA Towers West, 15 Troye Street, Johannesburg (M/R Patience Matolo)', 1400, 'Oct 2026', [9950, 9950, 0, 0.24, 0], [18547, 18547, 0, 1.14, 0.01], 1400.01, 1610.01],
  [22, 'INV00008050', '2026-09-21', 'AA2M021529848', 'Bizhub C250i', 'Directors - Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 3300, 'Oct 2026', [10169, 10354, 185, 0.13, 24.05], [22096, 22523, 427, 0.86, 367.22], 3691.27, 4244.96],
  [23, 'INV00008049', '2026-09-21', 'R4W2122594', 'M3145dn', 'Stores - Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 1799, 'Oct 2026', null, null, 1799, 2068.85],
  [24, 'INV00008057', '2026-09-21', 'R4W2122595', 'M3145dn', 'Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 1799, 'Oct 2026', [18386, 18668, 282, 0.20, 56.40], null, 1855.40, 2133.71],
  [25, 'INV00008056', '2026-09-21', 'AA2M021514202', 'Bizhub C250i', 'Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 3300, 'Oct 2026', [42235, 44433, 2198, 0.15, 329.70], [72736, 74058, 1322, 0.93, 1229.46], 4859.16, 5588.04],
  [26, 'INV00008055', '2026-09-21', 'H561X03459', 'TA2554ci', 'Unit 4A Brass Link Rd, Alton, Richards Bay', 3999, 'Oct 2026', [121976, 124405, 2429, 0.61, 1481.69], [15966, 16243, 277, 2.09, 578.93], 6059.62, 6968.56],
  [27, 'INV00008063', '2026-09-21', 'AA2M021531310', 'Bizhub C250i', 'Admin Dept / Safety 1 - Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 3300, 'Oct 2026', [65110, 65229, 119, 0.15, 17.85], [83663, 83802, 139, 1.04, 144.56], 3462.41, 3981.77],
  // printed with reading date 20.05.2020 - 24.06.2020 and no closing mono reading
  [28, 'INV00008062', '2026-09-21', 'AA2M021112836', 'Bizhub C250i', 'Mount Royal Business Park, Unit D, Old Pretoria Road, Midrand', 3400, 'Oct 2026', [46864, null, 1243, 0.12, 149.16], [96617, 98226, 1609, 0.86, 1383.74], 4932.90, 5672.83],
  [29, 'INV00008061', '2026-09-21', 'RUY1623431', 'TA352ci', 'Turnbery Office Park, ASI Place, 48 Grosvenor Rd, Bryanston (Tracey)', 1400, 'Oct 2026', [10416, 11016, 600, 0.14, 84.00], [12599, 12601, 2, 0.91, 1.82], 1485.82, 1708.69],
  // printed readings are garbled: mono "Opening Reading Closing Reading 6302", colour 147106 -> 17583 (17106 -> 17583 gives the 477 billed)
  [30, 'INV00008060', '2026-09-21', 'H562327789', 'TA3554ci', 'WBHO Sales - WBHO Construction Site, Cnr Allandale and Old Pretoria Rd, Halfway House, Midrand', 3300, 'Oct 2026', [null, 6302, 169, 0.14, 23.66], [null, 17583, 477, 0.87, 414.99], 3738.65, 4299.45],
  [31, 'INV00008069', '2026-09-21', 'H561Z14512', 'TA2554ci', '08 Dwyka Street, Stikland Industrial, Cape Town', 2500, 'Oct 2026', [62406, 63003, 597, 0.19, 113.43], [82611, 83838, 1227, 1.07, 1312.89], 3926.32, 4515.26],
  [32, 'INV00008068', '2026-09-21', 'A93E021249280', 'Bizhub C3350ci / TA352ci (loan RUY2X31026)', '08 Dwyka Street, Stikland Industrial, Cape Town', 2099, 'Oct 2026', [12658, 13306, 648, 0.20, 129.60], [12235, 13342, 1107, 1.15, 1273.05], 3501.65, 4026.90],
  // mono readings printed 42382 -> 55846 (13 464) but 3 464 billed; no rental on this machine
  [33, 'INV00008074', '2026-09-21', 'W2W6X05952', 'TA2552ci', '16 Emerald Street, Property Plus Business Park, Unit 13 & 14, Secunda', 0, null, [42382, 55846, 3464, 0.35, 1212.40], [145877, 148153, 2276, 2.46, 5598.96], 6811.36, 7833.06],
  [34, 'INV00008073', '2026-09-21', 'H843907200', 'MA3500ci', '9 Bunson Road, Secunda', 1600, 'Oct 2026', [2286, 2327, 41, 0.16, 6.56], [8719, 8754, 35, 1.48, 51.80], 1658.36, 1907.11],
  [35, 'INV00008072', '2026-09-21', 'AA2M021513619', 'Bizhub C250i', '9 Bunson Road, Secunda', 2900, 'Oct 2026', [86640, 86691, 51, 0.13, 6.63], [12434, 12465, 31, 0.91, 28.21], 2934.84, 3375.06],
]
// [page, invoice, what, site, excl, incl, equipment rental inside excl]
const TELEPHONY = [
  [2, 'INV00008010', 'Rental - serial CO74ad25883 (device unknown)', 'Durban', 1037.00, 1192.55, 1037.00],
  [3, 'INV00008009', 'VoIP', 'Durban', 500.84, 575.97, 0],
  [4, 'INV00008008', 'VoIP equipment rental', 'All branches', 3499.00, 4023.85, 3499.00],
  [5, 'INV00008007', 'VoIP + equipment rental (011 521 2300)', '344 Surrey Ave, Ferndale', 5115.40, 5882.71, 2600.00],
  [6, 'INV00008006', 'VoIP', 'Thabazimbi', 1406.61, 1617.60, 0],
  [7, 'INV00008005', 'VoIP', 'Port Elizabeth', 1406.61, 1617.60, 0],
  [8, 'INV00008004', 'VoIP', 'Kimberley', 1406.60, 1617.59, 0],
  [9, 'INV00008003', 'VoIP', 'Richards Bay', 950.20, 1092.73, 0],
  [10, 'INV00008002', 'VoIP', 'Vereeniging', 2028.49, 2332.76, 0],
  [11, 'INV00008001', 'VoIP', 'Bloemfontein', 1406.61, 1617.60, 0],
  [12, 'INV00007999', 'PABX rental UCM6302 serial 25QK6VWM414E8012', 'Bloemfontein', 1100.00, 1265.00, 1100.00],
  [14, 'INV00008015', 'VoIP', 'Rustenburg', 1770.47, 2036.05, 0],
  [15, 'INV00008014', 'VoIP', 'Pretoria (billed at Mount Royal)', 701.01, 806.16, 0],
  [16, 'INV00008013', 'PABX rental Samsung 7070 serial S2J4801431 (Sept 2026)', 'Mount Royal, Midrand', 2149.43, 2471.84, 2149.43],
  [17, 'INV00008021', 'VoIP + equipment rental', 'Kathu', 2725.41, 3134.22, 950.00],
]

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const { data: cop } = await s.from('fleet_copiers').select('id,serial_no,model,rental_excl,location'); const bySerial = new Map(); for (const c of cop) for (const sn of c.serial_no.split('/')) bySerial.set(sn.trim().toUpperCase(), c)
let rent = 0, clicks = 0, excl = 0, incl = 0
for (const [page, invoice_no, invoice_date, serial_no, model, site, rental, rental_for, mono, colour, subtotal, total] of COPIERS) {
  const c = bySerial.get(serial_no); const click = (mono?.[4] ?? 0) + (colour?.[4] ?? 0); const gap = r2(subtotal - rental - click)
  rent += rental; clicks += click; excl += subtotal; incl += total
  console.log(`p${String(page).padStart(2)} ${invoice_no} ${serial_no.padEnd(14)} ${c ? 'copier ' + String(c.id).padStart(2) : 'NO MATCH '} rental ${String(rental).padStart(8)}${c && Number(c.rental_excl) !== rental ? ` (schedule ${c.rental_excl})` : ''} clicks ${click.toFixed(2).padStart(8)} excl ${subtotal.toFixed(2).padStart(9)}${Math.abs(gap) > 0.02 ? ` GAP ${gap}` : ''}${Math.abs(r2(subtotal * 1.15) - total) > 0.02 ? ' VAT?' : ''}`)
  if (apply) {
    const row = { copier_id: c?.id ?? null, serial_no, supplier_entity: SUPPLIER, account_no: null, customer_name: CUSTOMER, invoice_no, invoice_date, period: invoice_date.slice(0, 7), kind: rental ? 'rental' : 'service', contract_no: null, model, site, rental_excl: rental, rental_for, admin_fee: 0,
      mono_open: mono?.[0] ?? null, mono_close: mono?.[1] ?? null, mono_qty: mono?.[2] ?? null, mono_rate: mono?.[3] ?? null, mono_charge: mono?.[4] ?? null, mono_read: mono ? '2026-09-17' : null,
      colour_open: colour?.[0] ?? null, colour_close: colour?.[1] ?? null, colour_qty: colour?.[2] ?? null, colour_rate: colour?.[3] ?? null, colour_charge: colour?.[4] ?? null,
      scan_qty: null, scan_rate: null, scan_charge: null, subtotal, vat: r2(total - subtotal), total, source_file: FILE }
    const { error } = await s.from('fleet_copier_invoices').upsert(row, { onConflict: 'invoice_no' }); if (error) console.log('    ERR', error.message)
  }
}
console.log(`\nCopiers: ${COPIERS.length} invoices | rental ${r2(rent)} | clicks ${r2(clicks)} | excl ${r2(excl)} | incl ${r2(incl)}`)
const t = TELEPHONY.reduce((a, x) => ({ excl: a.excl + x[4], incl: a.incl + x[5], eq: a.eq + x[6] }), { excl: 0, incl: 0, eq: 0 })
console.log(`Telephony: ${TELEPHONY.length} invoices | excl ${r2(t.excl)} | incl ${r2(t.incl)} | of which equipment rental ${r2(t.eq)}`)
console.log(`Pack: ${COPIERS.length + TELEPHONY.length} invoices | excl ${r2(excl + t.excl)} | incl ${r2(incl + t.incl)}`)
console.log(`Schedule rental all copiers: ${r2(cop.reduce((a, c) => a + Number(c.rental_excl), 0))}`)
console.log(apply ? '\napplied' : '\ndry run - add --apply to load')
