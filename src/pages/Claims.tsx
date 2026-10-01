import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import type { InsuranceClaim, InsuranceClaimEvent } from '../lib/types'
import { money, fmtDate } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Select, Spinner, Empty, Stat, Input, Field } from '../components/ui'
import { Modal } from '../components/QueryThread'

const TYPES: [InsuranceClaim['incident_type'], string][] = [['accident', 'Accident'], ['hijacking', 'Hijacking'], ['theft', 'Theft'], ['break_in', 'Break-in'], ['windscreen', 'Windscreen'], ['third_party', 'Third party'], ['stock_in_transit', 'Stock in transit'], ['other', 'Other']]
const STATUSES: [InsuranceClaim['status'], string][] = [['reported', 'Reported internally'], ['documents_outstanding', 'Documents outstanding'], ['registered', 'Registered with insurer'], ['assessment', 'Assessment'], ['approved', 'Approved'], ['in_repair', 'In repair'], ['settled', 'Settled'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']]
const CLOSED: InsuranceClaim['status'][] = ['settled', 'rejected', 'withdrawn']
const label = (list: [string, string][], v: string) => list.find((x) => x[0] === v)?.[1] ?? v
const tone = (s: InsuranceClaim['status']) => (s === 'settled' ? 'green' : s === 'rejected' ? 'red' : s === 'withdrawn' ? 'slate' : s === 'documents_outstanding' || s === 'reported' ? 'amber' : s === 'approved' || s === 'in_repair' ? 'teal' : 'purple') as 'green' | 'red' | 'slate' | 'amber' | 'teal' | 'purple'
const days = (from: string | null, to?: string | null) => (from ? Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 86400000) : null)
const today = () => new Date().toISOString().slice(0, 10)
const BLANK = { vehicle_id: '', asset_desc: '', branch_id: '', incident_date: today(), incident_type: 'accident', location: '', driver_name: '', description: '', police_station: '', police_case_no: '', reported_internal: '', reported_insurer: '', insurer: '', policy_no: '', claim_no: '', handler: '', owner_name: '', status: 'reported', outstanding: '', quote_amount: '', excess_amount: '', settlement_amount: '', closed_date: '' }
type Form = typeof BLANK
const box = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-lilac focus:outline-none'

/** Insurance claims: one line per incident with its status, what is outstanding and a dated progress log. Admins manage claims; branch managers follow and update the claims of their branches. */
export default function Claims() {
  const { isAdmin } = useAuth(); const m = useMasters()
  const [rows, setRows] = useState<InsuranceClaim[] | null>(null); const [showClosed, setShowClosed] = useState(false); const [branch, setBranch] = useState<number | ''>('')
  const [openId, setOpenId] = useState<number | null>(null); const [edit, setEdit] = useState<{ id: number | null; f: Form } | null>(null)
  const [note, setNote] = useState(''); const [noteDate, setNoteDate] = useState(today()); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const load = () => supabase.from('fleet_insurance_claims').select('*, fleet_insurance_claim_events(*)').order('incident_date', { ascending: false }).then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as InsuranceClaim[]) })
  useEffect(() => { void load() }, [])
  const veh = (id: number | null) => (id ? m.vehicles.find((v) => v.id === id) : undefined)
  const what = (c: InsuranceClaim) => { const v = veh(c.vehicle_id); return v ? `${v.registration} · ${v.make ?? ''} ${v.model ?? ''}`.trim() : c.asset_desc || 'Unspecified asset' }
  const shown = useMemo(() => (rows ?? []).filter((c) => (showClosed || !CLOSED.includes(c.status)) && (branch === '' || c.branch_id === branch)), [rows, showClosed, branch])
  const open = rows?.find((c) => c.id === openId) ?? null
  const events = (c: InsuranceClaim): InsuranceClaimEvent[] => [...(c.fleet_insurance_claim_events ?? [])].sort((a, b) => a.event_date.localeCompare(b.event_date) || a.created_at.localeCompare(b.created_at))
  const lastEvent = (c: InsuranceClaim) => events(c).at(-1)

  async function addNote(c: InsuranceClaim) {
    if (!note.trim()) return
    setBusy(true); setErr(null)
    const { error } = await supabase.from('fleet_insurance_claim_events').insert({ claim_id: c.id, event_date: noteDate || today(), body: note.trim() })
    setBusy(false); if (error) { setErr(error.message); return } setNote(''); setNoteDate(today()); await load()
  }
  async function setStatus(c: InsuranceClaim, status: InsuranceClaim['status']) {
    setBusy(true); setErr(null)
    const { error } = await supabase.from('fleet_insurance_claims').update({ status, closed_date: CLOSED.includes(status) ? c.closed_date ?? today() : null, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (!error) await supabase.from('fleet_insurance_claim_events').insert({ claim_id: c.id, event_date: today(), body: `Status changed to "${label(STATUSES, status)}".` })
    setBusy(false); if (error) { setErr(error.message); return } await load()
  }
  const startEdit = (c: InsuranceClaim | null) => setEdit({ id: c?.id ?? null, f: c ? (Object.fromEntries(Object.keys(BLANK).map((k) => [k, (c as unknown as Record<string, unknown>)[k] == null ? '' : String((c as unknown as Record<string, unknown>)[k])])) as Form) : { ...BLANK } })
  async function save() {
    if (!edit) return
    const f = edit.f; if (!f.incident_date || (!f.vehicle_id && !f.asset_desc.trim())) { setErr('Give the incident date and either a vehicle or a description of the asset.'); return }
    setBusy(true); setErr(null)
    const n = (s: string) => (s.trim() === '' ? null : Number(s)); const t = (s: string) => (s.trim() === '' ? null : s.trim())
    const v = veh(f.vehicle_id ? Number(f.vehicle_id) : null)
    const row = { vehicle_id: n(f.vehicle_id), asset_desc: t(f.asset_desc), branch_id: n(f.branch_id) ?? v?.branch_id ?? null, incident_date: f.incident_date, incident_type: f.incident_type, location: t(f.location), driver_name: t(f.driver_name), description: t(f.description), police_station: t(f.police_station), police_case_no: t(f.police_case_no),
      reported_internal: t(f.reported_internal), reported_insurer: t(f.reported_insurer), insurer: t(f.insurer), policy_no: t(f.policy_no), claim_no: t(f.claim_no), handler: t(f.handler), owner_name: t(f.owner_name), status: f.status, outstanding: t(f.outstanding),
      quote_amount: n(f.quote_amount), excess_amount: n(f.excess_amount), settlement_amount: n(f.settlement_amount), closed_date: t(f.closed_date), updated_at: new Date().toISOString() }
    const { error } = edit.id ? await supabase.from('fleet_insurance_claims').update(row).eq('id', edit.id) : await supabase.from('fleet_insurance_claims').insert(row)
    setBusy(false); if (error) { setErr(error.message); return } setEdit(null); await load()
  }
  function exportXlsx() {
    downloadWorkbook([{ name: 'Insurance claims', widths: [12, 14, 34, 8, 14, 22, 40, 12, 12, 9, 14, 12, 12, 12, 60], rows: [['Incident', 'Type', 'Vehicle / asset', 'Branch', 'Claim no', 'Status', 'Outstanding / next action', 'To insurer', 'Closed', 'Days open', 'Quote', 'Excess', 'Settlement', 'Last update', 'Last update note'],
      ...shown.map((c) => { const l = lastEvent(c); return [c.incident_date, label(TYPES, c.incident_type), what(c), c.branch_id ? m.bm.code(c.branch_id) : '', c.claim_no ?? '', label(STATUSES, c.status), c.outstanding ?? '', c.reported_insurer ?? '', c.closed_date ?? '', days(c.incident_date, c.closed_date), c.quote_amount, c.excess_amount, c.settlement_amount, l?.event_date ?? '', l?.body ?? ''] })] }], 'Insurance claims.xlsx')
  }
  const fld = (k: keyof Form, lbl: string, type = 'text') => <Field label={lbl}><Input type={type} value={edit!.f[k]} onChange={(e) => setEdit({ ...edit!, f: { ...edit!.f, [k]: e.target.value } })} /></Field>
  if (!rows || m.loading) return <Page title="Insurance claims"><Spinner /></Page>
  const live = rows.filter((c) => !CLOSED.includes(c.status)); const stale = live.filter((c) => (days(lastEvent(c)?.event_date ?? c.incident_date) ?? 0) > 14)

  return (
    <Page title="Insurance claims" subtitle="Every incident and insurance claim, with its status, what is still outstanding and a dated progress log."
      actions={<>{isAdmin && <Button size="sm" onClick={() => startEdit(null)}>New claim</Button>}<Button variant="secondary" size="sm" onClick={exportXlsx} disabled={!shown.length}>Export to Excel</Button></>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Open claims" value={live.length} tone="purple" />
        <Stat label="Documents outstanding" value={live.filter((c) => c.status === 'documents_outstanding' || c.status === 'reported').length} tone="pink" />
        <Stat label="No update for 14+ days" value={stale.length} tone="navy" />
        <Stat label="Settled" value={`R ${money(rows.filter((c) => c.status === 'settled').reduce((a, c) => a + Number(c.settlement_amount || 0), 0))}`} sub={`${rows.filter((c) => c.status === 'settled').length} claim(s)`} tone="teal" />
      </div>
      <Card title="Claims" actions={<div className="flex items-center gap-3"><Select value={branch} onChange={(e) => setBranch(e.target.value ? Number(e.target.value) : '')}><option value="">All branches</option>{m.branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select><label className="text-xs text-slate-500"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show closed</label></div>}>
        {err && !edit && !open && <p className="mb-2 text-xs text-red-600">{err}</p>}
        {shown.length === 0 ? <Empty>No {showClosed ? '' : 'open '}claims.</Empty> : (
          <Table head={['Incident', 'Vehicle / asset', 'Branch', 'Type', 'Status', 'Outstanding / next action', 'Claim no', 'Days open', 'Quote', 'Last update', '']}>
            {shown.map((c) => { const l = lastEvent(c); const quiet = !CLOSED.includes(c.status) && (days(l?.event_date ?? c.incident_date) ?? 0) > 14; return (
              <tr key={c.id} className="cursor-pointer align-top hover:bg-brand-card" onClick={() => { setOpenId(c.id); setErr(null) }}>
                <Td className="whitespace-nowrap">{fmtDate(c.incident_date)}</Td>
                <Td><span className="font-medium text-brand-navy">{what(c)}</span>{c.driver_name && <div className="text-xs text-slate-500">{c.driver_name}</div>}</Td>
                <Td>{c.branch_id ? m.bm.code(c.branch_id) : ''}</Td>
                <Td>{label(TYPES, c.incident_type)}</Td>
                <Td><Badge tone={tone(c.status)}>{label(STATUSES, c.status)}</Badge></Td>
                <Td className="max-w-xs text-xs">{c.outstanding}</Td>
                <Td className="whitespace-nowrap">{c.claim_no ?? <span className="text-slate-400">none yet</span>}</Td>
                <Td num>{days(c.incident_date, c.closed_date)}</Td>
                <Td num><Money v={c.quote_amount} /></Td>
                <Td className={`whitespace-nowrap text-xs ${quiet ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{l ? fmtDate(l.event_date) : '—'}{quiet ? ' · quiet' : ''}</Td>
                <Td><span className="text-xs text-brand-purple">open</span></Td>
              </tr>) })}
          </Table>
        )}
      </Card>

      {open && (
        <Modal title={`${label(TYPES, open.incident_type)} — ${what(open)}`} onClose={() => setOpenId(null)} wide>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(open.status)}>{label(STATUSES, open.status)}</Badge><span className="text-xs text-slate-500">incident {fmtDate(open.incident_date)} · {days(open.incident_date, open.closed_date)} days {CLOSED.includes(open.status) ? 'to close' : 'open'}</span>
              {isAdmin && <span className="ml-auto flex items-center gap-2"><Select value={open.status} disabled={busy} onChange={(e) => void setStatus(open, e.target.value as InsuranceClaim['status'])}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select><Button size="sm" variant="secondary" onClick={() => { startEdit(open); setOpenId(null) }}>Edit details</Button></span>}</div>
            {open.outstanding && <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2"><b>Outstanding / next action:</b> {open.outstanding}</div>}
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {([['Location', open.location], ['Driver / occupants', open.driver_name], ['Police', [open.police_station, open.police_case_no].filter(Boolean).join(' · ')], ['Reported to head office', fmtDate(open.reported_internal)], ['Lodged with insurer', fmtDate(open.reported_insurer)], ['Insurer / policy', [open.insurer, open.policy_no].filter(Boolean).join(' · ')], ['Claim number', open.claim_no], ['Claims handler', open.handler], ['Our owner', open.owner_name],
                ['Quote', open.quote_amount != null ? `R ${money(Number(open.quote_amount))}` : ''], ['Excess', open.excess_amount != null ? `R ${money(Number(open.excess_amount))}` : ''], ['Settlement', open.settlement_amount != null ? `R ${money(Number(open.settlement_amount))}` : '']] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-40 shrink-0 text-slate-500">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            {open.description && <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2">{open.description}</p>}
            <h4 className="font-display font-semibold text-brand-navy">Progress</h4>
            <ul className="space-y-2">{events(open).map((e) => <li key={e.id} className="rounded-md border border-slate-200 px-3 py-2"><div className="mb-0.5 text-xs text-slate-500"><b className="text-slate-700">{fmtDate(e.event_date)}</b>{e.author_name ? ` · ${e.author_name}` : ''}</div><div className="whitespace-pre-wrap">{e.body}</div></li>)}{events(open).length === 0 && <li className="text-slate-500">No updates yet.</li>}</ul>
            <div className="space-y-2"><textarea className={box} rows={2} placeholder="Add a progress update…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2"><Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className="w-40" /><Button size="sm" disabled={busy || !note.trim()} onClick={() => void addNote(open)}>Add update</Button>{err && <span className="text-xs text-red-600">{err}</span>}</div></div>
          </div>
        </Modal>
      )}

      {edit && (
        <Modal title={edit.id ? 'Edit claim' : 'New claim'} onClose={() => setEdit(null)} wide>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Vehicle"><Select value={edit.f.vehicle_id} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, vehicle_id: e.target.value } })}><option value="">— not a vehicle —</option>{m.vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration} {v.make} {v.model}</option>)}</Select></Field>
            {fld('asset_desc', 'Other asset (if not a vehicle)')}
            <Field label="Branch" hint="Blank = the vehicle's branch"><Select value={edit.f.branch_id} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, branch_id: e.target.value } })}><option value="">—</option>{m.branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select></Field>
            {fld('incident_date', 'Incident date', 'date')}
            <Field label="Type"><Select value={edit.f.incident_type} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, incident_type: e.target.value } })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Status"><Select value={edit.f.status} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, status: e.target.value } })}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            {fld('location', 'Location')}{fld('driver_name', 'Driver / occupants')}{fld('owner_name', 'Our owner')}
            {fld('police_station', 'Police station')}{fld('police_case_no', 'Case number')}{fld('reported_internal', 'Reported to head office', 'date')}
            {fld('reported_insurer', 'Lodged with insurer', 'date')}{fld('insurer', 'Insurer / broker')}{fld('policy_no', 'Policy number')}
            {fld('claim_no', 'Claim number')}{fld('handler', 'Claims handler')}{fld('closed_date', 'Closed date', 'date')}
            {fld('quote_amount', 'Repair quote (R)', 'number')}{fld('excess_amount', 'Excess (R)', 'number')}{fld('settlement_amount', 'Settlement (R)', 'number')}
          </div>
          <div className="mt-3 space-y-3">
            <Field label="Outstanding / next action"><textarea className={box} rows={2} value={edit.f.outstanding} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, outstanding: e.target.value } })} /></Field>
            <Field label="What happened"><textarea className={box} rows={4} value={edit.f.description} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, description: e.target.value } })} /></Field>
            <div className="flex items-center gap-2"><Button disabled={busy} onClick={() => void save()}>Save</Button><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>{err && <span className="text-xs text-red-600">{err}</span>}</div>
          </div>
        </Modal>
      )}
    </Page>
  )
}
