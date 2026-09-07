// Aligns First Auto cards with payroll: (1) a card whose reg is the employee's private vehicle (per the 900500 accrual recon) is that
// person's staff card, even if First Auto prints an old staff number or the reg is on the fleet master; (2) duplicate employees created
// from old First Auto numbers are merged into the payroll record; (3) directors' cards are not deducted; (4) deductions rebuilt.
//   node scripts/fix-cards.mjs [--apply]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const APPLY = process.argv.includes('--apply');
const NO_DEDUCT = ['2533', '0287', '0037']; // Herman, Eugene, Pierre — cards are company cost per payroll's July sheet
const MERGE = { '2029': '4269', '4337': '4351', '1485': '4342', '4218': '4323' }; // old First Auto number → payroll number
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: emps } = await sb.from('fleet_employees').select('*'); const { data: cards } = await sb.from('fleet_cards').select('*');
const byNo = new Map(emps.map((e) => [e.emp_no, e]));
const updates = [];
for (const c of cards) {
  const patch = {};
  const owner = emps.find((e) => e.vehicle_reg && normReg(e.vehicle_reg) === normReg(c.fa_reg));
  const empNo = c.fa_driver_name.match(/^(\d{4})[-/]/)?.[1]; const mergedNo = empNo && MERGE[empNo];
  if (owner) { if (c.holder_type !== 'staff' || c.employee_id !== owner.id) Object.assign(patch, { holder_type: 'staff', employee_id: owner.id, vehicle_id: null, branch_id: c.branch_id ?? owner.branch_id, category: owner.category }); }
  else if (mergedNo && byNo.get(mergedNo)) { const t = byNo.get(mergedNo); if (c.employee_id !== t.id) Object.assign(patch, { holder_type: 'staff', employee_id: t.id, vehicle_id: null }); }
  const e = emps.find((x) => x.id === (patch.employee_id ?? c.employee_id));
  const deduct = !(e && NO_DEDUCT.includes(e.emp_no)); if (c.deduct !== deduct) patch.deduct = deduct;
  if (Object.keys(patch).length) { updates.push({ id: c.id, patch }); console.log(`card ${c.fa_driver_name} ${c.fa_reg}: ${JSON.stringify(patch)}${e ? ` → ${e.full_name} (${e.emp_no})` : ''}`); }
}
console.log(`${updates.length} card updates; merge duplicates: ${Object.entries(MERGE).map(([a, b]) => `${a}→${b}`).join(', ')}`);
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
for (const u of updates) { const { error } = await sb.from('fleet_cards').update(u.patch).eq('id', u.id); if (error) console.error(error.message); }
for (const [oldNo, newNo] of Object.entries(MERGE)) {
  const o = byNo.get(oldNo), n = byNo.get(newNo); if (!o || !n) continue;
  await sb.from('fleet_cards').update({ employee_id: n.id }).eq('employee_id', o.id);
  for (const t of ['fleet_travel_logs', 'fleet_claims', 'fleet_deductions', 'fleet_accrual_txns']) await sb.from(t).update({ employee_id: n.id }).eq('employee_id', o.id);
  const { error } = await sb.from('fleet_employees').delete().eq('id', o.id); if (error) await sb.from('fleet_employees').update({ active: false, notes: `duplicate of ${newNo}` }).eq('id', o.id);
}
// rebuild deductions for every imported First Auto period (only staff cards flagged deduct; toll excluded)
const { data: cards2 } = await sb.from('fleet_cards').select('id,holder_type,employee_id,deduct');
const { data: periods } = await sb.from('fleet_imports').select('period').eq('source', 'first_auto');
for (const p of [...new Set(periods.map((x) => x.period))]) {
  const { data: lines } = await sb.from('fleet_fa_lines').select('id,card_id,grand_total,toll_excl').eq('period', p);
  const ded = lines.map((l) => { const c = cards2.find((x) => x.id === l.card_id); return c?.holder_type === 'staff' && c.deduct && c.employee_id ? { period: p, employee_id: c.employee_id, card_id: c.id, fa_line_id: l.id, amount: Math.round((l.grand_total - l.toll_excl) * 100) / 100 } : null; }).filter(Boolean);
  await sb.from('fleet_deductions').delete().eq('period', p).eq('status', 'pending');
  if (ded.length) { const { error } = await sb.from('fleet_deductions').insert(ded); if (error) console.error(p, error.message); }
  console.log(`${p}: ${ded.length} deductions R ${ded.reduce((s, d) => s + d.amount, 0).toFixed(2)}`);
}
