// Creates the first admin user directly (bootstraps the admin-only edge function).
// Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD from scripts/.env.
//
//   node scripts/create-admin.mjs [email] [full name]
//
// Defaults: herman.devries@asiconnect.co.za / "Herman de Vries".
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.ADMIN_PASSWORD;
const email = process.argv[2] || 'herman.devries@asiconnect.co.za';
const fullName = process.argv[3] || 'Herman de Vries';

if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exit(1); }
if (!PASSWORD) { console.error('Missing ADMIN_PASSWORD in scripts/.env'); process.exit(1); }

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// find existing auth user (idempotent re-runs)
let userId;
{
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error('listUsers failed:', error.message); process.exit(1); }
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}

if (!userId) {
  const { data, error } = await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) { console.error('createUser failed:', error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Created auth user ${email} (${userId})`);
} else {
  const { error } = await sb.auth.admin.updateUserById(userId, { password: PASSWORD });
  if (error) { console.error('updateUser failed:', error.message); process.exit(1); }
  console.log(`Auth user ${email} already existed (${userId}) — password reset.`);
}

const { error: pErr } = await sb.from('fleet_profiles').upsert(
  { user_id: userId, email, full_name: fullName, is_admin: true, role: 'admin' },
  { onConflict: 'user_id' },
);
if (pErr) { console.error('profile upsert failed:', pErr.message); process.exit(1); }
console.log(`Admin profile ready for ${email} (is_admin=true). You can now log in.`);
