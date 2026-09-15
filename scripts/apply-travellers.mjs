// Loads the completed "Travellers - e-mail and manager list.xlsx": e-mail, manager, fleet access flag; marks named people inactive.
import fs from 'node:fs'; import XLSX from 'xlsx'; XLSX.set_fs(fs); import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply'); const DEACTIVATE = ['Elly Volpe', 'William Saunders', 'Cezanne Van Den Berg', 'Abner George'];
const rows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync('C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/Fleet/Output/Travellers - e-mail and manager list.xlsx'), { type: 'buffer' }).Sheets['Travellers'], { defval: '' });
const { data: emps } = await sb.from('fleet_employees').select('*'); const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const findEmp = (name) => { const k = nk(name); if (!k) return null; return emps.find((e) => nk(e.full_name) === k) ?? emps.find((e) => nk(e.full_name).includes(k) || k.includes(nk(e.full_name))) ?? emps.find((e) => { const [f, ...r] = String(name).trim().split(/\s+/); return nk(e.full_name).startsWith(nk(f)) && nk(e.full_name).endsWith(nk(r[r.length - 1] ?? '')); }) ?? null; };
const changes = []; const problems = []; const managers = new Set(); const access = { driver: 0, manager: 0, none: 0 };
for (const r of rows) {
  const e = emps.find((x) => x.id === Number(r['ID (do not change)'])); if (!e) { problems.push(`row ${r['Emp No']} ${r['Name']}: ID not found`); continue; }
  const email = String(r['E-mail (correct)']).trim().toLowerCase() || null; const mgrName = String(r['Manager (who approves the log)']).trim(); const mgrMail = String(r["Manager's e-mail"]).trim().toLowerCase() || null; const acc = String(r['Fleet access (driver / manager / none)']).trim().toLowerCase() || 'driver'; access[acc] = (access[acc] ?? 0) + 1;
  const mgr = mgrName ? findEmp(mgrName) : null; if (mgrName && !mgr && !mgrMail) problems.push(`${e.full_name}: manager "${mgrName}" not found and no manager e-mail given`);
  if (mgr) managers.add(mgr.full_name);
  const patch = {}; if (email && email !== (e.email ?? '').toLowerCase()) patch.email = email; if (email) patch.notes = e.notes?.includes('auto-generated') ? null : e.notes;
  if (mgr && mgr.id !== e.manager_employee_id) patch.manager_employee_id = mgr.id; if (!mgr && mgrMail && mgrMail !== (e.manager_email ?? '').toLowerCase()) patch.manager_email = mgrMail; if (mgr && e.manager_email) patch.manager_email = null;
  if (DEACTIVATE.some((n) => nk(n) === nk(e.full_name))) patch.active = false;
  if (Object.keys(patch).length) changes.push({ e, patch, note: `${e.full_name}: ${Object.entries(patch).map(([k, v]) => `${k}=${v ?? 'null'}`).join(', ')}` });
}
console.log(`rows ${rows.length}; changes ${changes.length}; access ${JSON.stringify(access)}; managers named: ${[...managers].sort().join(', ')}`);
if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
console.log(changes.map((c) => '  ' + c.note).join('\n'));
const missing = DEACTIVATE.filter((n) => !emps.some((e) => nk(e.full_name) === nk(n))); if (missing.length) console.log('deactivate: not found →', missing.join(', '));
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
for (const c of changes) { const { error } = await sb.from('fleet_employees').update(c.patch).eq('id', c.e.id); if (error) console.log('✗', c.e.full_name, error.message); }
for (const n of DEACTIVATE) { const e = emps.find((x) => nk(x.full_name) === nk(n)); if (!e) continue; const { data: cards } = await sb.from('fleet_cards').select('id,fa_driver_name').eq('employee_id', e.id).eq('active', true); for (const c of cards) await sb.from('fleet_cards').update({ active: false, notes: `Card holder marked inactive 2026-09-15 (per Herman)` }).eq('id', c.id); console.log(`inactive: ${e.full_name} (${cards.length} card(s) retired)`); }
console.log('applied');
