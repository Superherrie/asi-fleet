import fs from 'node:fs'; import XLSX from 'xlsx'; XLSX.set_fs(fs); import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const rows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync('C:/Users/User1/Downloads/Interconnect Systems, CC VEHICLE LIST.xlsx'), { type: 'buffer' }).Sheets.Sheet1, { header: 1, defval: '' }).slice(4).filter((r) => norm(r[0]));
const list = rows.map((r) => ({ reg: norm(r[0]), vin: String(r[1]).trim(), variant: String(r[2]).trim() }));
const [{ data: veh }, { data: br }, { data: trk }, { data: avisRep }] = await Promise.all([sb.from('fleet_vehicles').select('id,registration,make,model,branch_id,ownership,active,disposal_type,disposal_date,tracking_provider'), sb.from('fleet_branches').select('id,code,name'), sb.from('fleet_tracking_lines').select('reg,provider,period,total').in('period', ['2026-07', '2026-08']), Promise.resolve({ data: null })]);
const B = (id) => br.find((b) => b.id === id)?.code ?? '';
const avis = new Map(XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync('C:/Users/User1/Downloads/Customer Monthly Report ASI CONNECT SEPT 2026.xlsx'), { type: 'buffer' }).Sheets.REPORT, { defval: '' }).map((r) => [norm(r['REGISTRATION NUMBER']), Number(r['RENTAL AMOUNT'])]));
const V = (reg) => veh.find((v) => norm(v.registration) === reg);
const trackerBilled = new Set(trk.filter((t) => t.provider === 'Tracker').map((t) => norm(t.reg))); const cartrackBilled = new Set(trk.filter((t) => t.provider === 'Cartrack').map((t) => norm(t.reg)));
console.log(`Tracker list: ${list.length} vehicles`);
const groups = { 'ACTIVE on our master': [], 'DISPOSED / inactive on our master (should come off Tracker)': [], 'NOT on our master at all': [] };
for (const l of list) { const v = V(l.reg); const g = !v ? 'NOT on our master at all' : v.active ? 'ACTIVE on our master' : 'DISPOSED / inactive on our master (should come off Tracker)'; groups[g].push({ ...l, v }); }
for (const [g, arr] of Object.entries(groups)) { console.log(`\n${g}: ${arr.length}`); for (const x of arr) { const v = x.v; console.log(`  ${x.reg.padEnd(10)} ${x.variant.padEnd(34)} ${v ? `${B(v.branch_id).padEnd(4)} ${v.ownership.padEnd(5)} ${v.disposal_type ? v.disposal_type + ' ' + v.disposal_date : ''} master says ${v.tracking_provider ?? '—'}` : (avis.has(x.reg) ? `on Avis list (rental ${avis.get(x.reg)})` : 'not on Avis list either')}${trackerBilled.has(x.reg) ? '  [Tracker invoiced Aug]' : ''}${cartrackBilled.has(x.reg) ? '  [ALSO on Cartrack invoice]' : ''}`); } }
const listed = new Set(list.map((l) => l.reg));
const masterTracker = veh.filter((v) => v.active && /tracker/i.test(v.tracking_provider ?? '') && !listed.has(norm(v.registration)));
console.log(`\nMaster says Tracker but NOT on Tracker's list: ${masterTracker.length}`); for (const v of masterTracker) console.log(`  ${v.registration.padEnd(10)} ${B(v.branch_id)} ${v.make ?? ''} ${v.model ?? ''}`);
const billedNotListed = [...trackerBilled].filter((r) => !listed.has(r)); console.log(`\nOn Tracker's August invoice but not on this list: ${billedNotListed.join(', ') || 'none'}`);
const listedNotBilled = list.filter((l) => !trackerBilled.has(l.reg)); console.log(`On this list but NOT on Tracker's August invoice: ${listedNotBilled.length} → ${listedNotBilled.map((l) => l.reg).join(', ')}`);
console.log(`\nTracker August invoice lines: ${trk.filter((t) => t.provider === 'Tracker').length}, R ${trk.filter((t) => t.provider === 'Tracker').reduce((s, t) => s + Number(t.total), 0).toFixed(2)}; Cartrack: ${trk.filter((t) => t.provider === 'Cartrack').length} lines`);
console.log('both Tracker list and Cartrack invoice:', list.filter((l) => cartrackBilled.has(l.reg)).map((l) => l.reg).join(', ') || 'none');
