// Imports an Avis Fleet STATEMENT PDF (the monthly "Avis Fleet Statement - <date> - <yyyymm>_CI0009663.pdf").
// Rows are rebuilt from the PDF text positions (the text layer is scrambled in reading order).
// The statement carries amounts incl VAT only; the VAT split is derived: VAT = 15/115 of the amount, and the
// CLAIMABLE part is carried forward per vehicle from the last month that had Avis billing detail (passenger vehicles
// only have the maintenance-fee VAT claimable; commercial vehicles claim it all).
//   node scripts/import-avis-statement.mjs "<statement.pdf>" [--period YYYY-MM] [--apply]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const file = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply'); const forced = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const normKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100; const amt = (s) => { const m = String(s).replace(/ZAR/g, '').replace(/\s/g, '').replace(',', '.').match(/-?[\d.]+(?:\.\d+)?/); if (!m) return null; const t = m[0]; const n = Number(t.includes('.') && t.split('.').length > 2 ? t.replace(/\.(?=.*\.)/g, '') : t.replace(/\.(?=\d{3}(\D|$))/g, '')); return isNaN(n) ? null : n; };
const money = (s) => { const t = String(s).replace(/ZAR/g, '').trim().replace(/\s/g, ''); if (!/^-?[\d,]+[.,]\d\d$/.test(t)) return null; return Number(t.replace(/,(?=\d{3})/g, '').replace(',', '.')); };

// ---- rebuild rows from text positions
const wasmUrl = pathToFileURL(join(here, '..', 'node_modules', 'pdfjs-dist', 'wasm') + '/').href;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), wasmUrl, useWasm: false }).promise;
const i0 = (tc) => { const it = tc.items.find((i) => i.str.trim()); return it ? it.transform[1] : 0 };
const rows = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p); const tc = await page.getTextContent();
  // the statement pages are rotated 90°: transform[4] is the row axis, transform[5] the column axis
  const rot = Math.abs(i0(tc)) > 0.1; const items = tc.items.filter((i) => i.str.trim()).map((i) => (rot ? { x: i.transform[5], y: Math.round(i.transform[4] * 10) / 10, s: i.str.trim() } : { x: i.transform[4], y: Math.round(i.transform[5]), s: i.str.trim() }));
  const byY = new Map(); for (const it of items) { const key = [...byY.keys()].find((k) => Math.abs(k - it.y) <= 2) ?? it.y; (byY.get(key) ?? byY.set(key, []).get(key)).push(it); }
  for (const [y, its] of [...byY.entries()].sort((a, b) => (rot ? a[0] - b[0] : b[0] - a[0]))) rows.push({ page: p, y, items: its.sort((a, b) => a.x - b.x) });
}
const stmtNo = rows.flatMap((r) => r.items.map((i) => i.s)).find((s) => /^\d{6}_CI\d+$/.test(s)) ?? '';
const stmtDate = rows.flatMap((r) => r.items.map((i) => i.s)).find((s) => /^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/.test(s)) ?? '';
const TYPES = /^(MINV|MCRN|REPAIR|FINESINV|CHGINV|EXCKMI|LICINV|IBINV|INTRATEC|TOLLINV|DAMAGE|TYRES|ACC)/;
const lines = [];
for (const r of rows) {
  const toks = r.items.map((i) => i.s);
  const type = toks.find((t) => TYPES.test(t)); if (!type) continue;
  const date = toks.find((t) => /^\d{4}\/\d{2}\/\d{2}$/.test(t)) ?? null;
  const docNo = toks.find((t) => /^(SIN\w+-\d+|T\d{15,}|[A-Z]{2,4}\d{2}[A-Z]\d{3}-\d+)$/.test(t)) ?? null;
  const reg = toks.find((t) => /^[A-Z]{2,3}\d{2,3}[A-Z]{2,4}$/.test(t) && !/^ZAR$/.test(t)) ?? null;
  const mva = toks.find((t) => /^\d{7}$/.test(t)) ?? null;
  const ref = toks.find((t) => /^\d{7}\/\d+$/.test(t)) ?? null;
  const cc = toks.find((t) => /^[A-Z][A-Z ]+-[A-Z][A-Z ]+$/.test(t) && !TYPES.test(t)) ?? null;
  const nums = r.items.filter((i) => money(i.s) != null).map((i) => ({ x: i.x, v: money(i.s) }));
  lines.push({ page: r.page, y: r.y, type, date, docNo, reg, mva, ref, cc, nums, raw: toks.join(' | ') });
}
// amounts: the rightmost figure on the row is AMOUNT (signed by doc type); debit/credit columns precede it
for (const l of lines) { const sorted = l.nums.sort((a, b) => a.x - b.x); const nz = sorted.filter((n) => n.v !== 0); l.amount = nz.length ? nz[nz.length - 1].v : (sorted.length ? sorted[sorted.length - 1].v : null); if (l.type === 'MCRN' && l.amount != null) l.amount = -Math.abs(l.amount); }
const complete = lines.filter((l) => l.reg && l.amount != null);
const dates = complete.filter((l) => l.type === 'MINV').map((l) => l.date?.slice(0, 7).replace('/', '-')).filter(Boolean).sort();
const period = forced ?? (dates.length ? dates[Math.floor(dates.length / 2)] : null);
const total = r2(complete.reduce((s, l) => s + l.amount, 0));
console.log(`${basename(file)} → statement ${stmtNo} dated ${stmtDate} → period ${period}: ${lines.length} transaction rows, ${complete.length} complete, total R ${total}`);
const bad = lines.filter((l) => !l.reg || l.amount == null); if (bad.length) { console.log('  rows not fully parsed:'); bad.slice(0, 10).forEach((l) => console.log('   ', l.raw.slice(0, 160))); }
const byType = {}; complete.forEach((l) => { byType[l.type] = r2((byType[l.type] ?? 0) + l.amount); }); console.log('  by type:', JSON.stringify(byType));

// ---- VAT split per vehicle from the last billing detail
const { createClient } = await import('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: vehicles }, { data: branches }, { data: prior }] = await Promise.all([sb.from('fleet_vehicles').select('id,registration,branch_id'), sb.from('fleet_branches').select('*'), sb.from('fleet_avis_lines').select('reg,vehicle_type,vat,vat_claimable,period,transaction_type').eq('transaction_type', 'MINV').order('period', { ascending: false })]);
const vByReg = new Map(vehicles.map((v) => [normReg(v.registration), v]));
const branchOf = (s) => { const k = normKey(String(s).split('-')[0]).toUpperCase(); return branches.find((b) => b.code === k || b.name.toUpperCase() === k || (b.aliases ?? []).some((a) => a.toUpperCase() === k)) ?? null; };
const lastSplit = new Map(); for (const p of prior) { const k = normReg(p.reg); if (!lastSplit.has(k)) lastSplit.set(k, { vehicle_type: p.vehicle_type, claimShare: Number(p.vat) ? Number(p.vat_claimable) / Number(p.vat) : 1, claimAmt: Number(p.vat_claimable) }); }
const out = complete.map((l) => {
  const incl = l.amount; const excl = r2(incl / 1.15); const vat = r2(incl - excl); const s = lastSplit.get(l.reg);
  // passenger vehicles: only the maintenance-fee VAT is claimable — carry the rand amount from the last detail; commercial: all claimable
  const vatc = l.type !== 'MINV' ? vat : s ? (s.vehicle_type === 'PASSENGER' ? r2(Math.min(vat, s.claimAmt)) * Math.sign(vat || 1) : vat) : vat;
  const v = vByReg.get(l.reg);
  return { reg: l.reg, mva_number: l.mva, driver_name: null, kilometers: null, rental_excl: excl, vat, amount_due: incl, vat_claimable: vatc, total: r2(incl - vatc), cost_centre_name: l.cc?.split('-')[0]?.trim() ?? null,
    vehicle_type: s?.vehicle_type ?? null, product: 'FML', transaction_type: l.type, make_model: null, transaction_date: l.date?.replace(/\//g, '-') ?? null, document_no: l.docNo, transaction_number: l.ref,
    vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? branchOf(l.cc ?? '')?.id ?? null, _split: s ? 'carried' : 'assumed' };
});
const unknownSplit = out.filter((o) => o._split === 'assumed' && o.transaction_type === 'MINV').map((o) => o.reg); if (unknownSplit.length) console.log('  no prior VAT split (claimable assumed = full VAT):', [...new Set(unknownSplit)].join(', '));
const missing = [...new Set(out.filter((o) => !o.vehicle_id).map((o) => o.reg))]; if (missing.length) console.log('  not on fleet master:', missing.join(', '));
console.log(`  derived: rental excl ${r2(out.reduce((s, o) => s + o.rental_excl, 0))} · VAT ${r2(out.reduce((s, o) => s + o.vat, 0))} · claimable ${r2(out.reduce((s, o) => s + o.vat_claimable, 0))} · expense ${r2(out.reduce((s, o) => s + o.total, 0))}`);
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
await sb.from('fleet_imports').delete().eq('source', 'avis').eq('period', period).is('provider', null);
const { data: imp, error } = await sb.from('fleet_imports').insert({ source: 'avis', period, file_name: basename(file), row_count: out.length, total_amount: total, notes: `Avis statement ${stmtNo} (${stmtDate}); VAT split derived (15/115, claimable carried per vehicle)` }).select('id').single(); if (error) throw error;
const payload = out.map(({ _split, ...o }) => ({ import_id: imp.id, period, ...o }));
for (let i = 0; i < payload.length; i += 500) { const { error: e } = await sb.from('fleet_avis_lines').insert(payload.slice(i, i + 500)); if (e) throw e; }
console.log(`imported ${payload.length} lines for ${period}, R ${total}`);
