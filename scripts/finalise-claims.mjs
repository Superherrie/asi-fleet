// Marks a month's claims (and the late claims paid with them) as finalised.  node scripts/finalise-claims.mjs 2026-08
import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const period = process.argv[2]; if (!/^\d{4}-\d{2}$/.test(period ?? '')) { console.error('usage: node scripts/finalise-claims.mjs YYYY-MM'); process.exit(1); }
const { data: cur } = await sb.from('fleet_claims').update({ status: 'finalised' }).eq('period', period).neq('status', 'finalised').select('id');
const { data: late } = await sb.from('fleet_claims').update({ status: 'finalised' }).lt('period', period).in('status', ['pending', 'exported']).select('id,period');
console.log(`${period}: ${cur.length} claims finalised; late claims paid with this month finalised: ${late.length} (${[...new Set(late.map((c) => c.period))].sort().join(', ')})`);
const { data: all } = await sb.from('fleet_claims').select('period,status'); const g = {}; for (const c of all) { g[`${c.period} ${c.status}`] = (g[`${c.period} ${c.status}`] ?? 0) + 1; } console.log(g);
