import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import type { Copier, VehicleQuery } from '../lib/types'
import { money, num } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Select, Spinner, Empty, Stat, Input, Alert } from '../components/ui'
import { Modal, NewQuery, QueryThread, QUERY_SELECT, queryTone } from '../components/QueryThread'

const BUCKET = 'copier-photos'
const photoUrl = (path: string | null) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null)
const monthsLeft = (d: string | null) => (d ? Math.round((new Date(d).getTime() - Date.now()) / (30.44 * 86400000)) : null)
const endLabel = (c: Copier) => (c.month_to_month ? 'month to month' : c.contract_end ? new Date(c.contract_end + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : '—')

/** Shrinks a phone photo to at most 1280 px on the long side and re-encodes it as JPEG so uploads stay small. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height)); const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', 0.82))
  } finally { URL.revokeObjectURL(url) }
}

/** Copiers and printers: rented machines allocated to branches, with a photo per machine and the query workflow. Branch managers see their branches; admins see and edit everything. */
export default function Copiers() {
  const { isAdmin, hasBranches, canViewAll } = useAuth(); const m = useMasters()
  const [rows, setRows] = useState<Copier[] | null>(null); const [queries, setQueries] = useState<VehicleQuery[]>([]); const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState(''); const [branch, setBranch] = useState<number | ''>(''); const [showGone, setShowGone] = useState(false)
  const [qCopier, setQCopier] = useState<Copier | null>(null); const [newQ, setNewQ] = useState(false); const [view, setView] = useState<Copier | null>(null); const [busy, setBusy] = useState<number | null>(null)
  const [add, setAdd] = useState({ model: '', serial_no: '', location: '', branch_id: '', contract_end: '', month_to_month: false, rental_excl: '' })
  const load = () => Promise.all([
    supabase.rpc('fleet_my_copiers').then(({ data }) => setRows((data ?? []) as Copier[])),
    supabase.from('fleet_vehicle_queries').select(QUERY_SELECT).not('copier_id', 'is', null).order('updated_at', { ascending: false }).then(({ data }) => setQueries((data ?? []) as VehicleQuery[])),
  ])
  useEffect(() => { void load() }, [])
  const openFor = (id: number) => queries.filter((x) => x.copier_id === id && x.status !== 'closed')
  const branches = useMemo(() => { const s = new Map<number, string>(); for (const r of rows ?? []) if (r.branch_id) s.set(r.branch_id, `${m.bm.code(r.branch_id)} – ${m.bm.byId(r.branch_id)?.name ?? ''}`); return [...s.entries()].sort((a, b) => a[1].localeCompare(b[1])) }, [rows, m])
  const shown = (rows ?? []).filter((r) => (showGone || r.active) && (branch === '' || r.branch_id === branch) && (!q || `${r.model} ${r.serial_no} ${r.location ?? ''} ${m.bm.code(r.branch_id)}`.toLowerCase().includes(q.toLowerCase())))
  const rental = shown.reduce((s, r) => s + Number(r.rental_excl || 0), 0)
  const ending = shown.filter((r) => { const n = monthsLeft(r.contract_end); return r.active && n != null && n <= 6 })

  async function save(c: Copier, patch: Partial<Copier>) { setMsg(null); const { error } = await supabase.from('fleet_copiers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id); if (error) setMsg(error.message); else await load() }
  async function create() {
    if (!add.model.trim() || !add.serial_no.trim()) { setMsg('Model and serial number are required.'); return }
    const { error } = await supabase.from('fleet_copiers').insert({ model: add.model.trim(), serial_no: add.serial_no.trim().toUpperCase(), location: add.location.trim() || null, branch_id: add.branch_id ? Number(add.branch_id) : null, contract_end: add.month_to_month ? null : add.contract_end || null, month_to_month: add.month_to_month, rental_excl: Number(add.rental_excl) || 0 })
    if (error) { setMsg(error.message); return } setAdd({ ...add, model: '', serial_no: '', location: '', contract_end: '', rental_excl: '' }); await load()
  }
  async function upload(c: Copier, file: File) {
    setBusy(c.id); setMsg(null)
    try {
      const blob = await shrink(file); const path = `${c.id}/${Date.now()}.jpg`
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error
      const { error: e2 } = await supabase.rpc('fleet_copier_set_photo', { p_copier: c.id, p_path: path }); if (e2) throw e2
      if (c.photo_path) void supabase.storage.from(BUCKET).remove([c.photo_path])
      await load()
    } catch (e) { setMsg((e as Error).message) }
    setBusy(null)
  }
  function exportXlsx() {
    downloadWorkbook([{ name: 'Copiers', widths: [22, 22, 44, 8, 14, 12, 10, 10, 10, 30], rows: [['Model', 'Serial', 'Location', 'Branch', 'Contract end', 'Rental excl', 'Avg black', 'Avg colour', 'Photo', 'Notes'], ...shown.map((r) => [r.model, r.serial_no, r.location, m.bm.code(r.branch_id), endLabel(r), Number(r.rental_excl), r.avg_black, r.avg_colour, r.photo_path ? 'yes' : 'no', r.notes ?? ''])] }], 'Copiers.xlsx')
  }
  if (!isAdmin && !canViewAll && !hasBranches) return <Alert tone="amber">Copiers are shown per branch. Your login holds no branches in the Budget app; ask an administrator.</Alert>
  const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-brand-lilac focus:bg-white focus:outline-none'
  return (
    <Page title="Copiers & printers" subtitle={isAdmin ? 'Rented multifunction machines, allocated to branches. Click a field to edit; branch managers can add a photo and raise a query.' : 'The copiers allocated to your branches. Add a photo of each machine and raise a query if anything is wrong.'}
      actions={<Button variant="secondary" size="sm" onClick={exportXlsx} disabled={!shown.length}>Export to Excel</Button>}>
      {msg && <div className="mb-3"><Alert tone="red">{msg}</Alert></div>}
      {rows === null || m.loading ? <Spinner /> : rows.length === 0 ? <Empty>No copiers on file{isAdmin ? ' — add the first one below.' : ' for your branches.'}</Empty> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Copiers" value={shown.length} sub={`${branches.length} branch${branches.length === 1 ? '' : 'es'}`} />
            <Stat label="Monthly rental" value={`R ${money(rental)}`} sub="excl VAT" tone="purple" />
            <Stat label="Contracts ending" value={ending.length} sub="within 6 months" tone={ending.length ? 'pink' : 'teal'} />
            <Stat label="Without photo" value={shown.filter((r) => !r.photo_path).length} sub="ask the branch to add one" tone="teal" />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input placeholder="Search model, serial, address…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
            {branches.length > 1 && <Select value={branch} onChange={(e) => setBranch(e.target.value === '' ? '' : Number(e.target.value))}><option value="">All branches</option>{branches.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>}
            <label className="text-sm"><input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} /> include returned</label>
          </div>
          <Card>
            <Table head={['Photo', 'Model', 'Serial', 'Location', 'Branch', 'Contract end', 'Rental excl', 'Avg black', 'Avg colour', 'Query', isAdmin ? 'Status' : '']}>
              {shown.map((r) => { const n = monthsLeft(r.contract_end); const url = photoUrl(r.photo_path); const mine = isAdmin || (rows ?? []).some((x) => x.id === r.id)
                return (
                  <tr key={r.id} className={!r.active ? 'opacity-50' : 'hover:bg-brand-card'}>
                    <Td>
                      {url ? <button type="button" onClick={() => setView(r)} title={`Photo added ${r.photo_at?.slice(0, 10)} by ${r.photo_by}`}><img src={url} alt={r.model} className="h-12 w-16 rounded object-cover" /></button> : <span className="text-xs text-amber-700">no photo</span>}
                      {mine && r.active && <label className="mt-1 block cursor-pointer text-xs text-brand-purple hover:underline">{busy === r.id ? 'Uploading…' : url ? 'replace' : 'add photo'}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy === r.id} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(r, f); e.target.value = '' }} /></label>}
                    </Td>
                    <Td>{isAdmin ? <input className={cell} defaultValue={r.model} onBlur={(e) => e.target.value !== r.model && save(r, { model: e.target.value })} /> : <span className="font-medium">{r.model}</span>}</Td>
                    <Td className="text-xs">{isAdmin ? <input className={`${cell} w-40 text-xs`} defaultValue={r.serial_no} onBlur={(e) => e.target.value !== r.serial_no && save(r, { serial_no: e.target.value.toUpperCase() })} /> : r.serial_no}</Td>
                    <Td className="text-xs">{isAdmin ? <input className={`${cell} w-64 text-xs`} defaultValue={r.location ?? ''} onBlur={(e) => e.target.value !== (r.location ?? '') && save(r, { location: e.target.value || null })} /> : r.location}</Td>
                    <Td>{isAdmin ? <select className={cell} value={r.branch_id ?? ''} onChange={(e) => save(r, { branch_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select> : m.bm.code(r.branch_id)}</Td>
                    <Td className="whitespace-nowrap">
                      {isAdmin ? <span className="flex items-center gap-1"><input type="date" className={`${cell} w-32`} defaultValue={r.contract_end ?? ''} disabled={r.month_to_month} onBlur={(e) => (e.target.value || null) !== r.contract_end && save(r, { contract_end: e.target.value || null })} /><label className="text-[10px] text-slate-500"><input type="checkbox" checked={r.month_to_month} onChange={(e) => save(r, { month_to_month: e.target.checked, contract_end: e.target.checked ? null : r.contract_end })} /> m2m</label></span> : endLabel(r)}
                      {n != null && r.active && <div className={`text-[11px] ${n < 0 ? 'text-red-600' : n <= 6 ? 'text-amber-700' : 'text-slate-400'}`}>{n < 0 ? `expired ${-n} month${-n === 1 ? '' : 's'} ago` : `${n} month${n === 1 ? '' : 's'} left`}</div>}
                      {r.month_to_month && <div className="text-[11px] text-amber-700">no fixed term</div>}
                    </Td>
                    <Td num>{isAdmin ? <input className={`${cell} w-24 text-right`} defaultValue={r.rental_excl} onBlur={(e) => Number(e.target.value) !== Number(r.rental_excl) && save(r, { rental_excl: Number(e.target.value) || 0 })} /> : <Money v={Number(r.rental_excl)} />}</Td>
                    <Td num>{isAdmin ? <input className={`${cell} w-20 text-right`} defaultValue={r.avg_black ?? ''} onBlur={(e) => Number(e.target.value) !== (r.avg_black ?? 0) && save(r, { avg_black: Number(e.target.value) || null })} /> : num(r.avg_black)}</Td>
                    <Td num>{isAdmin ? <input className={`${cell} w-20 text-right`} defaultValue={r.avg_colour ?? ''} onBlur={(e) => Number(e.target.value) !== (r.avg_colour ?? 0) && save(r, { avg_colour: Number(e.target.value) || null })} /> : num(r.avg_colour)}</Td>
                    <Td><button type="button" className="whitespace-nowrap rounded-md border border-brand-purple/40 px-2 py-0.5 text-xs font-medium text-brand-purple hover:bg-brand-card" onClick={() => setQCopier(r)}>Query{openFor(r.id).length > 0 && <span className={`ml-1 rounded-full px-1.5 text-[10px] font-semibold ${openFor(r.id).some((x) => x.status === 'answered') ? 'bg-brand-teal text-brand-navy' : 'bg-amber-400 text-brand-navy'}`}>{openFor(r.id).length}</span>}</button></Td>
                    <Td>{isAdmin ? (r.active ? <button type="button" className="text-xs text-slate-500 hover:text-red-600 hover:underline" onClick={() => { const note = prompt('Returned / cancelled — note (date, reason):'); if (note != null) void save(r, { active: false, disposal_note: note || null }) }}>mark returned</button> : <span className="text-xs text-slate-500">returned{r.disposal_note ? ` · ${r.disposal_note}` : ''} <button type="button" className="text-brand-purple hover:underline" onClick={() => save(r, { active: true, disposal_note: null })}>undo</button></span>) : null}</Td>
                  </tr>
                )
              })}
              {shown.length > 0 && <tr className="bg-brand-card font-semibold"><Td>Total ({shown.length})</Td><Td /><Td /><Td /><Td /><Td /><Td num><Money v={rental} /></Td><Td num>{num(shown.reduce((s, r) => s + (r.avg_black ?? 0), 0))}</Td><Td num>{num(shown.reduce((s, r) => s + (r.avg_colour ?? 0), 0))}</Td><Td /><Td /></tr>}
            </Table>
          </Card>
        </>
      )}
      {isAdmin && (
        <Card title="Add copier" className="mt-4">
          <div className="flex flex-wrap items-end gap-2">
            <Input placeholder="Model" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} className="w-40" /><Input placeholder="Serial number" value={add.serial_no} onChange={(e) => setAdd({ ...add, serial_no: e.target.value })} className="w-44" />
            <Input placeholder="Location / address" value={add.location} onChange={(e) => setAdd({ ...add, location: e.target.value })} className="w-72" />
            <Select value={add.branch_id} onChange={(e) => setAdd({ ...add, branch_id: e.target.value })}><option value="">Branch</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select>
            <Input type="date" value={add.contract_end} disabled={add.month_to_month} onChange={(e) => setAdd({ ...add, contract_end: e.target.value })} /><label className="text-xs"><input type="checkbox" checked={add.month_to_month} onChange={(e) => setAdd({ ...add, month_to_month: e.target.checked })} /> month to month</label>
            <Input placeholder="Rental excl" value={add.rental_excl} onChange={(e) => setAdd({ ...add, rental_excl: e.target.value })} className="w-28" />
            <Button onClick={() => void create()}>Add</Button>
          </div>
        </Card>
      )}
      {view && photoUrl(view.photo_path) && (
        <Modal title={`${view.model} · ${view.serial_no}`} onClose={() => setView(null)} wide>
          <img src={photoUrl(view.photo_path)!} alt={view.model} className="max-h-[70vh] w-full rounded object-contain" />
          <p className="mt-2 text-xs text-slate-500">{view.location} · photo added {view.photo_at?.slice(0, 10)} by {view.photo_by}</p>
        </Modal>
      )}
      {qCopier && !newQ && (
        <Modal title={`Queries on ${qCopier.model} · ${qCopier.serial_no}`} onClose={() => setQCopier(null)} wide>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">{queries.filter((x) => x.copier_id === qCopier.id).length === 0 ? 'No queries on this copier yet.' : 'Queries on this copier, newest first.'}</span>
            <Button size="sm" onClick={() => setNewQ(true)}>New query</Button>
          </div>
          <div className="space-y-4">
            {queries.filter((x) => x.copier_id === qCopier.id).map((x) => (
              <div key={x.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2"><Badge tone={queryTone(x.status)}>{x.status}</Badge><span className="font-medium text-brand-navy">{x.subject}</span></div>
                <QueryThread q={x} onChange={() => void load()} />
              </div>
            ))}
          </div>
        </Modal>
      )}
      {qCopier && newQ && <NewQuery copierId={qCopier.id} label={`${qCopier.model} · ${qCopier.serial_no} (${m.bm.code(qCopier.branch_id)})`} onClose={() => setNewQ(false)} onSaved={() => { setNewQ(false); void load() }} />}
    </Page>
  )
}
