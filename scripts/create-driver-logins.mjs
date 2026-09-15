// Creates Fleet driver logins for every active traveller without one. Existing ASI logins (Budget / Excellence) are reused (same password).
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js'; import ExcelJS from 'exceljs'; import { randomInt } from 'node:crypto';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const tempPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let s = 'Asi-'; for (let i = 0; i < 8; i++) s += a[randomInt(a.length)]; return s; };
const [{ data: emps }, { data: br }, { data: fp }, { data: users }] = await Promise.all([sb.from('fleet_employees').select('*').eq('active', true).order('emp_no'), sb.from('fleet_branches').select('id,code,name'), sb.from('fleet_profiles').select('user_id,email,role'), sb.auth.admin.listUsers({ perPage: 1000 })]);
const B = (id) => br.find((b) => b.id === id)?.name ?? ''; const byEmail = new Map(users.users.map((u) => [(u.email ?? '').toLowerCase(), u])); const hasFleet = new Set(fp.map((p) => p.email.toLowerCase()));
const trav = emps.filter((e) => (e.fuel_rate || e.maint_rate) && e.email && !hasFleet.has(e.email.toLowerCase()));
const out = [];
for (const e of trav) {
  const email = e.email.toLowerCase(); const mgr = emps.find((x) => x.id === e.manager_employee_id) ?? null; let u = byEmail.get(email); let temp = null; let how;
  if (u) how = 'existing ASI login — same password as ASI Budget / Excellence';
  else { temp = tempPassword(); how = 'new login — temporary password, must be changed at first sign-in'; if (APPLY) { const { data, error } = await sb.auth.admin.createUser({ email, password: temp, email_confirm: true }); if (error) { out.push({ e, how: 'FAILED: ' + error.message }); continue; } u = data.user; } }
  if (APPLY && u) { const { error } = await sb.from('fleet_profiles').upsert({ user_id: u.id, email, full_name: e.full_name, role: 'driver', is_admin: false, employee_id: e.id, must_change_password: !!temp }, { onConflict: 'user_id' }); if (error) { out.push({ e, how: 'FAILED: ' + error.message }); continue; } }
  out.push({ e, temp, how, mgr });
}
console.log(`${trav.length} travellers without a Fleet login: ${out.filter((o) => o.temp).length} new, ${out.filter((o) => !o.temp && !/FAILED/.test(o.how)).length} existing, ${out.filter((o) => /FAILED/.test(o.how)).length} failed`);
for (const o of out.filter((x) => /FAILED/.test(x.how))) console.log('  ', o.e.full_name, o.how);
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Logins');
ws.columns = [{ header: 'Emp No', key: 'emp', width: 8 }, { header: 'Name', key: 'name', width: 28 }, { header: 'Branch', key: 'branch', width: 20 }, { header: 'Login e-mail', key: 'email', width: 36 }, { header: 'Temporary password', key: 'pw', width: 18 }, { header: 'Note', key: 'how', width: 58 }, { header: 'Approver', key: 'mgr', width: 24 }];
for (const o of out) ws.addRow({ emp: o.e.emp_no, name: o.e.full_name, branch: B(o.e.branch_id), email: o.e.email, pw: o.temp ?? '', how: o.how, mgr: o.mgr?.full_name ?? o.e.manager_email ?? '' });
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E0B2E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: `G${out.length + 1}` }; ws.getColumn('pw').font = { name: 'Consolas', bold: true };
const info = wb.addWorksheet('Instructions'); info.getColumn(1).width = 110;
[['ASI Fleet — driver logins'], ['Sign in at https://superherrie.github.io/asi-fleet/ with the login e-mail and the temporary password.'], ['The app asks for a new password at the first sign-in. The same login then works for ASI Budget and ASI Excellence where access has been given.'], ['People marked "existing ASI login" use the password they already use for ASI Budget — no temporary password is issued.'], ['After signing in: My Travel Logs → open the month → capture trips (saves automatically) → Submit for approval. The approver sees it under Approvals.'], [`Generated ${new Date().toISOString().slice(0, 10)}. Keep this file private; delete it once the passwords have been handed out.`]].forEach((r) => info.addRow(r));
const file = 'C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/Fleet/Output/Fleet driver logins - temporary passwords.xlsx'; await wb.xlsx.writeFile(file); console.log('wrote', file);
