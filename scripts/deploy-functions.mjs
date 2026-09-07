// Deploys supabase/functions/<name>/index.ts via the Management API (PAT only, no CLI).
//   node scripts/deploy-functions.mjs fleet-notify fleet-admin-users
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(join(here, '.env')) ? readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/) : []) { const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const REF = 'pniqwvyscmxfxbhtsace'; const token = process.env.SUPABASE_ACCESS_TOKEN;
for (const name of process.argv.slice(2)) {
  const code = readFileSync(join(here, '..', 'supabase', 'functions', name, 'index.ts'), 'utf8');
  const fd = new FormData();
  fd.append('metadata', JSON.stringify({ name, entrypoint_path: 'index.ts', verify_jwt: true }));
  fd.append('file', new Blob([code], { type: 'text/typescript' }), 'index.ts');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const t = await res.text(); console.log(name, res.status, t.slice(0, 200));
}
