// Seeds shared_people from what Herman has confirmed (30 Oct 2026). Safe to re-run: rows are matched on (company, emp_no) or,
// for people not on payroll, on full_name; aliases are merged, never dropped. Dry run unless --apply.
//   node scripts/seed-shared-people.mjs [--apply]
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply'); const nk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

// alias -> canonical payroll name. Jotform spellings (import-jotform-it.mjs) and Vodacom master spellings (load-cell-contracts.mjs),
// plus the six Jotform submitters Herman confirmed on 29 Oct 2026.
const ALIASES = {
  'Joaquim <aia': 'Joaquim Maia', 'Cor van Niekekerk': 'Corrie Van Niekerk', 'Cor van Niekerk': 'Corrie Van Niekerk', 'Dean� van Zyl': "Deane' Van Zyl", 'Dean van Zyl': "Deane' Van Zyl", 'Ebenhaezer': 'Eben McCarthy', 'Ebenhaezer Mccarthy': 'Eben McCarthy', 'Nicole Mudau': 'Nico Mudau', 'Morne': 'Morne Swart',
  'Puleng Gilbert Kekana': 'Gilbert Kekana', 'Mamello Patience Matolo': 'Patience Matolo', 'Ntsime Isaac Mothibi': 'Isaac Mothibi', 'Dickie Van Der Nest': 'Diederick Van Der Nest', 'Gerhard Van Der Nest': 'Gerhardus Van Der Nest',
  'Boitshwarelo Mokakale': 'Auganatia Mokakale', 'LIZA': 'Liza Landman', 'Edwa Charles Mabula': 'Charles Mabula', 'Mthobisi Jama': 'Mpumelelo Jama',
  'DICKIE VD NEST': 'Diederick Van Der Nest', 'MTHOBISI JAMA': 'Mpumelelo Jama', 'CHRISTAL VAN NIEWENHUIZEN': 'Christal Jansen Van Nieuwenhu', 'BOITSHWARELO MOKOKALE': 'Auganatia Mokakale', 'HEIN PIETERSEN': 'Hiniry Pietersen', 'RENAY SIEBRITZ - CPT OFFICE': 'Renay Siebritz', 'LODEWIKUS COETZEE - RTB': 'Wikus Coetzee',
  'Sasche-leigh Abrahams': 'Sache Abrahams', 'Lucas Meintjes': 'Lucas Meintjies', 'Takalani Johannes Ranwaha': 'Johannes Ranwaha', 'Buhle Ncube': 'Behle Ncube', 'Nonhlanhla Themba-Moroki': 'Desiree Themba-Moroki', 'Enock Chaike': 'Enock Chauke',
  'Reino VanAswegen': 'Reino van Aswegen',
};
// people not on payroll
const CONTRACTORS = [{ full_name: 'Reino van Aswegen', company: 'DCS', kind: 'contractor', contractor_company: 'DCS', branch_code: 'DCS', role_override: 'Branch Manager', role_override_note: 'Independent contractor under DCS; role per Herman via the ASI Excellence session, 30 Oct 2026', notes: 'Not on payroll. Holds a Fleet staff record (source manual) for IT equipment.' }];

const [{ data: staff }, ex] = await Promise.all([sb.from('fleet_staff').select('company,emp_no,full_name,branch_code,kind,status').eq('kind', 'person'), sb.from('shared_people').select('*')]);
if (ex.error) throw new Error('shared_people not readable yet (schema cache?): ' + ex.error.message); const existing = ex.data ?? [];
const byName = new Map(); const addKey = (k, s) => { if (!k) return; const l = byName.get(k) ?? []; l.push(s); byName.set(k, l); };
for (const s of staff) { const p = s.full_name.split(/\s+/); addKey(nk(s.full_name), s); if (p.length > 1) addKey('fl|' + nk(p[0] + p[p.length - 1]), s); }   // payroll names may carry middle names
const lookup = (name) => { const p = name.trim().split(/\s+/); return byName.get(nk(name)) ?? (p.length > 1 ? byName.get('fl|' + nk(p[0] + p[p.length - 1])) : undefined); };
const pick = (l) => (l.length === 1 ? l[0] : l.find((s) => s.status === 'active') ?? l[0]);

const rows = new Map();   // key -> row
for (const c of CONTRACTORS) rows.set('name|' + nk(c.full_name), { ...c, emp_no: null, aliases: [], source: 'herman', updated_by: 'seed-shared-people' });
const unresolved = [];
for (const [alias, canon] of Object.entries(ALIASES)) {
  const key0 = 'name|' + nk(canon); if (rows.has(key0)) { rows.get(key0).aliases.push(alias); continue; }   // contractor
  const l = lookup(canon); if (!l || !l.find((s) => s.emp_no)) { unresolved.push(`${alias} -> ${canon}`); continue; }
  const s = pick(l.filter((x) => x.emp_no)); const key = `${s.company}|${s.emp_no}`;
  if (!rows.has(key)) rows.set(key, { full_name: s.full_name, company: s.company, emp_no: s.emp_no, kind: 'employee', branch_code: s.branch_code, aliases: [], source: 'herman', updated_by: 'seed-shared-people' });
  rows.get(key).aliases.push(alias);
}
for (const r of rows.values()) r.aliases = [...new Set(r.aliases)];
if (unresolved.length) console.log('aliases whose canonical name is not on the staff list (skipped):', unresolved.join('; '));

const findExisting = (r) => existing.find((e) => (r.emp_no ? e.company === r.company && e.emp_no === r.emp_no : nk(e.full_name) === nk(r.full_name)));
const inserts = [], updates = [];
for (const r of rows.values()) { const e = findExisting(r); if (!e) inserts.push(r); else { const aliases = [...new Set([...(e.aliases ?? []), ...r.aliases])]; if (aliases.length !== (e.aliases ?? []).length) updates.push({ id: e.id, aliases, updated_at: new Date().toISOString(), updated_by: 'seed-shared-people' }); } }
console.log(`shared_people: ${existing.length} rows now; ${inserts.length} to insert, ${updates.length} to extend with new aliases`);
for (const r of inserts) console.log(`  + ${r.full_name} (${r.kind}${r.emp_no ? ', ' + r.company + ' ' + r.emp_no : ''}, ${r.branch_code ?? '-'}) aliases: ${r.aliases.join(' | ') || '-'}`);
if (!APPLY) { console.log('dry run - add --apply'); process.exit(0); }
if (inserts.length) { const { error } = await sb.from('shared_people').insert(inserts); if (error) throw error; }
for (const u of updates) { const { error } = await sb.from('shared_people').update(u).eq('id', u.id); if (error) throw error; }
const { count } = await sb.from('shared_people').select('id', { count: 'exact', head: true }); console.log('applied; shared_people rows:', count);
