import { readFileSync } from 'node:fs'; import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const regs = { KP05BVGP: '2026-06-10', KP89HHGP: '2026-06-09', KP89HLGP: '2026-06-09', KP89JTGP: '2026-06-10', KS04KTGP: '2026-06-09', KS04LMGP: '2026-07-16', KS04LYGP: '2026-06-10', KS88GNGP: '2026-06-09' };
const withCols = !(await sb.from('fleet_vehicles').select('disposal_type').limit(1)).error;
console.log('disposal columns present:', withCols);
for (const [reg, date] of Object.entries(regs)) {
  const { data: v } = await sb.from('fleet_vehicles').select('id,notes,active').eq('registration', reg).single();
  const tag = `Returned to Avis ${date} (actual termination date per Avis)`;
  const notes = v.notes && v.notes.includes('Returned to Avis') ? v.notes : `${v.notes ? v.notes + ' · ' : ''}${tag}`;
  const patch = withCols ? { active: false, disposal_type: 'returned', disposal_date: date, disposal_note: 'Actual termination date per Avis', notes: v.notes } : { active: false, notes };
  const { error } = await sb.from('fleet_vehicles').update(patch).eq('id', v.id); if (error) throw error;
  const { data: cards } = await sb.from('fleet_cards').select('id,fa_driver_name').eq('vehicle_id', v.id).eq('active', true);
  for (const c of cards) await sb.from('fleet_cards').update({ active: false, notes: `Vehicle returned to Avis ${date} — card retired` }).eq('id', c.id);
  console.log(`${reg} → returned ${date}; ${cards.length} card(s) retired${cards.length ? ': ' + cards.map((c) => c.fa_driver_name).join(', ') : ''}`);
}
