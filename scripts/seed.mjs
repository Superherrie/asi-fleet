// Seeds fleet masters from the fleet workbook + fleet card list.
//   node scripts/seed.mjs "<YTD Running Cost Fleet.xls>" "<Fleet Card Names.xlsx>" [--apply]
// Dry run by default (prints what it would do). Idempotent: upserts by natural keys.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import XLSX from 'xlsx';
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const [,, fleetFile, cardFile, ...flags] = process.argv;
const APPLY = flags.includes('--apply');
if (!fleetFile || !cardFile) { console.error('usage: node scripts/seed.mjs <fleet.xls> <cards.xlsx> [--apply]'); process.exit(1); }

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const CAT_BY_DIGIT = { 0: 'Admin', 1: 'Ops Cabling', 2: 'Ops Admin', 3: 'Sales', 4: 'Exec' };
const CAT_BY_DEPT = { EX: 'Exec', SALES: 'Sales', 'OPS CABLING': 'Ops Cabling', ADMIN: 'Admin', 'OPS ADMIN': 'Ops Admin', OPS: 'Ops Cabling', OPERATIONS: 'Ops Cabling', SHEQ: 'Ops Admin' };

// ---------------------------------------------------------------- branches
const BRANCHES = [
  ['000', 'Head Office', ['HEAD OFFICE', 'H/O', 'HO', 'POOL-HO', 'H/O DIRECTORS']],
  ['CAP', 'Capitec', ['CAPITEC']],
  ['CPT', 'Cape Town', ['CAPE TOWN', 'CAPETOWN']],
  ['DBN', 'Durban', ['DURBAN']],
  ['DCS', 'Data Centre Services', ['DATA CENTRE SERVICES']],
  ['ESL', 'East London', ['EAST LONDON', 'ESL - POOL']],
  ['GAU', 'Gauteng', ['GAUTENG', 'MIDRAND', 'GAUTENG - MIDRAND', 'JOHANNESBURG']],
  ['KAT', 'Kathu', ['KATHU']],
  ['LOG', 'Logistics', ['LOGISTICS']],
  ['MDB', 'Middelburg', ['MIDDELBURG', 'BU3']],
  ['RCH', 'Richards Bay', ['RICHARDS BAY', 'RICHARDSBAY', 'RICH', 'RICHARDS BAY ']],
  ['RST', 'Rustenburg', ['RUSTENBURG']],
  ['SEC', 'Secunda', ['SECUNDA', 'STC']],
  ['VEN', 'Vereeniging Nationals', ['VEREENIGING NATIONALS']],
  ['VER', 'Vereeniging', ['VEREENIGING']],
  ['ZZZ', 'Other / RJR Electrical', ['RJR', 'RJR ELECTRICAL', 'RJR ELECTRONICS', 'ZZZ - RJR ELEC', 'ZZZ - NOT FOR RJR', 'OTHER']],
];
const branchByAlias = new Map();
for (const [code, name, aliases] of BRANCHES) {
  branchByAlias.set(code, code); branchByAlias.set(name.toUpperCase(), code);
  for (const a of aliases) branchByAlias.set(a.toUpperCase().trim(), code);
}
const branchCode = (s) => { const k = String(s ?? '').toUpperCase().trim(); return branchByAlias.get(k) ?? branchByAlias.get(k.replace(/\s+/g, ' ')) ?? null; };

// ---------------------------------------------------------------- workbook
const wb = XLSX.readFile(fleetFile);
const R = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
const master = R('Master - Running Cost on Fleet').slice(4).filter((r) => r[3]);
const avis = R('Avis Lease Info').slice(1).filter((r) => r[2]);
const ins = R('Insurance').slice(1).filter((r) => r[4]);
const fa = R('First Auto Info').slice(4).filter((r) => r[0] && r[3]);

const avisMva = new Map(); for (const r of avis) avisMva.set(normReg(r[2]), String(r[3]));
const insByReg = new Map(); for (const r of ins) insByReg.set(normReg(r[4]), { tracking: r[9] || null, value: Number(r[11] || r[10]) || null, branch: r[6] });

const MONTHS = { JAN: 1, FEB: 2, FEBR: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
function parseExpiry(s) {
  const m = String(s).toUpperCase().match(/([A-Z]{3,5})\.?,?\s*(\d{4})/);
  if (!m || !MONTHS[m[1]]) return null;
  const mm = MONTHS[m[1]]; const last = new Date(Date.UTC(Number(m[2]), mm, 0)).getUTCDate();
  return `${m[2]}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

const vehicles = new Map();
for (const r of master) {
  const reg = normReg(r[3]); const exp = String(r[5]); const isAvis = /AVIS/i.test(exp) || avisMva.has(reg);
  const i = insByReg.get(reg);
  vehicles.set(reg, {
    registration: reg, year: Number(r[0]) || null, make: String(r[1]).trim(), model: String(r[2]).trim(),
    branch: branchCode(r[4]) ?? 'ZZZ', category: 'Ops Cabling', ownership: isAvis ? 'avis' : 'owned',
    avis_mva: avisMva.get(reg) ?? null, license_expiry: isAvis ? null : parseExpiry(exp), lease_end: isAvis ? parseExpiry(exp) : null,
    tracking_provider: i?.tracking ? (/cartrack/i.test(i.tracking) ? 'Cartrack' : i.tracking) : null,
    insured_value: i?.value ?? null,
  });
}

// ---------------------------------------------------------------- card holders
const cwb = XLSX.readFile(cardFile);
const crows = XLSX.utils.sheet_to_json(cwb.Sheets[cwb.SheetNames[0]], { header: 1, defval: '' }).filter((r) => /^\d{3,4}$/.test(String(r[0]).trim()));
const employees = new Map();
const emailFor = (name) => { const p = name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/); return p.length > 1 ? `${p[0]}.${p[p.length - 1]}@asiconnect.co.za` : null; };
for (const r of crows) {
  const emp_no = String(r[0]).trim().padStart(4, '0'); const full_name = String(r[1]).trim();
  employees.set(emp_no, { emp_no, full_name, email: emailFor(full_name), category: CAT_BY_DEPT[String(r[2]).toUpperCase().trim()] ?? 'Sales', branch: null, notes: 'e-mail auto-generated from name — verify' });
}

// ---------------------------------------------------------------- cards from First Auto YTD
const cards = new Map();
for (const r of fa) {
  const nameCode = String(r[0]).trim(); const driver = String(r[2]).trim(); const reg = normReg(r[3]);
  const m = nameCode.match(/^(\d{4})-?([A-Z0-9]{3})\b/);
  const cat = m ? CAT_BY_DIGIT[Number(m[1][3])] ?? 'Ops Cabling' : 'Ops Cabling';
  const br = m ? (branchCode(m[2]) ?? 'ZZZ') : 'ZZZ';
  const key = `${driver}|${reg}`;
  if (cards.has(key)) continue;
  const sm = driver.match(/^(\d{4})-(.+)$/);
  if (sm) {
    const emp_no = sm[1];
    if (!employees.has(emp_no)) employees.set(emp_no, { emp_no, full_name: titleCase(sm[2]), email: emailFor(sm[2]), category: cat, branch: br, notes: 'from First Auto statement — not on card list' });
    const e = employees.get(emp_no); if (!e.branch) e.branch = br;
    cards.set(key, { fa_driver_name: driver, fa_reg: reg, holder_type: 'staff', emp_no, branch: br, category: e.category ?? cat });
  } else {
    if (!vehicles.has(reg)) vehicles.set(reg, { registration: reg, year: null, make: String(r[4]).trim(), model: String(r[5]).trim(), branch: br, category: cat, ownership: avisMva.has(reg) ? 'avis' : 'owned', avis_mva: avisMva.get(reg) ?? null, license_expiry: null, lease_end: null, tracking_provider: insByReg.get(reg)?.tracking ?? null, insured_value: insByReg.get(reg)?.value ?? null, notes: 'from First Auto statement — not on fleet master' });
    const v = vehicles.get(reg); if (v.category === 'Ops Cabling' && cat !== 'Ops Cabling') v.category = cat;
    cards.set(key, { fa_driver_name: driver, fa_reg: reg, holder_type: 'vehicle', reg, branch: br, category: cat });
  }
}
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase()); }

console.log(`branches ${BRANCHES.length}, vehicles ${vehicles.size} (avis ${[...vehicles.values()].filter((v) => v.ownership === 'avis').length}), employees ${employees.size}, cards ${cards.size} (staff ${[...cards.values()].filter((c) => c.holder_type === 'staff').length})`);
if (!APPLY) { console.log('dry run — add --apply to write'); process.exit(0); }

// ---------------------------------------------------------------- write
const fail = (e, ctx) => { if (e) { console.error(ctx, e.message ?? e); process.exit(1); } };
let r = await sb.from('fleet_branches').upsert(BRANCHES.map(([code, name, aliases]) => ({ code, name, aliases })), { onConflict: 'code' }); fail(r.error, 'branches');
r = await sb.from('fleet_branches').select('id,code'); fail(r.error, 'branches read');
const bid = Object.fromEntries(r.data.map((b) => [b.code, b.id]));

r = await sb.from('fleet_vehicles').upsert([...vehicles.values()].map(({ branch, ...v }) => ({ ...v, branch_id: bid[branch] ?? bid.ZZZ })), { onConflict: 'registration' }); fail(r.error, 'vehicles');
r = await sb.from('fleet_vehicles').select('id,registration'); fail(r.error, 'vehicles read');
const vid = Object.fromEntries(r.data.map((v) => [v.registration, v.id]));

r = await sb.from('fleet_employees').upsert([...employees.values()].map(({ branch, ...e }) => ({ ...e, branch_id: branch ? bid[branch] : null })), { onConflict: 'emp_no' }); fail(r.error, 'employees');
r = await sb.from('fleet_employees').select('id,emp_no'); fail(r.error, 'employees read');
const eid = Object.fromEntries(r.data.map((e) => [e.emp_no, e.id]));

r = await sb.from('fleet_cards').upsert([...cards.values()].map((c) => ({
  fa_driver_name: c.fa_driver_name, fa_reg: c.fa_reg, holder_type: c.holder_type,
  vehicle_id: c.holder_type === 'vehicle' ? vid[c.reg] : null, employee_id: c.holder_type === 'staff' ? eid[c.emp_no] : null,
  branch_id: bid[c.branch] ?? bid.ZZZ, category: c.category,
})), { onConflict: 'fa_driver_name,fa_reg' }); fail(r.error, 'cards');
console.log('seeded OK');
