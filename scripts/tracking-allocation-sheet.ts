// Writes the monthly tracking allocation workbook for Creditors (same as the "Allocation sheet for Creditors" button on Journals → Tracking).
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/tracking-allocation-sheet.ts 2026-09 ["<output folder>"]
import fs from 'node:fs'; import path from 'node:path'
import XLSX from 'xlsx'
XLSX.set_fs(fs)
import { createClient } from '@supabase/supabase-js'
import { trackingAllocationSheets } from '../src/lib/trackingSheet'
import { periodLabel } from '../src/lib/format'
import type { TrackingLine } from '../src/lib/types'

for (const l of fs.readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim() }
const period = process.argv[2]; if (!/^\d{4}-\d{2}$/.test(period ?? '')) { console.error('usage: tracking-allocation-sheet.ts YYYY-MM [folder]'); process.exit(1) }
const outDir = process.argv[3] ?? 'C:/Users/User1/OneDrive - Herman/OneDrive - Conekt Business Group/Desktop/Claude/Fleet/Output'
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const [b, v, e, c, g, st, a, t] = await Promise.all([
  s.from('fleet_branches').select('*'), s.from('fleet_vehicles').select('*'), s.from('fleet_employees').select('*'), s.from('fleet_cards').select('*'),
  s.from('fleet_gl_map').select('*'), s.from('fleet_settings').select('*'), s.from('fleet_allocations').select('*'), s.from('fleet_tracking_lines').select('*').eq('period', period).order('id'),
])
const ctx = { branches: b.data!, vehicles: v.data!, employees: e.data!, cards: c.data!, glmap: g.data!, settings: st.data!, allocations: a.data! }
const lines = (t.data ?? []) as TrackingLine[]; if (!lines.length) { console.error('no tracking lines for', period); process.exit(1) }
const sheets = trackingAllocationSheets(ctx as never, period, lines)
const wb = XLSX.utils.book_new()
for (const sh of sheets) { const ws = XLSX.utils.aoa_to_sheet(sh.rows); if (sh.widths) ws['!cols'] = sh.widths.map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, sh.name) }
const file = path.join(outDir, `Tracking allocation ${periodLabel(period)} - for Creditors.xlsx`)
XLSX.writeFile(wb, file); console.log('written', file, '|', lines.length, 'lines')
for (const r of sheets[0].rows.slice(0, 20)) console.log(r.map((x) => (typeof x === 'number' ? x.toFixed(2) : x ?? '')).join(' | '))
