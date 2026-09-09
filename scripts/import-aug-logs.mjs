// One-off: import the August 2026 travel logs (workbooks + text-based PDFs) as SUBMITTED logs,
// ready for approval in the app (approval creates the claims once the rates are set).
//
//   node scripts/import-aug-logs.mjs "<folder with logs>" [--period 2026-08] [--apply]
//
// PDFs are read with pdftotext -layout (poppler). Scanned PDFs (no text layer) are listed for manual capture.
// Optional scripts/aug-overrides.json: { "<file name>": { emp_no, employee_name, vehicle_reg, opening_odo, closing_odo, business_km, private_km } }
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import XLSX from 'xlsx';
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const args = process.argv.slice(2); const folder = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply'); const period = args[args.indexOf('--period') + 1] && args.includes('--period') ? args[args.indexOf('--period') + 1] : '2026-08';
if (!folder) { console.error('usage: node scripts/import-aug-logs.mjs <folder> [--period YYYY-MM] [--apply]'); process.exit(1); }
const overrides = existsSync(join(here, 'aug-overrides.json')) ? JSON.parse(readFileSync(join(here, 'aug-overrides.json'), 'utf8')) : {};

const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };
const isoFromSerial = (n) => new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
const isoDate = (v) => { if (typeof v === 'number') return isoFromSerial(v); const m = String(v).match(/(\d{4})[/-](\d{2})[/-](\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// ------------------------------------------------------------ workbook parser (mirrors src/lib/parsers.ts)
function parseWorkbook(file) {
  const wb = XLSX.readFile(file); const name = wb.SheetNames.find((n) => /electronic/i.test(n)) ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const labelRow = (l) => rows.findIndex((r) => normKey(r[0]) === l); const val = (r) => (r >= 0 ? String(rows[r][2]).trim() : '');
  const rightRow = (re) => rows.findIndex((r) => re.test(String(r[5] ?? ''))); const rv = (r) => (r >= 0 && rows[r][8] !== '' ? toNum(rows[r][8]) : null);
  const rOpen = rightRow(/^opening odometer/i), rBiz = rightRow(/^total business km/i), rClose = rightRow(/^closing odometer/i), rPriv = rightRow(/^total private km/i);
  const hdr = rows.findIndex((r) => normKey(r[0]) === 'date' && normKey(r[1]).startsWith('opening'));
  const lines = [];
  if (hdr >= 0) for (const r of rows.slice(hdr + 2)) {
    const d = isoDate(r[0]); if (!d && !(r[1] !== '' && r[2] !== '' && (toNum(r[1]) || toNum(r[2])))) continue;
    lines.push({ trip_date: d, opening_km: r[1] === '' ? null : toNum(r[1]), closing_km: r[2] === '' ? null : toNum(r[2]), private_km: toNum(r[3]), business_km: toNum(r[4]), destination: String(r[5] ?? '').trim() || null, reason: String(r[7] ?? r[6] ?? '').trim() || null });
  }
  return { emp_no: val(labelRow('employee no')).replace(/\D/g, '').padStart(4, '0').slice(-4), employee_name: val(labelRow('employee name')), branch: val(labelRow('branch')), department: val(labelRow('department')), vehicle_reg: normReg(val(labelRow('vehicle registration number'))),
    opening_odo: rv(rOpen), closing_odo: rv(rClose), business_km: rv(rBiz) ?? lines.reduce((s, l) => s + l.business_km, 0), private_km: rv(rPriv) ?? lines.reduce((s, l) => s + l.private_km, 0), lines };
}

// ------------------------------------------------------------ PDF parser (pdftotext -layout of the same template)
function parsePdf(file) {
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (text.replace(/\s/g, '').length < 100) return { scanned: true };
  const L = text.split(/\r?\n/);
  const find = (re) => L.find((l) => re.test(l)) ?? '';
  // header block: the value sits on the line at/after the label; easiest robust cues are the Total line and the odometer lines
  const empLine = find(/^\s*Employee No\s+\S/); const empNo = (empLine.match(/Employee No\s+(\d{3,4})/) ?? [])[1] ?? '';
  const nameLine = L[L.findIndex((l) => /^\s*Employee No/.test(l)) + 1] ?? ''; const employee_name = (nameLine.match(/^\s*([A-Za-z][A-Za-z .'-]+?)\s{2,}/) ?? [])[1] ?? (empLine.match(/Employee No\s+([A-Za-z][A-Za-z .'-]+?)\s{2,}/) ?? [])[1] ?? '';
  const regLine = L.find((l) => /^\s{10,}[A-Z]{2,3}\s?\d{2,3}\s?[A-Z]{0,2}\s?[A-Z]{2}\s*$|^\s{10,}[A-Z0-9 ]{6,12}\s*$/.test(l) && !/Travel|Total|Date/.test(l)) ?? '';
  const vehicle_reg = normReg(regLine);
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const monLine = L.find((l) => /^\s*[A-Z][a-z]+\s*-\s*\d{2}\s*$/.test(l)); const mm = monLine?.trim().match(/^([A-Za-z]+)\s*-\s*(\d{2})$/);
  const filePeriod = mm && MONTHS[mm[1].toLowerCase().slice(0, 3)] ? `20${mm[2]}-${String(MONTHS[mm[1].toLowerCase().slice(0, 3)]).padStart(2, '0')}` : null;
  // Total <private> <business> <total km> <pct>  — strip the %, split on 2+ spaces, drop thousand-separator spaces ("1 323")
  const totalLine = find(/^\s*Total\s+\d/);
  const nums = totalLine.replace(/Total/, '').replace(/\d+[.,]\d+\s*%/g, '').trim().split(/\s{2,}/).filter(Boolean).map((t) => toNum(t.replace(/\s/g, '')));
  const private_km = nums[0] ?? 0, business_km = nums[1] ?? 0;
  const odoNums = L.filter((l) => /Opening Odometer|Closing Odometer|Traveled|Traveled for|the month/.test(l) || /^\s+\d[\d ]{3,}\s*$/.test(l)).join(' ').match(/\b\d[\d ]{3,}\b/g) ?? [];
  // header column positions (fallback) for classifying a lone km figure
  const hdrIdx = L.findIndex((l) => /Private/.test(l) && /Business/.test(l));
  const privCol = hdrIdx >= 0 ? L[hdrIdx].indexOf('Private') : 40; const bizCol = hdrIdx >= 0 ? L[hdrIdx].indexOf('Business') : 55;
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const raw = [];
  for (const l of L) {
    const m = l.match(/^\s*(\d{4})\/([A-Za-z0-9]{2,3})\/(\d{2})\s+(\d+)\s+(\d+)(.*)$/); if (!m) continue;
    const mon = /^\d+$/.test(m[2]) ? m[2] : String(MON.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0');
    const rest = m[6]; const base = l.length - rest.length;
    const kms = [...rest.matchAll(/(?<=\s|^)(-?\d+)(?=\s|$)/g)].filter((x) => /^[\s\d-]*$/.test(rest.slice(0, x.index))).map((x) => ({ v: toNum(x[1]), end: base + x.index + x[1].length }));
    const textStart = rest.search(/[A-Za-z]/); const textPart = textStart >= 0 ? rest.slice(textStart) : '';
    const parts = textPart.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean);
    raw.push({ date: `${m[1]}-${mon}-${m[3]}`, open: toNum(m[4]), close: toNum(m[5]), kms, parts });
  }
  // learn where the private / business columns end from rows that carry both figures
  const twos = raw.filter((r) => r.kms.length >= 2); const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const privEnd = twos.length ? med(twos.map((r) => r.kms[0].end)) : privCol + 7; const bizEnd = twos.length ? med(twos.map((r) => r.kms[1].end)) : bizCol + 8;
  const lines = [];
  for (const r of raw) {
    let priv = 0, biz = 0;
    if (r.kms.length >= 2) { priv = r.kms[0].v; biz = r.kms[1].v; }
    else if (r.kms.length === 1) { if (Math.abs(r.kms[0].end - bizEnd) < Math.abs(r.kms[0].end - privEnd)) biz = r.kms[0].v; else priv = r.kms[0].v; }
    lines.push({ trip_date: r.date, opening_km: r.open, closing_km: r.close, private_km: priv, business_km: biz, destination: r.parts[0] ?? null, reason: r.parts[1] ?? null });
  }
  const opening_odo = lines[0]?.opening_km ?? (odoNums[0] ? toNum(odoNums[0].replace(/\s/g, '')) : null); const closing_odo = lines.length ? lines[lines.length - 1].closing_km : null;
  return { emp_no: empNo.padStart(4, '0'), employee_name: employee_name.trim(), branch: '', department: '', vehicle_reg, opening_odo, closing_odo, business_km, private_km, lines, period: filePeriod };
}

// ------------------------------------------------------------ run
const files = readdirSync(folder).filter((f) => /\.(xls|xlsx|xlsm|pdf)$/i.test(f) && !f.startsWith('~$'));
const parsed = []; const scanned = [];
for (const f of files) {
  const full = join(folder, f); let p;
  try { p = extname(f).toLowerCase() === '.pdf' ? parsePdf(full) : parseWorkbook(full); } catch (e) { console.error(`✗ ${f}: ${e.message}`); continue; }
  if (overrides[f]?.skip) continue;
  if (p.scanned) { scanned.push(f); if (overrides[f]) parsed.push({ file: f, ...overrides[f], lines: [], manual: true }); continue; }
  if (overrides[f]) Object.assign(p, overrides[f]);
  parsed.push({ file: f, ...p });
}
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: emps } = await sb.from('fleet_employees').select('*'); const { data: branches } = await sb.from('fleet_branches').select('*');
const byNo = new Map(emps.map((e) => [e.emp_no, e])); const byName = new Map(emps.map((e) => [normKey(e.full_name), e]));
const nameLoose = (n) => { const k = normKey(n).split(' '); return emps.find((e) => { const p = normKey(e.full_name).split(' '); return k[0] && p[0] === k[0] && p[p.length - 1] === k[k.length - 1]; }); };
const branchOf = (s) => branches.find((b) => normKey(b.name) === normKey(s) || (b.aliases ?? []).some((a) => normKey(a) === normKey(s)) || normKey(s).includes(normKey(b.name)));

const seen = new Set(); const plan = [];
for (const p of parsed) {
  const emp = byNo.get(p.emp_no) ?? byName.get(normKey(p.employee_name)) ?? nameLoose(p.employee_name);
  const per = p.period ?? period;
  const key = `${emp?.id ?? p.employee_name}|${per}`;
  const dup = seen.has(key); seen.add(key);
  const lb = p.lines.reduce((s, l) => s + l.business_km, 0), lp = p.lines.reduce((s, l) => s + l.private_km, 0);
  plan.push({ ...p, emp, dup, lineBiz: lb, linePriv: lp, per });
  console.log(`${dup ? 'DUP ' : emp ? 'OK  ' : 'NEW '} ${per} ${p.file.padEnd(52)} ${(p.emp_no + ' ' + p.employee_name).padEnd(30)} → ${emp ? `${emp.full_name} (${emp.emp_no})` : '— no employee —'} | reg ${p.vehicle_reg || '?'} | biz ${p.business_km} priv ${p.private_km} | lines ${p.lines.length} (biz ${lb} priv ${lp})${p.manual ? ' [manual totals]' : ''}`);
}
if (scanned.length) console.log(`\nScanned PDFs (no text layer) — capture manually or add to scripts/aug-overrides.json:\n  ${scanned.filter((f) => !overrides[f]).join('\n  ') || '(all covered by overrides)'}`);
if (!APPLY) { console.log('\ndry run — add --apply to import'); process.exit(0); }

let n = 0;
for (const p of plan) {
  if (p.dup) continue;
  let emp = p.emp;
  if (!emp) {
    const { data, error } = await sb.from('fleet_employees').insert({ emp_no: /^\d{4}$/.test(p.emp_no) ? p.emp_no : null, full_name: p.employee_name || basename(p.file), category: /sales/i.test(p.department) ? 'Sales' : 'Ops Cabling', branch_id: branchOf(p.branch)?.id ?? null, notes: `Created from August 2026 travel log import (${p.file}) — check` }).select('*').single();
    if (error) { console.error(`✗ ${p.file}: ${error.message}`); continue; } emp = data;
  }
  const period = p.per;
  await sb.from('fleet_travel_logs').delete().eq('period', period).eq('employee_id', emp.id).in('status', ['draft', 'submitted', 'rejected']);
  const { data: log, error } = await sb.from('fleet_travel_logs').insert({
    period, employee_id: emp.id, vehicle_reg: p.vehicle_reg || null, branch_id: branchOf(p.branch)?.id ?? emp.branch_id, department: p.department || emp.category,
    opening_odo: p.opening_odo, opening_date: `${period}-01`, closing_odo: p.closing_odo, closing_date: `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, "0")}`,
    business_km: p.business_km, private_km: p.private_km, status: 'submitted', submitted_at: new Date().toISOString(), manager_email: emp.manager_email, source: 'import', source_file: p.file,
  }).select('id').single();
  if (error) { console.error(`✗ ${p.file}: ${error.message}`); continue; }
  if (p.lines.length) { const { error: lErr } = await sb.from('fleet_travel_log_lines').insert(p.lines.map((l, i) => ({ log_id: log.id, line_no: i + 1, ...l }))); if (lErr) console.error(`  lines: ${lErr.message}`); }
  n++;
}
console.log(`\nImported ${n} logs for ${period} as SUBMITTED — approve them under Approvals once the claim rates are set.`);
