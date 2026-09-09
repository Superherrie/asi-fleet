import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const all = async (t, sel) => { const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await sb.from(t).select(sel).range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; };
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const [br, veh, emp, cards, fa, maint, avis, trk, ins] = await Promise.all([all('fleet_branches','id,code,name'), all('fleet_vehicles','id,registration,branch_id,category,make,model'), all('fleet_employees','id,full_name,branch_id,vehicle_reg'), all('fleet_cards','id,fa_driver_name,fa_reg,holder_type,employee_id,vehicle_id,branch_id,category'), all('fleet_fa_lines','period,card_id,fa_reg,fa_name_code,grand_total'), all('fleet_maint_lines','period,reg,branch_id,vehicle_id,employee_id,total'), all('fleet_avis_lines','period,reg,branch_id,vehicle_id,amount_due'), all('fleet_tracking_lines','period,provider,reg,branch_id,vehicle_id,total'), all('fleet_insurance_lines','period,reg,branch_id,vehicle_id,premium')]).catch(e => { console.error(e.message); process.exit(1); });
const B = (id) => br.find(b => b.id === id)?.code ?? '?';
const byReg = new Map();
const add = (reg, src, code, amt) => { reg = norm(reg); if (!reg) return; const o = byReg.get(reg) ?? {}; (o[src] ??= new Map()).set(code, (o[src].get(code) ?? 0) + Number(amt || 0)); byReg.set(reg, o); };
for (const v of veh) add(v.registration, 'vehicle master', B(v.branch_id), 0);
for (const l of fa) { const c = cards.find(x => x.id === l.card_id); add(l.fa_reg, 'fuel card', c ? B(c.branch_id) : 'nocard', l.grand_total); }
for (const l of maint) add(l.reg, 'maintenance', B(l.branch_id), l.total);
for (const l of avis) add(l.reg, 'avis', B(l.branch_id), l.amount_due);
for (const l of trk) add(l.reg, `${l.provider}`.toLowerCase(), B(l.branch_id), l.total);
for (const l of ins) add(l.reg, 'insurance', B(l.branch_id), l.premium);
const emps = new Map(emp.map(e => [norm(e.vehicle_reg), e]));
let n = 0; const rows = [];
for (const [reg, o] of [...byReg].sort()) { const codes = new Set(); for (const [src, m] of Object.entries(o)) for (const c of m.keys()) codes.add(c); if (codes.size <= 1) continue; n++; const e = emps.get(reg); rows.push(`${reg.padEnd(10)} ${(e ? 'staff:' + e.full_name : '').padEnd(28)} ` + Object.entries(o).map(([src, m]) => `${src}=${[...m].map(([c, a]) => c + (a ? `(R${Math.round(a)})` : '')).join('/')}`).join('  ')); }
console.log(`registrations seen: ${byReg.size}; with costs in more than one branch: ${n}\n`); console.log(rows.join('\n'));
const cardsWithVeh = cards.filter(c => c.vehicle_id).map(c => ({ c, v: veh.find(v => v.id === c.vehicle_id) })).filter(x => x.v && x.v.branch_id !== x.c.branch_id);
console.log(`\ncards whose branch differs from the vehicle master: ${cardsWithVeh.length}`); for (const { c, v } of cardsWithVeh) console.log(`  ${c.fa_reg.padEnd(10)} ${c.fa_driver_name.padEnd(26)} card=${B(c.branch_id)} vehicle=${B(v.branch_id)}`);
