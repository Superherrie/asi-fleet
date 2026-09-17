import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { VehicleQuery, VehicleQueryComment } from '../lib/types'
import { periodLabel } from '../lib/format'
import { Button, Badge } from './ui'

export const QUERY_SELECT = '*, fleet_vehicle_query_comments(*)'
export const queryTone = (s: VehicleQuery['status']) => (s === 'open' ? 'amber' : s === 'answered' ? 'teal' : 'slate') as 'amber' | 'teal' | 'slate'
export const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Simple centred dialog. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-navy/50 p-4 pt-16" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-lg bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-display text-base font-semibold text-brand-navy">{title}</h3>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  )
}

/** One query's comment thread with a reply box; admins and the person who raised it can close or reopen it. */
export function QueryThread({ q, onChange }: { q: VehicleQuery; onChange: () => void }) {
  const { isAdmin, session } = useAuth()
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const comments: VehicleQueryComment[] = [...(q.fleet_vehicle_query_comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const mine = q.raised_by === session?.user.id
  async function send() {
    if (!body.trim()) return
    setBusy(true); setErr(null)
    const { error } = await supabase.from('fleet_vehicle_query_comments').insert({ query_id: q.id, body: body.trim() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setBody(''); onChange()
  }
  async function setStatus(status: VehicleQuery['status']) {
    setBusy(true); setErr(null)
    const { error } = await supabase.from('fleet_vehicle_queries').update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', q.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    onChange()
  }
  const box = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-lilac focus:outline-none'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone={queryTone(q.status)}>{q.status}</Badge>
        <span>raised by <b className="text-slate-700">{q.raised_by_name}</b> on {when(q.created_at)}</span>
        {q.period_from && q.period_to && <span>· costs shown for {periodLabel(q.period_from)} – {periodLabel(q.period_to)}</span>}
      </div>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className={`rounded-md border px-3 py-2 text-sm ${c.by_admin ? 'border-brand-teal/60 bg-teal-50/60' : 'border-slate-200 bg-slate-50'}`}>
            <div className="mb-1 text-xs text-slate-500">
              <b className="text-slate-700">{c.author_name}</b>
              {c.by_admin && <span className="ml-1 rounded bg-brand-teal px-1 text-[10px] font-semibold uppercase text-brand-navy">fleet admin</span>} · {when(c.created_at)}
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
        {comments.length === 0 && <li className="text-sm text-slate-500">No comments yet.</li>}
      </ul>
      {q.status !== 'closed' ? (
        <div className="space-y-2">
          <textarea className={box} rows={3} placeholder={isAdmin ? 'Reply to the branch manager…' : 'Add a comment…'} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !body.trim()} onClick={() => void send()}>{isAdmin ? 'Reply' : 'Add comment'}</Button>
            {(isAdmin || mine) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('closed')}>Close query</Button>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </div>
      ) : (
        (isAdmin || mine) && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            Closed {q.closed_at ? when(q.closed_at) : ''}.
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('open')}>Reopen</Button>
            {err && <span className="text-red-600">{err}</span>}
          </div>
        )
      )}
    </div>
  )
}

/** Dialog to raise a new query on a vehicle. */
export function NewQuery({ vehicleId, label, from, to, onClose, onSaved }: { vehicleId: number; label: string; from: string; to: string; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!subject.trim() || !body.trim()) return
    setBusy(true); setErr(null)
    const { data, error } = await supabase.from('fleet_vehicle_queries').insert({ vehicle_id: vehicleId, subject: subject.trim(), period_from: from, period_to: to }).select('id').single()
    if (error || !data) { setBusy(false); setErr(error?.message ?? 'Could not save'); return }
    const { error: e2 } = await supabase.from('fleet_vehicle_query_comments').insert({ query_id: data.id, body: body.trim() })
    setBusy(false)
    if (e2) { setErr(e2.message); return }
    onSaved()
  }
  const box = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-lilac focus:outline-none'
  return (
    <Modal title={`Query on ${label}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Ask the fleet administrator about this vehicle. The query and the reply stay on the vehicle so you can follow it up here.</p>
        <input className={box} placeholder="Subject, e.g. High fuel spend in August" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
        <textarea className={box} rows={5} placeholder="Your query…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center gap-2">
          <Button disabled={busy || !subject.trim() || !body.trim()} onClick={() => void save()}>Send query</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </div>
    </Modal>
  )
}
