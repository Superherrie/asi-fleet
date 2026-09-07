// Loads (1) per-person reimbursement rates + departments from payroll's "Payroll Entries for July 2026" PDF,
// creating any card holder missing from fleet_employees, and (2) opening maintenance-accrual balances from the
// 900500 Motor Vehicles Accrual workbook (sheet = closing month, e.g. JUL26 → opening for 2026-08).
//   node scripts/load-july-payroll.mjs "<Payroll Entries.pdf>" "<900500 Motor Vehicles Accrual.xlsx>" [--sheet JUL26] [--period 2026-08] [--apply]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import XLSX from 'xlsx';
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const files = args.filter((a) => !a.startsWith('--') && !/^[A-Z]{3}\d{2}$|^\d{4}-\d{2}$/.test(a)); const APPLY = args.includes('--apply');
const sheetName = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : 'JUL26'; const period = args.includes('--period') ? args[args.indexOf('--period') + 1] : '2026-08';
const [pdf, accrualXlsx] = files;
const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };
const DEPT = { sales: 'Sales', 'ops cabling': 'Ops Cabling', 'ops admin': 'Ops Admin', admin: 'Admin', directors: 'Exec', exec: 'Exec' };

// ------------------------------------------------------------ payroll PDF → rates
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
const people = [];
for (const l of text.split(/\r?\n/)) {
  const m = l.match(/^\s*(\d{4})\s+(.+?)\s{2,}(.*)$/); if (!m) continue;
  // figures use a single space as thousands separator ("3 182.00"); columns are separated by 2+ spaces
  const nums = [...(m[3] + ' ').matchAll(/(?<=\s|^)(-?\d{1,3}(?: \d{3})*(?:\.\d{2})?)(?=\s)/g)].map((x) => toNum(x[1]));
  if (nums.length < 3) continue;
  // ... business km, fuel rate, maint rate are the last three figures
  const [km, fuel, maint] = nums.slice(-3);
  const tail = m[3]; const dept = Object.keys(DEPT).find((k) => normKey(tail).startsWith(k)) ?? Object.keys(DEPT).find((k) => normKey(m[2] + ' ' + tail).includes(k));
  const nameRaw = m[2].trim(); // name may run into the department when long (e.g. "Christal Jansen Van NieuwSaelnehsu")
  people.push({ emp_no: m[1], name: nameRaw.replace(/\s+(Sales|Ops Cabling|Ops Admin|Admin|Directors)$/i, ''), dept: DEPT[dept] ?? null, km, fuel_rate: fuel, maint_rate: maint, fa: nums[0], reim: nums[1] });
}
console.log(`payroll rows: ${people.length}`);

// ------------------------------------------------------------ accrual workbook → opening balances
const wb = XLSX.readFile(accrualXlsx); const ws = wb.Sheets[sheetName]; if (!ws) { console.error(`sheet ${sheetName} not found; sheets: ${wb.SheetNames.slice(0, 6).join(', ')}…`); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const hdr = rows.findIndex((r) => normKey(r[2]) === 'name' && normKey(r[3]) === 'emp no');
const bal = rows.slice(hdr + 1).filter((r) => /^\d{3,4}$/.test(String(r[3]).trim()) && r[5] !== '').map((r) => ({ emp_no: String(r[3]).trim().padStart(4, '0'), name: String(r[2]).trim(), dept: DEPT[normKey(r[1])] ?? null, reg: String(r[4]).trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), balance: Math.round(toNum(r[5]) * 100) / 100 }));
const balTotal = Math.round(bal.reduce((s, b) => s + b.balance, 0) * 100) / 100;
const sheetTotal = rows.find((r) => /grand total|^total$/i.test(String(r[0]))); console.log(`accrual ${sheetName}: ${bal.length} people, R ${balTotal}${sheetTotal ? ` (sheet total ${sheetTotal[5]})` : ''}`);

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: emps } = await sb.from('fleet_employees').select('*'); const { data: branches } = await sb.from('fleet_branches').select('*');
const byNo = new Map(emps.map((e) => [e.emp_no, e]));
const missing = [...people, ...bal].filter((p) => !byNo.has(p.emp_no)).reduce((m, p) => m.set(p.emp_no, p), new Map());
console.log('missing employees:', [...missing.values()].map((p) => `${p.emp_no} ${p.name} (${p.dept ?? '?'})`).join('; ') || 'none');
people.forEach((p) => console.log(`  ${p.emp_no} ${p.name.padEnd(28)} ${String(p.dept).padEnd(12)} km ${String(p.km).padStart(5)}  fuel ${p.fuel_rate}  maint ${p.maint_rate}`));
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }

const branchOfName = (s) => branches.find((b) => normKey(b.name) === normKey(s) || (b.aliases ?? []).some((a) => normKey(a) === normKey(s)));
// carry the branch down the accrual sheet (blank = same as above)
let curBranch = null; const balBranch = new Map();
for (const r of rows.slice(hdr + 1)) { if (String(r[0]).trim() && !/total/i.test(String(r[0]))) curBranch = branchOfName(r[0]); if (/^\d{3,4}$/.test(String(r[3]).trim())) balBranch.set(String(r[3]).trim().padStart(4, '0'), curBranch); }
for (const p of missing.values()) {
  const { data, error } = await sb.from('fleet_employees').insert({ emp_no: p.emp_no, full_name: p.name, category: p.dept ?? 'Sales', branch_id: balBranch.get(p.emp_no)?.id ?? null, notes: `Created from ${basename(pdf)} — check e-mail/branch` }).select('*').single();
  if (error) console.error('insert', p.name, error.message); else byNo.set(p.emp_no, data);
}
let n = 0;
for (const p of people) {
  const e = byNo.get(p.emp_no); if (!e) continue;
  const patch = { fuel_rate: p.fuel_rate, maint_rate: p.maint_rate }; if (p.dept && e.category !== p.dept) patch.category = p.dept;
  const b = balBranch.get(p.emp_no); if (b && !e.branch_id) patch.branch_id = b.id;
  const reg = bal.find((x) => x.emp_no === p.emp_no)?.reg; if (reg && !e.vehicle_reg) patch.vehicle_reg = reg;
  const { error } = await sb.from('fleet_employees').update(patch).eq('id', e.id); if (error) console.error(p.name, error.message); else n++;
}
console.log(`rates set on ${n} employees`);
// opening balances (replace any earlier opening rows for these people)
const ids = bal.map((b) => byNo.get(b.emp_no)?.id).filter(Boolean);
await sb.from('fleet_accrual_txns').delete().eq('kind', 'opening').in('employee_id', ids);
await sb.from('fleet_imports').delete().eq('source', 'accrual_opening').eq('period', period);
const { data: imp } = await sb.from('fleet_imports').insert({ source: 'accrual_opening', period, file_name: `${basename(accrualXlsx)} [${sheetName}]`, row_count: bal.length, total_amount: balTotal }).select('id').single();
const txns = bal.filter((b) => byNo.get(b.emp_no)).map((b) => ({ employee_id: byNo.get(b.emp_no).id, txn_date: `${period}-01`, period, kind: 'opening', amount: b.balance, description: `Opening balance per 900500 recon ${sheetName}`, import_id: imp.id }));
const { error } = await sb.from('fleet_accrual_txns').insert(txns); if (error) throw error;
console.log(`opening balances loaded: ${txns.length} people, R ${balTotal}`);
