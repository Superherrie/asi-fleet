// Loads the payroll master (Payroll App / payroll_data.json, all group companies) into fleet_staff and creates the
// "Equipment in stock" holder for every branch. Re-run after each monthly payroll ingest. Dry run unless --apply.
//   node scripts/load-staff.mjs [--apply] [path\to\payroll_data.json]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const FILE = process.argv.find((a) => a.endsWith('.json')) ?? 'C:/Users/User1/OneDrive - Herman/OneDrive - Conekt Business Group/Desktop/Payroll App/payroll_data.json';

const rows = JSON.parse(readFileSync(FILE, 'utf8'));
// a person is active only if on the latest payroll period loaded (a company whose data stops earlier has been closed: everyone on it has left or moved to ICS)
const globalLatest = rows.reduce((m, r) => (r.period > m ? r.period : m), ''); const latestByCompany = {}; for (const r of rows) latestByCompany[r.company] = globalLatest;
const last = new Map(); for (const r of rows) { const k = `${r.company}|${r.emp_no}`; if (!last.has(k) || r.period > last.get(k).period) last.set(k, r); }
const CAT = { OC: 'Ops Cabling', AD: 'Admin', SD: 'Sales', OA: 'Ops Admin', EX: 'Exec' };
const dmy = (s) => { const m = String(s ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m && m[3] !== '0000' ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const cap = (w) => w.length <= 2 && /^(de|du|le|la|van|der|den|von)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const title = (s) => String(s ?? '').trim().split(/\s+/).map((w) => w.split('-').map(cap).join('-')).join(' ').replace(/\b(Mc)([a-z])/g, (_, a, b) => a + b.toUpperCase());
const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

const [{ data: branches }, { data: emps }, { data: profiles }, { data: existing }] = await Promise.all([
  sb.from('fleet_branches').select('id,code,name,active'), sb.from('fleet_employees').select('emp_no,email,full_name'), sb.from('fleet_profiles').select('email,full_name'), sb.from('fleet_staff').select('*')]);
const bid = Object.fromEntries(branches.map((b) => [b.code, b.id]));
const emailByEmp = Object.fromEntries(emps.filter((e) => e.emp_no && e.email).map((e) => [e.emp_no, e.email.toLowerCase()]));
const emailByName = {}; for (const p of [...profiles, ...emps]) if (p.email && p.full_name) emailByName[nk(p.full_name)] ??= p.email.toLowerCase();
const byKey = new Map(existing.filter((s) => s.kind === 'person' && s.emp_no).map((s) => [`${s.company}|${s.emp_no}`, s]));

const inserts = [], updates = []; const now = new Date().toISOString();
for (const [k, r] of last) {
  const left = r.period < latestByCompany[r.company] || !!dmy(r.date_term);
  const full = title(`${r.name} ${r.surname}`);
  const row = { kind: 'person', company: r.company, emp_no: r.emp_no, full_name: full, position: title(r.position), category: CAT[r.cat_code] ?? null, branch_code: r.branch, branch_id: bid[r.branch] ?? null,
    email: emailByEmp[r.emp_no] ?? emailByName[nk(full)] ?? null, status: left ? 'left' : 'active', left_period: left ? r.period : null, date_term: dmy(r.date_term), date_emp: dmy(r.date_emp), source: 'payroll', loaded_at: now, updated_at: now };
  const cur = byKey.get(k);
  if (!cur) inserts.push(row);
  else { if (cur.source === 'manual') continue; const patch = {}; for (const f of ['full_name', 'position', 'category', 'branch_code', 'branch_id', 'status', 'left_period', 'date_term', 'date_emp']) if ((cur[f] ?? null) !== (row[f] ?? null)) patch[f] = row[f]; if (!cur.email && row.email) patch.email = row.email; if (Object.keys(patch).length) updates.push({ id: cur.id, ...patch, loaded_at: now, updated_at: now }); }
}
const stock = branches.filter((b) => b.active && b.code !== 'ZZZ' && !existing.some((s) => s.kind === 'stock' && s.branch_id === b.id))
  .map((b) => ({ kind: 'stock', full_name: `Equipment in stock - ${b.name}`, branch_code: b.code, branch_id: b.id, status: 'active', source: 'manual', loaded_at: now }));
const active = [...last.values()].filter((r) => !(r.period < latestByCompany[r.company] || !!dmy(r.date_term))).length;
console.log(`payroll file: ${rows.length} rows, ${last.size} people, latest period per company ${JSON.stringify(latestByCompany)}; active ${active}, left ${last.size - active}`);
console.log(`staff: ${inserts.length} to insert, ${updates.length} to update; stock holders to create: ${stock.length}; e-mails known for ${inserts.filter((r) => r.email).length} of the new rows`);
console.log('status changes:', updates.filter((u) => u.status).map((u) => `${byKey.get([...byKey.keys()].find((k) => byKey.get(k).id === u.id))?.full_name} -> ${u.status}`).join(', ') || 'none');

// Travellers and their fuel cards follow payroll too (Herman, 11 Nov 2026: "Align with Payroll, ALWAYS"). The category and branch on
// fleet_employees come from the person's latest payroll row, and a staff fuel card takes its holder's category and branch, so the
// journals post to the GL category payroll gives. Rates are per person and are not touched.
const [{ data: trav }, { data: staffCards }] = await Promise.all([
  sb.from('fleet_employees').select('id,emp_no,full_name,category,branch_id,active'),
  sb.from('fleet_cards').select('id,fa_driver_name,employee_id,category,branch_id,holder_type,active').eq('holder_type', 'staff')]);
const payByEmp = new Map(); const dupEmp = new Set();
for (const r of last.values()) { if (r.period < latestByCompany[r.company] || dmy(r.date_term)) continue; if (payByEmp.has(r.emp_no)) dupEmp.add(r.emp_no); payByEmp.set(r.emp_no, r); }
const bcode = Object.fromEntries(branches.map((b) => [b.id, b.code]));
const travPatches = [], travNotes = [], onPayroll = new Set();
for (const e of (trav ?? []).filter((x) => x.active && x.emp_no)) {
  const p = payByEmp.get(e.emp_no);
  if (!p) { travNotes.push(`${e.emp_no} ${e.full_name}: not on the latest payroll, left as is`); continue; }
  if (dupEmp.has(e.emp_no)) { travNotes.push(`${e.emp_no} ${e.full_name}: employee number is on two payrolls, left as is`); continue; }
  if (!nk(e.full_name).includes(nk(p.surname))) { travNotes.push(`${e.emp_no} ${e.full_name}: payroll has ${title(`${p.name} ${p.surname}`)} under this number, left as is`); continue; }
  onPayroll.add(e.id);
  const patch = {}; const cat = CAT[p.cat_code]; const b = bid[p.branch];
  if (cat && cat !== e.category) patch.category = cat;
  if (b && b !== e.branch_id) patch.branch_id = b;
  if (!cat) travNotes.push(`${e.emp_no} ${e.full_name}: no payroll category (${p.cat_code || 'blank'}), category left as is`);
  if (!b) travNotes.push(`${e.emp_no} ${e.full_name}: payroll branch ${p.branch || 'blank'} is not a fleet branch, branch left as is`);
  if (Object.keys(patch).length) travPatches.push({ e, patch });
}
const travAfter = new Map((trav ?? []).map((e) => [e.id, { ...e, ...(travPatches.find((t) => t.e.id === e.id)?.patch ?? {}) }]));
const cardPatches = [];
for (const c of (staffCards ?? []).filter((x) => x.active && x.employee_id && onPayroll.has(x.employee_id))) {
  const e = travAfter.get(c.employee_id); const patch = {};
  if (e.category && e.category !== c.category) patch.category = e.category;
  if (e.branch_id && e.branch_id !== c.branch_id) patch.branch_id = e.branch_id;
  if (Object.keys(patch).length) cardPatches.push({ c, patch });
}
const was = (cur, patch) => Object.entries(patch).map(([f, v]) => f === 'branch_id' ? `branch ${bcode[cur.branch_id] ?? '-'} -> ${bcode[v]}` : `category ${cur.category ?? '-'} -> ${v}`).join(', ');
console.log(`travellers: ${travPatches.length} to align with payroll; staff fuel cards: ${cardPatches.length} to align with their holder`);
for (const t of travPatches) console.log(`  traveller ${t.e.emp_no} ${t.e.full_name}: ${was(t.e, t.patch)}`);
for (const c of cardPatches) console.log(`  card ${c.c.fa_driver_name}: ${was(c.c, c.patch)}`);
for (const n of travNotes) console.log(`  note: ${n}`);

if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
for (const t of travPatches) { const { error } = await sb.from('fleet_employees').update(t.patch).eq('id', t.e.id); if (error) throw error; }
for (const c of cardPatches) { const { error } = await sb.from('fleet_cards').update(c.patch).eq('id', c.c.id); if (error) throw error; }
for (let i = 0; i < inserts.length; i += 200) { const { error } = await sb.from('fleet_staff').insert(inserts.slice(i, i + 200)); if (error) throw error; }
for (const u of updates) { const { id, ...patch } = u; const { error } = await sb.from('fleet_staff').update(patch).eq('id', id); if (error) throw error; }
if (stock.length) { const { error } = await sb.from('fleet_staff').insert(stock); if (error) throw error; }
const { data: synced } = await sb.rpc('fleet_cell_sync_from_staff'); console.log('applied; cellphone contracts re-synced to payroll branch / department:', synced ?? 0);
