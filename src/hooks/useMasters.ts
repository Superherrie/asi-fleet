import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Allocation, Branch, Card, ClaimRate, Employee, GlMap, Setting, Vehicle } from '../lib/types'
import { BranchMatcher } from '../lib/match'

export interface Masters {
  branches: Branch[]; vehicles: Vehicle[]; employees: Employee[]; cards: Card[]; glmap: GlMap[]; settings: Setting[]; rates: ClaimRate[]; allocations: Allocation[]
  bm: BranchMatcher
  loading: boolean
  reload: () => Promise<void>
  setting: (key: string) => string
  vatRate: number
}

export function useMasters(): Masters {
  const [state, setState] = useState<Omit<Masters, 'bm' | 'loading' | 'reload' | 'setting' | 'vatRate'>>({ branches: [], vehicles: [], employees: [], cards: [], glmap: [], settings: [], rates: [], allocations: [] })
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    const [b, v, e, c, g, s, r, a] = await Promise.all([
      supabase.from('fleet_branches').select('*').order('code'),
      supabase.from('fleet_vehicles').select('*').order('registration'),
      supabase.from('fleet_employees').select('*').order('full_name'),
      supabase.from('fleet_cards').select('*').order('fa_driver_name'),
      supabase.from('fleet_gl_map').select('*'),
      supabase.from('fleet_settings').select('*'),
      supabase.from('fleet_claim_rates').select('*').order('effective_from'),
      supabase.from('fleet_allocations').select('*').order('effective_from'),
    ])
    setState({
      branches: (b.data ?? []) as Branch[], vehicles: (v.data ?? []) as Vehicle[], employees: (e.data ?? []) as Employee[],
      cards: (c.data ?? []) as Card[], glmap: (g.data ?? []) as GlMap[], settings: (s.data ?? []) as Setting[], rates: (r.data ?? []) as ClaimRate[], allocations: (a.data ?? []) as Allocation[],
    })
    setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])
  const bm = useMemo(() => new BranchMatcher(state.branches), [state.branches])
  const setting = useCallback((key: string) => state.settings.find((s) => s.key === key)?.value ?? '', [state.settings])
  const vatRate = Number(setting('vat_rate')) || 15
  return { ...state, bm, loading, reload, setting, vatRate }
}
