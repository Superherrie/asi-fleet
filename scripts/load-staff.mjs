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
if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
for (let i = 0; i < inserts.length; i += 200) { const { error } = await sb.from('fleet_staff').insert(inserts.slice(i, i + 200)); if (error) throw error; }
for (const u of updates) { const { id, ...patch } = u; const { error } = await sb.from('fleet_staff').update(patch).eq('id', id); if (error) throw error; }
if (stock.length) { const { error } = await sb.from('fleet_staff').insert(stock); if (error) throw error; }
console.log('applied');
