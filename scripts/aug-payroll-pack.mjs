// Builds the August 2026 payroll pack (July-template layout) + "logs not received" list, and reconciles July vs payroll's sheet.
//   node scripts/aug-payroll-pack.mjs "<output folder>"
import { readFileSync } from 'node:fs'; import * as fs from 'node:fs'; import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url'; import XLSX from 'xlsx'; XLSX.set_fs(fs);
const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const OUT = process.argv[2]; const r2 = (n) => Math.round(n * 100) / 100;
const { createClient } = await import('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const text = execFileSync('pdftotext', ['-layout', 'C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/Fleet/Payroll Entries for July 2026 - Tracey.pdf', '-'], { encoding: 'utf8' });
const pay = []; for (const l of text.split(/\r?\n/)) { const m = l.match(/^\s*(\d{4})\s+(.+?)\s{2,}(.*)$/); if (!m) continue; const nums = [...(m[3] + ' ').matchAll(/(?<=\s|^)(-?(?:\d{1,3}(?: \d{3})+|\d+)(?:\.\d{2})?)(?=\s)/g)].map((x) => Number(x[1].replace(/ /g, ''))); if (nums.length < 3) continue; pay.push({ emp_no: m[1], name: m[2].trim().replace(/\s+(Sales|Ops Cabling|Ops Admin|Admin|Directors)$/i, ''), fa: nums[0], km: nums[nums.length - 3] }); }
const { data: emps } = await sb.from('fleet_employees').select('*'); const { data: branches } = await sb.from('fleet_branches').select('id,code,name');
const bname = (id) => branches.find((b) => b.id === id)?.name ?? ''; const byId = new Map(emps.map((e) => [e.id, e])); const dept = (c) => (c === 'Exec' ? 'Directors' : c);
// --- July recon
const { data: dj } = await sb.from('fleet_deductions').select('employee_id,amount').eq('period', '2026-07'); const mine = new Map(); dj.forEach((d) => { const k = byId.get(d.employee_id)?.emp_no; mine.set(k, r2((mine.get(k) || 0) + Number(d.amount))); });
console.log('JULY recon vs payroll sheet — differences:'); pay.forEach((p) => { const a = mine.get(p.emp_no) || 0; if (Math.abs(a - p.fa) > 0.05) console.log(`  ${p.emp_no} ${p.name.padEnd(26)} app ${a.toFixed(2).padStart(9)} payroll ${p.fa.toFixed(2).padStart(9)} diff ${(a - p.fa).toFixed(2)}`); });
[...mine].filter(([k]) => !pay.find((p) => p.emp_no === k)).forEach(([k, v]) => console.log(`  ${k} ${emps.find((e) => e.emp_no === k)?.full_name} app ${v} — not on payroll sheet`));
console.log(`  app total ${[...mine.values()].reduce((s, v) => s + v, 0).toFixed(2)} vs payroll 207547.35`);
// --- August payroll sheet
const { data: da } = await sb.from('fleet_deductions').select('employee_id,amount').eq('period', '2026-08'); const { data: cl } = await sb.from('fleet_claims').select('*').eq('period', '2026-08');
const people = new Map(); const add = (id) => { if (!people.has(id)) people.set(id, { e: byId.get(id), fa: 0, km: 0, fuel: 0, maint: 0, fr: null, mr: null }); return people.get(id); };
da.forEach((d) => { const p = add(d.employee_id); p.fa = r2(p.fa + Number(d.amount)); }); cl.forEach((c) => { const p = add(c.employee_id); p.km = Number(c.business_km); p.fuel = Number(c.fuel_amount); p.maint = Number(c.maint_amount); p.fr = Number(c.fuel_rate); p.mr = Number(c.maint_rate); });
pay.forEach((p) => { const e = emps.find((x) => x.emp_no === p.emp_no); if (e) add(e.id); });
const rows = [...people.values()].filter((p) => p.e).sort((a, b) => a.e.emp_no.localeCompare(b.e.emp_no));
const aoa = [['Payroll Entries for August 2026 to be paid with September 2026 payroll'], [], ['Emp No', 'Name', 'Department', 'Branch', 'Deduction FA Card', 'Earnings Reim-N', 'Earning Maint Provision', 'Deduction Maint Provision', 'Earning Total', 'Business Kms Traveled for the Month', 'Fuel Rate p/km', 'Maint. Rate p/km', 'Note']];
const T = { fa: 0, fuel: 0, maint: 0 };
for (const p of rows) { const fr = p.fr ?? (Number(p.e.fuel_rate) || ''); const mr = p.mr ?? (Number(p.e.maint_rate) || ''); const note = p.km === 0 ? 'no travel log received' : p.fr === 0 ? 'no rate on file — claim not calculated' : ''; aoa.push([p.e.emp_no, p.e.full_name, dept(p.e.category), bname(p.e.branch_id), r2(p.fa), r2(p.fuel), r2(p.maint), r2(p.maint), r2(p.fuel + p.maint), p.km, fr, mr, note]); T.fa += p.fa; T.fuel += p.fuel; T.maint += p.maint; }
aoa.push(['Grand Total', '', '', '', r2(T.fa), r2(T.fuel), r2(T.maint), r2(T.maint), r2(T.fuel + T.maint)]);
const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [8, 28, 12, 14, 16, 14, 18, 18, 14, 14, 12, 12, 34].map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, 'Aug 2026');
XLSX.writeFile(wb, join(OUT, 'Payroll Entries for August 2026 (draft).xlsx'));
console.log(`\nAUGUST sheet: ${rows.length} people; FA deductions R ${r2(T.fa)}; reimbursement R ${r2(T.fuel)}; maint provision R ${r2(T.maint)}`);
// --- logs not received
const { data: logs } = await sb.from('fleet_travel_logs').select('employee_id,status,business_km,source_file').eq('period', '2026-08');
const have = new Set(logs.map((l) => byId.get(l.employee_id)?.emp_no));
const SCANNED = { '4269': 'CY81WRZN - Daniel Pienaar - August 2026.pdf', '2104': 'Jacques Travel Log August 2026 (1).pdf', '2059': 'Travel Log Abel Sithole.pdf', '2677': 'Travel Log Peter Matlou.pdf' }; // received as image scans — totals must be captured by hand
const miss = pay.filter((p) => !have.has(p.emp_no)).map((p) => { const e = emps.find((x) => x.emp_no === p.emp_no); return [p.emp_no, e?.full_name ?? p.name, dept(e?.category), bname(e?.branch_id), p.km, SCANNED[p.emp_no] ? 'RECEIVED as scanned PDF — capture totals manually (' + SCANNED[p.emp_no] + ')' : p.km ? 'not received — claimed in July, chase' : 'not received — no claim in July either', e?.email ?? '']; });
const wb2 = XLSX.utils.book_new(); const ws2 = XLSX.utils.aoa_to_sheet([['August 2026 travel logs not received (as at ' + new Date().toISOString().slice(0, 10) + ')'], [], ['Emp No', 'Name', 'Department', 'Branch', 'July business km', 'Status', 'E-mail (unverified)'], ...miss, [], ['Received (' + logs.length + '): ' + logs.map((l) => byId.get(l.employee_id)?.full_name).join(', ')]]); ws2['!cols'] = [8, 28, 12, 14, 14, 30, 34].map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb2, ws2, 'Not received');
XLSX.writeFile(wb2, join(OUT, 'August 2026 travel logs not received.xlsx'));
console.log(`not received: ${miss.length} of ${pay.length} on payroll list (${miss.filter((m) => m[4]).length} of them claimed in July)`);
miss.forEach((m) => console.log(`  ${m[0]} ${m[1].padEnd(26)} ${String(m[2]).padEnd(12)} ${String(m[3]).padEnd(20)} July km ${String(m[4]).padStart(5)}  ${m[5]}`));
