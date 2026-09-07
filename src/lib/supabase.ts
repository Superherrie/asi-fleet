import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = !!(url && anonKey)

if (!supabaseConfigured) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured')
}

// Placeholder keeps the app rendering (with failing requests) when unconfigured,
// instead of crashing on createClient.
export const supabase = createClient(
  url || 'https://unconfigured.supabase.co',
  anonKey || 'unconfigured',
)
