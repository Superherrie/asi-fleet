import fs from 'node:fs'; import XLSX from 'xlsx'; XLSX.set_fs(fs); import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const wb = XLSX.read(fs.readFileSync('C:/Users/User1/Downloads/Customer Monthly Report ASI CONNECT SEPT 2026.xlsx'), { type: 'buffer', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.REPORT, { defval: '' });
console.log('columns:', Object.keys(rows[0]).join(' | '));
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));
const [{ data: veh }, { data: br }, { data: al }] = await Promise.all([sb.from('fleet_vehicles').select('id,registration,make,model,branch_id,ownership,avis_mva,active,disposal_type,disposal_date'), sb.from('fleet_branches').select('id,code,name'), sb.from('fleet_allocations').select('vehicle_id,branch_id,effective_from')]);
const B = (id) => br.find((b) => b.id === id)?.name ?? '';
const avisRegs = new Set(rows.map((r) => norm(r['REGISTRATION NUMBER'])));
console.log(`\nAvis says active: ${rows.length} vehicles`);
const comments = {}; rows.forEach((r) => { const c = r.COMMENTS || '(none)'; comments[c] = (comments[c] ?? 0) + 1; }); console.log('comments:', comments);
const cc = {}; rows.forEach((r) => { cc[r['COST CENTRE NAME']] = (cc[r['COST CENTRE NAME']] ?? 0) + 1; }); console.log('Avis cost centres:', cc);
console.log('total rental/month', rows.reduce((s, r) => s + Number(r['RENTAL AMOUNT'] || 0), 0).toFixed(2), '| maint charge out total', rows.reduce((s, r) => s + Number(r['MAINT CHARGE OUT TOTAL'] || 0), 0).toFixed(2));
// 1. on Avis list but not on master / inactive on master
console.log('\n1) On Avis active list but NOT on our master:'); for (const r of rows) { const v = veh.find((x) => norm(x.registration) === norm(r['REGISTRATION NUMBER'])); if (!v) console.log(`   ${r['REGISTRATION NUMBER']} ${r['MRM DESCRIPTION']} ${r['COST CENTRE NAME']} rental ${r['RENTAL AMOUNT']} driver ${r['DRIVER NAME']}`); }
console.log('\n2) On Avis active list but INACTIVE / disposed on our master:'); for (const r of rows) { const v = veh.find((x) => norm(x.registration) === norm(r['REGISTRATION NUMBER'])); if (v && !v.active) console.log(`   ${r['REGISTRATION NUMBER']} ours: ${v.disposal_type ?? 'inactive'} ${v.disposal_date ?? ''} | Avis: ${r.COMMENTS} end ${d(r['CONTRACT END DATE'])}`); }
console.log('\n3) Avis vehicles on our master (active) that Avis does NOT list as active:'); for (const v of veh.filter((x) => x.ownership === 'avis' && x.active && !avisRegs.has(norm(x.registration)))) console.log(`   ${v.registration} ${v.make ?? ''} ${v.model ?? ''} ${B(v.branch_id)} MVA ${v.avis_mva ?? ''}`);
console.log('\n4) Ownership mismatch: on Avis list but our master says owned:'); for (const r of rows) { const v = veh.find((x) => norm(x.registration) === norm(r['REGISTRATION NUMBER'])); if (v && v.ownership !== 'avis') console.log(`   ${r['REGISTRATION NUMBER']} ours=${v.ownership} ${B(v.branch_id)}`); }
console.log('\n5) Cost centre (Avis) vs our branch:'); const alias = { GAUTENG: 'Gauteng', KATHU: 'Kathu', 'RICHARDS BAY': 'Richards Bay', 'EAST LONDON': 'East London', SECUNDA: 'Secunda', RUSTENBURG: 'Rustenburg', DURBAN: 'Durban', 'CAPE TOWN': 'Cape Town', VEREENIGING: 'Vereeniging', MDB: 'Middelburg', ZZZ: 'Other / RJR Electrical', 'INTER CONNECT': 'Inter Connect' };
let mm = 0; for (const r of rows) { const v = veh.find((x) => norm(x.registration) === norm(r['REGISTRATION NUMBER'])); if (!v) continue; const ours = B(v.branch_id); const theirs = alias[r['COST CENTRE NAME']] ?? r['COST CENTRE NAME']; if (ours && theirs.toUpperCase() !== ours.toUpperCase()) { mm++; console.log(`   ${r['REGISTRATION NUMBER'].padEnd(10)} Avis ${String(r['COST CENTRE NAME']).padEnd(14)} ours ${ours}`); } } console.log(`   ${mm} differ`);
// 6. contract status: over term / ending soon / km
console.log('\n6) Contract position (end date, months left, km vs contract km):');
const soon = rows.map((r) => ({ reg: r['REGISTRATION NUMBER'], cc: r['COST CENTRE NAME'], end: d(r['CONTRACT END DATE']), left: Number(r['MONTHS LEFT']), ckm: Number(r['LAST CONTRACT KM']), odo: Number(r['LAST ODOMETER READING'] ?? r['LAST OD'] ?? 0), rental: Number(r['RENTAL AMOUNT']), comment: r.COMMENTS, proj: Number(r['PROJECTED KM AT END'] ?? r['PROJECTED KMS'] ?? 0), excess: Number(r['EXCESS KILOMETRE CHARGE'] || 0) })).sort((a, b) => a.left - b.left);
for (const r of soon.filter((x) => x.left <= 3)) console.log(`   ${r.reg.padEnd(10)} ${String(r.cc).padEnd(13)} ends ${r.end} (${r.left} mo) ${String(r.comment).padEnd(12)} rental ${r.rental.toFixed(2).padStart(9)} contract km ${r.ckm} odo ${r.odo}`);
console.log('\n   months-left distribution:', soon.reduce((a, r) => { const k = r.left < 0 ? 'over term' : r.left <= 3 ? '0-3' : r.left <= 12 ? '4-12' : '13+'; a[k] = (a[k] ?? 0) + 1; return a; }, {}));
fs.writeFileSync('scripts/avis-active-rows.json', JSON.stringify(rows.slice(0, 3), (k, v) => v instanceof Date ? v.toISOString().slice(0, 10) : v, 1));
