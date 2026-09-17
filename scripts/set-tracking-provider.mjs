// Sets fleet_vehicles.tracking_provider from the tracking invoices (and Cartrack's vehicle list) so the master ties back to what is billed.
import fs from 'node:fs'; import XLSX from 'xlsx'; XLSX.set_fs(fs); import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ctList = new Set(XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync('C:/Users/User1/Downloads/Interconnect Systems, CC VEHICLE LIST.xlsx'), { type: 'buffer' }).Sheets.Sheet1, { header: 1, defval: '' }).slice(4).map((r) => norm(r[0])).filter(Boolean));
const [{ data: veh }, { data: trk }] = await Promise.all([sb.from('fleet_vehicles').select('id,registration,tracking_provider,active'), sb.from('fleet_tracking_lines').select('reg,provider').eq('period', '2026-08')]);
const ct = new Set(trk.filter((t) => t.provider === 'Cartrack').map((t) => norm(t.reg))); const tr = new Set(trk.filter((t) => t.provider === 'Tracker').map((t) => norm(t.reg)));
let n = 0; const changes = [];
for (const v of veh) { const r = norm(v.registration); const prov = tr.has(r) ? 'Tracker' : ct.has(r) || ctList.has(r) ? 'Cartrack' : null; if ((v.tracking_provider ?? null) !== prov) { const { error } = await sb.from('fleet_vehicles').update({ tracking_provider: prov }).eq('id', v.id); if (!error) { n++; changes.push(`${v.registration}: ${v.tracking_provider ?? '—'} → ${prov ?? '—'}${v.active ? '' : ' (inactive)'}`); } } }
console.log(`updated ${n} vehicles`); console.log(changes.join('\n'));
