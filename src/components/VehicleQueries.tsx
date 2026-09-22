import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { VehicleQuery } from '../lib/types'
import type { Masters } from '../hooks/useMasters'
import { Card, Badge, Button } from './ui'
import { QueryThread, QUERY_SELECT, queryTone, when } from './QueryThread'
import { useCollapsed } from '../lib/useCollapsed'

/** Admin dashboard card: queries raised by branch managers on their vehicles, newest activity first. */
export default function VehicleQueries({ m }: { m: Masters }) {
  const [queries, setQueries] = useState<VehicleQuery[] | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [open, setOpen] = useState<number | null>(null); const [show, toggle] = useCollapsed('dash.queries')
  const load = () => void supabase.from('fleet_vehicle_queries').select(QUERY_SELECT).order('updated_at', { ascending: false }).then(({ data }) => setQueries((data ?? []) as VehicleQuery[]))
  useEffect(() => { load() }, [])
  if (!queries || queries.length === 0) return null
  const shown = queries.filter((q) => showClosed || q.status !== 'closed')
  const waiting = queries.filter((q) => q.status === 'open').length
  return (
    <Card
      title={<span>Vehicle queries from branch managers{waiting > 0 && <span className="ml-2 rounded-full bg-amber-400 px-2 text-xs font-semibold text-brand-navy">{waiting} waiting for a reply</span>}</span>}
      className="mb-4"
      actions={<div className="flex items-center gap-3">{show && <label className="text-xs text-slate-500"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show closed</label>}<Button size="sm" variant="secondary" onClick={toggle}>{show ? 'Collapse' : `Expand (${shown.length})`}</Button></div>}>
      {!show ? <p className="text-xs text-slate-500">{waiting > 0 ? `${waiting} waiting for a reply` : 'No open queries'} · collapsed</p> : shown.length === 0 ? <p className="text-sm text-slate-500">No open queries.</p> : (
        <ul className="divide-y divide-slate-200">
          {shown.map((q) => {
            const v = m.vehicles.find((x) => x.id === q.vehicle_id)
            const last = [...(q.fleet_vehicle_query_comments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
            return (
              <li key={q.id} className="py-2">
                <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === q.id ? null : q.id)}>
                  <Badge tone={queryTone(q.status)}>{q.status}</Badge>
                  <span className="font-medium text-brand-navy">{v?.registration ?? `vehicle ${q.vehicle_id}`}</span>
                  <span className="text-xs text-slate-500">{v ? `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}` : ''} · {q.branch_id ? m.bm.code(q.branch_id) : ''}</span>
                  <span className="text-sm">{q.subject}</span>
                  <span className="ml-auto text-xs text-slate-500">{q.raised_by_name} · {last ? `last comment ${when(last.created_at)}` : when(q.created_at)}</span>
                  <span className="text-xs text-brand-purple">{open === q.id ? 'hide' : 'open'}</span>
                </button>
                {open === q.id && <div className="mt-2 rounded-lg border border-slate-200 p-3"><QueryThread q={q} onChange={load} /></div>}
              </li>
            )
          })}
        </ul>
      )}
      {show && <div className="mt-2 text-right"><Button size="sm" variant="ghost" onClick={load}>Refresh</Button></div>}
    </Card>
  )
}
