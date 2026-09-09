// Approves submitted travel logs as the admin user (via the fleet_decide_log RPC, which creates the claim).
//   node scripts/approve-log.mjs --period 2026-08 [--name "Clinton"] [--apply]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const f of ['scripts/.env', '.env.local']) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); } } catch {} }
const args = process.argv.slice(2); const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null); const period = arg('--period') ?? '2026-08'; const name = arg('--name'); const APPLY = args.includes('--apply');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: logs } = await svc.from('fleet_travel_logs').select('id,period,business_km,private_km,source_file,fleet_employees(full_name,emp_no,fuel_rate,maint_rate)').eq('period', period).eq('status', 'submitted');
const todo = logs.filter((l) => !name || (l.fleet_employees?.full_name ?? '').toLowerCase().includes(name.toLowerCase()));
for (const l of todo) console.log(`#${l.id} ${l.fleet_employees?.full_name} (${l.fleet_employees?.emp_no}) biz ${l.business_km} priv ${l.private_km} rates ${l.fleet_employees?.fuel_rate}/${l.fleet_employees?.maint_rate} — ${l.source_file}`);
if (!APPLY) { console.log(`${todo.length} submitted log(s); add --apply to approve`); process.exit(0); }
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY; const user = createClient(process.env.SUPABASE_URL, anon, { auth: { persistSession: false } });
const { error: sErr } = await user.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL ?? 'herman.devries@asiconnect.co.za', password: process.env.ADMIN_PASSWORD }); if (sErr) throw sErr;
for (const l of todo) { const { error } = await user.rpc('fleet_decide_log', { p_log: l.id, p_approve: true, p_comment: 'Approved from imported log' }); console.log(error ? `✗ #${l.id} ${error.message}` : `✓ #${l.id} approved`); }
const { data: cl } = await svc.from('fleet_claims').select('total_amount,fuel_amount,maint_amount,fleet_employees(full_name)').in('travel_log_id', todo.map((l) => l.id)).catch?.(() => ({ data: null })) ?? { data: null };
if (cl) for (const c of cl) console.log(`claim ${c.fleet_employees?.full_name}: fuel ${c.fuel_amount} maint ${c.maint_amount} total ${c.total_amount}`);
