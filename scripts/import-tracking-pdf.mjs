// Imports tracking-company PDF tax invoices (Cartrack / Tracker) into fleet_tracking_lines.
//   node scripts/import-tracking-pdf.mjs "<folder or pdf>" [--period YYYY-MM] [--control <debit order amount>] [--apply]
// Text comes from pdftotext (-raw for Cartrack, -layout for Tracker); parsing lives in src/lib/trackingPdf.ts (shared with the app).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProvider, parseCartrackLines, parseTrackerLines } from '../src/lib/trackingPdf.ts';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const args = process.argv.slice(2); const target = args.find((a) => !a.startsWith('--')); const APPLY = args.includes('--apply');
const forced = args.includes('--period') ? args[args.indexOf('--period') + 1] : null;
const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => /\.pdf$/i.test(f)).map((f) => join(target, f)) : [target];
const normReg = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const r2 = (n) => Math.round(n * 100) / 100;

const parsed = [];
for (const f of files) {
  const text = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); const provider = detectProvider(text);
  if (!provider) { console.log(`?? ${basename(f)}: not a Cartrack/Tracker invoice`); continue; }
  const p = provider === 'Cartrack' ? parseCartrackLines(execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' }).split(/\r?\n/)) : parseTrackerLines(text.split(/\r?\n/));
  parsed.push({ file: basename(f), ...p });
  console.log(`${provider.padEnd(8)} ${basename(f).padEnd(34)} period ${p.period ?? '?'}  lines ${p.rows.length}  ` + p.invoices.map((i) => `${i.invoice} excl ${i.excl} vat ${i.vat} total ${i.total} | lines excl ${r2(p.rows.filter((r) => r.invoice === i.invoice).reduce((s, r) => s + r.amount_excl, 0))} total ${r2(p.rows.filter((r) => r.invoice === i.invoice).reduce((s, r) => s + r.total, 0))}`).join(' ; '));
}
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: vehicles } = await sb.from('fleet_vehicles').select('id,registration,branch_id'); const vByReg = new Map(vehicles.map((v) => [normReg(v.registration), v]));
for (const p of parsed) { const miss = [...new Set(p.rows.filter((r) => r.reg && !vByReg.has(r.reg)).map((r) => r.reg))]; if (miss.length) console.log(`   ${p.provider}: not on fleet master → ${miss.join(', ')}`); const noreg = p.rows.filter((r) => !r.reg); if (noreg.length) console.log(`   ${p.provider}: ${noreg.length} lines without a registration`); }
if (!APPLY) { console.log('dry run — add --apply'); process.exit(0); }
// group by provider + period, replace the earlier import of the same key
const groups = new Map();
for (const p of parsed) { const period = forced ?? p.period; if (!period) { console.log(`skip ${p.file}: no period`); continue; } const k = `${p.provider}|${period}`; const g = groups.get(k) ?? { provider: p.provider, period, rows: [], files: [], control: null }; g.rows.push(...p.rows); g.files.push(p.file); groups.set(k, g); }
for (const g of groups.values()) {
  await sb.from('fleet_imports').delete().eq('source', 'tracking').eq('period', g.period).eq('provider', g.provider);
  const total = r2(g.rows.reduce((s, r) => s + r.total, 0));
  const { data: imp, error } = await sb.from('fleet_imports').insert({ source: 'tracking', period: g.period, provider: g.provider, file_name: g.files.join(', '), row_count: g.rows.length, total_amount: total, notes: 'PDF tax invoice(s)' }).select('id').single(); if (error) throw error;
  const payload = g.rows.map((r) => { const v = vByReg.get(r.reg); return { import_id: imp.id, period: g.period, provider: g.provider, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? null, ...r }; });
  const { error: lErr } = await sb.from('fleet_tracking_lines').insert(payload); if (lErr) throw lErr;
  console.log(`imported ${g.provider} ${g.period}: ${payload.length} lines, R ${total} incl — enter the debit order amount under Imports → Balance check`);
}
