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

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
/** Reads every row of a query. PostgREST returns at most 1,000 rows per request, so a 12-month dashboard window (Avis fines, maintenance lines) is fetched in pages. Pass a factory that builds the query with a stable order, e.g. `() => supabase.from('t').select('*').eq(...).order('id')`. */
export async function fetchAll<T>(make: () => { range(from: number, to: number): Page<T> }, page = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await make().range(from, from + page - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? [])); if (!data || data.length < page) break
  }
  return out
}
