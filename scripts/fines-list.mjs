// Avis fine-administration fees per registration and driver (July + August 2026 statements) → Excel
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js'; import ExcelJS from 'exceljs';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const [{ data: lines }, { data: veh }, { data: emps }, { data: cards }, { data: br }] = await Promise.all([
  sb.from('fleet_avis_lines').select('period,reg,driver_name,cost_centre_name,amount_due,transaction_date,vehicle_id,branch_id,document_no,transaction_number,mva_number').eq('transaction_type', 'FINESINV').in('period', ['2026-08', '2026-09']),
  sb.from('fleet_vehicles').select('id,registration,make,model,branch_id,ownership'), sb.from('fleet_employees').select('id,full_name,emp_no,vehicle_reg,branch_id'), sb.from('fleet_cards').select('fa_driver_name,fa_reg,vehicle_id,employee_id,active'), sb.from('fleet_branches').select('id,code,name')]);
const B = (id) => br.find((b) => b.id === id)?.code ?? '';
const label = { '2026-08': 'Aug statement (3 Aug 2026)', '2026-09': 'Sep statement (1 Sep 2026)' };
const rows = new Map();
for (const l of lines) {
  const reg = norm(l.reg); const v = veh.find((x) => x.id === l.vehicle_id) ?? veh.find((x) => norm(x.registration) === reg);
  const owner = emps.find((e) => norm(e.vehicle_reg) === reg);
  const card = cards.find((c) => c.active && (c.vehicle_id && c.vehicle_id === v?.id || norm(c.fa_reg) === reg));
  const cardEmp = card?.employee_id ? emps.find((e) => e.id === card.employee_id) : null;
  const driver = l.driver_name || owner?.full_name || cardEmp?.full_name || card?.fa_driver_name || '';
  const k = reg; const r = rows.get(k) ?? { reg: l.reg, driver, vehicle: v ? `${v.make ?? ''} ${v.model ?? ''}`.trim() : '', onMaster: !!v, ownership: v?.ownership ?? '', branch: B(v?.branch_id ?? l.branch_id) || (l.cost_centre_name ?? ''), avisCc: l.cost_centre_name ?? '', aug: 0, sep: 0, augR: 0, sepR: 0, dates: new Set() };
  if (l.period === '2026-08') { r.aug++; r.augR += Number(l.amount_due); } else { r.sep++; r.sepR += Number(l.amount_due); }
  if (l.transaction_date) r.dates.add(l.transaction_date); if (!r.driver && driver) r.driver = driver; rows.set(k, r);
}
const list = [...rows.values()].map((r) => ({ ...r, total: r.aug + r.sep, totalR: r.augR + r.sepR })).sort((a, b) => b.total - a.total || a.reg.localeCompare(b.reg));
console.log(`registrations ${list.length}; Aug fines ${list.reduce((s, r) => s + r.aug, 0)} R ${list.reduce((s, r) => s + r.augR, 0).toFixed(2)}; Sep ${list.reduce((s, r) => s + r.sep, 0)} R ${list.reduce((s, r) => s + r.sepR, 0).toFixed(2)}`);
console.log('TOP 25'); for (const r of list.slice(0, 25)) console.log(`${r.reg.padEnd(10)} ${r.driver.padEnd(28)} ${r.vehicle.padEnd(26)} ${r.branch.padEnd(6)} Aug ${String(r.aug).padStart(3)}  Sep ${String(r.sep).padStart(3)}  total ${String(r.total).padStart(3)}  R ${r.totalR.toFixed(2)}${r.onMaster ? '' : '   (not on master)'}`);
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Fines per vehicle');
ws.columns = [{ header: 'Registration', key: 'reg', width: 13 }, { header: 'Driver', key: 'driver', width: 30 }, { header: 'Vehicle', key: 'vehicle', width: 28 }, { header: 'Branch', key: 'branch', width: 9 }, { header: 'Avis cost centre', key: 'avisCc', width: 18 }, { header: 'Ownership', key: 'ownership', width: 10 }, { header: 'On master', key: 'onMaster', width: 10 },
  { header: `Fines ${label['2026-08']}`, key: 'aug', width: 14 }, { header: 'R Aug', key: 'augR', width: 11 }, { header: `Fines ${label['2026-09']}`, key: 'sep', width: 14 }, { header: 'R Sep', key: 'sepR', width: 11 }, { header: 'Fines total', key: 'total', width: 11 }, { header: 'R total', key: 'totalR', width: 12 }];
for (const r of list) ws.addRow({ ...r, onMaster: r.onMaster ? 'yes' : 'NO' });
const t = ws.addRow({ reg: 'TOTAL', aug: list.reduce((s, r) => s + r.aug, 0), augR: list.reduce((s, r) => s + r.augR, 0), sep: list.reduce((s, r) => s + r.sep, 0), sepR: list.reduce((s, r) => s + r.sepR, 0), total: list.reduce((s, r) => s + r.total, 0), totalR: list.reduce((s, r) => s + r.totalR, 0) }); t.font = { bold: true };
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1B3A' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: `M${list.length + 1}` };
for (const c of ['augR', 'sepR', 'totalR']) ws.getColumn(c).numFmt = '#,##0.00';
ws.eachRow((row, i) => { if (i > 1 && row.getCell('onMaster').value === 'NO') row.getCell('reg').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }; });
const det = wb.addWorksheet('Each fine');
det.columns = [{ header: 'Transaction date', key: 'date', width: 14 }, { header: 'Avis invoice no.', key: 'doc', width: 20 }, { header: 'Avis reference', key: 'ref', width: 16 }, { header: 'MVA', key: 'mva', width: 10 }, { header: 'Registration', key: 'reg', width: 13 }, { header: 'Driver', key: 'driver', width: 30 }, { header: 'Branch', key: 'branch', width: 9 }, { header: 'Avis cost centre', key: 'cc', width: 18 }, { header: 'Fee incl VAT', key: 'amt', width: 12 }, { header: 'Statement', key: 'stmt', width: 26 }];
for (const l of [...lines].sort((a, b) => (a.transaction_date ?? '').localeCompare(b.transaction_date ?? '') || String(a.document_no).localeCompare(String(b.document_no)))) { const r = rows.get(norm(l.reg)); det.addRow({ date: l.transaction_date, doc: l.document_no, ref: l.transaction_number, mva: l.mva_number, reg: l.reg, driver: r?.driver ?? '', branch: r?.branch ?? '', cc: l.cost_centre_name ?? '', amt: Number(l.amount_due), stmt: label[l.period] }); }
det.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; det.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1B3A' } }; det.views = [{ state: 'frozen', ySplit: 1 }]; det.autoFilter = { from: 'A1', to: `J${lines.length + 1}` }; det.getColumn('amt').numFmt = '#,##0.00';
const out = 'C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/Fleet/Output/Avis traffic fines per vehicle - Jul-Aug 2026.xlsx';
await wb.xlsx.writeFile(out); console.log('wrote', out);
