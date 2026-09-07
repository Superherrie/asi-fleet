// Applies a supabase/migrations/*.sql file to the shared Supabase project via the
// Management API, using only a personal access token (no DB password / linking needed).
//
//   node scripts/apply-schema.mjs                       # runs 001_init.sql
//   node scripts/apply-schema.mjs 002_material_pct.sql  # runs a specific migration
//
// Reads SUPABASE_ACCESS_TOKEN from scripts/.env (git-ignored).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// minimal .env loader (no dependency)
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trimStart().startsWith('#')) process.env[m[1]] ??= m[2];
    }
  } catch { /* no .env — rely on real env */ }
}
loadEnv(join(here, '.env'));

const PROJECT_REF = 'pniqwvyscmxfxbhtsace';
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN is empty. Paste it into scripts/.env first.');
  process.exit(1);
}

const migration = process.argv[2] || '001_init.sql';
const sql = readFileSync(join(here, '..', 'supabase', 'migrations', migration), 'utf8');
console.log(`Applying ${migration} (${sql.length} chars) to project ${PROJECT_REF}...`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`FAILED (HTTP ${res.status}):`, text);
  process.exit(1);
}
console.log('OK — schema applied. Response:', text.slice(0, 500) || '(empty)');
