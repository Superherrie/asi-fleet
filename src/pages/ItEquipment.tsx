import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import { CATEGORIES, CELL_STATUSES, IT_CATEGORIES, IT_CONDITIONS, type CellContract, type ItAsset, type ItMove, type ItReturn, type Staff } from '../lib/types'
import { fmtDate, money, periodLabel } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Badge, Select, Input, Field, Spinner, Empty, Stat, Alert } from '../components/ui'
import { Modal } from '../components/QueryThread'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const statusTone = (s: ItAsset['status']) => (s === 'scrapped' ? 'red' : s === 'in_stock' ? 'amber' : 'green')
const statusLabel = (s: ItAsset['status']) => (s === 'scrapped' ? 'scrapped' : s === 'in_stock' ? 'in stock' : 'allocated')
const cellTone = (st: CellContract['status']) => (st === 'active' ? 'green' : st === 'cancelled' ? 'slate' : st === 'to_cancel' ? 'red' : 'amber')
const BUCKET = 'it-photos'
const newPhotoPath = (id: number, back: boolean) => `${id}/${back ? 'back-' : ''}${Date.now()}.jpg`
const photoUrl = (path: string | null) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null)
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

type Mode = 'add' | 'edit' | 'move' | 'scrap' | 'history' | 'return' | 'decide'
interface Ctx { assets: ItAsset[]; staff: Staff[]; returns: ItReturn[]; contracts: CellContract[]; holder: (id: number) => Staff | undefined; branchName: (id: number | null) => string; admin: boolean; me: Staff | null; reload: () => Promise<void> }

/** IT equipment: laptops, phones, screens and the like, allocated to a person or to a branch's stock. IT equipment administrators see and manage the whole register and approve returns; everyone else sees only their own devices, can add one and ask to return one. */
export default function ItEquipment() {
  const { canManageIt } = useAuth(); const m = useMasters()
  const [assets, setAssets] = useState<ItAsset[] | null>(null); const [staff, setStaff] = useState<Staff[]>([]); const [returns, setReturns] = useState<ItReturn[]>([]); const [contracts, setContracts] = useState<CellContract[]>([]); const [meId, setMeId] = useState<number | null | undefined>(undefined)
  const reload = async () => {
    const [a, s, r, cc] = await Promise.all([supabase.from('fleet_it_assets').select('*').order('id'), supabase.from('fleet_staff').select('*').order('full_name'), supabase.from('fleet_it_returns').select('*').order('requested_at', { ascending: false }), supabase.from('fleet_cell_contracts').select('*').order('cell_no')])
    setAssets((a.data ?? []) as ItAsset[]); setStaff((s.data ?? []) as Staff[]); setReturns((r.data ?? []) as ItReturn[]); setContracts((cc.data ?? []) as CellContract[])
  }
  useEffect(() => { void reload(); void supabase.rpc('fleet_my_staff').then(({ data }) => setMeId((data as number | null) ?? null)) }, [])
  const byId = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const ctx: Ctx = { assets: assets ?? [], staff, returns, contracts, holder: (id) => byId.get(id), branchName: (id) => m.branches.find((b) => b.id === id)?.name ?? '', admin: canManageIt, me: meId ? byId.get(meId) ?? null : null, reload }
  const pending = returns.filter((r) => r.status === 'pending').length
  if (assets === null || m.loading || meId === undefined) return <Page title="IT equipment"><Spinner /></Page>
  if (!canManageIt) return <Page title="IT equipment" subtitle="The company laptop, desktop, screens, cellphone, tablet, router or SIM card recorded against your name. Add anything that is missing. To hand a device back, ask to return it: an IT equipment administrator approves the return and it moves to branch stock."><Mine c={ctx} /></Page>
  return (
    <Page title="IT equipment" subtitle="Laptops, desktops, screens, cellphones, tablets, routers and SIM cards, and who holds each one. People record their own devices and ask to return them; you move devices between people and branch stock, approve returns and scrap devices. Scrapped devices stay on the register with the reason.">
      <nav className="mb-4 flex gap-1 border-b border-brand-hairline pb-2">
        <NavLink to="/it/register" className={tab}>Register</NavLink>
        <NavLink to="/it/returns" className={tab}>Returns{pending > 0 && <span className="ml-1 rounded-full bg-brand-pink px-1.5 text-xs font-semibold text-white">{pending}</span>}</NavLink>
        <NavLink to="/it/stock" className={tab}>In stock</NavLink><NavLink to="/it/leavers" className={tab}>Leavers</NavLink><NavLink to="/it/contracts" className={tab}>Cellphone contracts</NavLink><NavLink to="/it/mine" className={tab}>My equipment</NavLink>
      </nav>
      <Routes>
        <Route path="register" element={<Register c={ctx} />} />
        <Route path="returns" element={<Returns c={ctx} />} />
        <Route path="stock" element={<Stock c={ctx} />} />
        <Route path="leavers" element={<Leavers c={ctx} />} />
        <Route path="contracts" element={<Contracts c={ctx} />} />
        <Route path="mine" element={<Mine c={ctx} />} />
        <Route path="*" element={<Navigate to="/it/register" replace />} />
      </Routes>
    </Page>
  )
}

// ---------------------------------------------------------------- shared pieces
const pendingFor = (c: Ctx, assetId: number) => c.returns.find((r) => r.asset_id === assetId && r.status === 'pending')
function HolderCell({ c, id }: { c: Ctx; id: number }) { const h = c.holder(id); if (!h) return <Td>?</Td>; const cc = c.contracts.filter((x) => x.holder_id === id && x.status !== 'cancelled'); return <Td><div>{h.full_name}{h.kind === 'person' && h.status === 'left' && <Badge tone="red">left {h.left_period ?? ''}</Badge>}</div><div className="text-[11px] text-slate-500">{h.kind === 'stock' ? 'branch stock' : [h.emp_no, h.position, h.branch_code].filter(Boolean).join(' · ')}</div>{cc.map((x) => <div key={x.id} className="text-[11px] text-brand-purple">☎ {x.cell_no} · {x.contract_type ?? ''}{x.term_date ? ` · to ${fmtDate(x.term_date)}` : ''}</div>)}</Td> }
function HolderSelect({ c, value, onChange }: { c: Ctx; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState('')
  const opts = useMemo(() => c.staff.filter((s) => s.status === 'active' || s.kind === 'stock').filter((s) => !q || s.full_name.toLowerCase().includes(q.toLowerCase()) || (s.emp_no ?? '').includes(q))
    .sort((a, b) => (a.kind === b.kind ? a.full_name.localeCompare(b.full_name) : a.kind === 'stock' ? -1 : 1)), [c, q])
  return (
    <div className="space-y-1">
      <Input placeholder="Search by name or employee number" value={q} onChange={(e) => setQ(e.target.value)} />
      <Select value={value} onChange={(e) => onChange(e.target.value)} size={Math.min(8, Math.max(3, opts.length))}>{opts.map((s) => <option key={s.id} value={s.id}>{s.kind === 'stock' ? `📦 ${s.full_name}` : `${s.full_name}${s.emp_no ? ` (${s.emp_no})` : ''} · ${s.branch_code ?? ''}`}</option>)}</Select>
    </div>
  )
}
type Form = { category: string; description: string; serial_no: string; condition: string; issued_on: string; note: string }
const blankForm = (): Form => ({ category: 'Laptop', description: '', serial_no: '', condition: 'Used Device - good condition', issued_on: '', note: '' })
function DeviceFields({ f, set }: { f: Form; set: (k: keyof Form, v: string) => void }) {
  return (<>
    <Field label="Type"><Select value={f.category} onChange={(e) => set('category', e.target.value)}>{IT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
    <Field label="Make and model"><Input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. HP ProBook 450 G10" /></Field>
    <Field label="Serial number / IMEI"><Input value={f.serial_no} onChange={(e) => set('serial_no', e.target.value)} /></Field>
    <Field label="Condition"><Select value={f.condition} onChange={(e) => set('condition', e.target.value)}>{IT_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
    <Field label="Issued on"><Input type="date" value={f.issued_on} onChange={(e) => set('issued_on', e.target.value)} /></Field>
    <Field label="Note"><Input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
  </>)
}
/** add / edit / move / scrap / return / decide / history dialogs */
function Actions({ c, asset, mode, onClose }: { c: Ctx; asset: ItAsset | null; mode: Mode; onClose: () => void }) {
  const [f, setF] = useState<Form>(asset ? { category: asset.category, description: asset.description, serial_no: asset.serial_no ?? '', condition: asset.condition ?? 'Used Device - good condition', issued_on: asset.issued_on ?? '', note: asset.note ?? '' } : blankForm())
  const [holder, setHolder] = useState(String(asset?.holder_id ?? c.me?.id ?? '')); const [to, setTo] = useState(''); const [reason, setReason] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [hist, setHist] = useState<ItMove[] | null>(null)
  const set = (k: keyof Form, v: string) => setF({ ...f, [k]: v })
  useEffect(() => { if (mode === 'history' && asset) void supabase.from('fleet_it_moves').select('*').eq('asset_id', asset.id).order('at').then(({ data }) => setHist((data ?? []) as ItMove[])) }, [mode, asset])
  async function run(p: PromiseLike<{ error: { message: string } | null }>) { setBusy(true); const { error } = await p; setBusy(false); if (error) { setMsg(error.message); return } await c.reload(); onClose() }
  const req = asset ? pendingFor(c, asset.id) : undefined
  const title = { add: 'Add a device', edit: 'Edit device', move: 'Move device', scrap: asset?.status === 'scrapped' ? 'Restore device' : 'Scrap device', history: 'History', return: 'Return a device', decide: 'Process return request' }[mode]
  return (
    <Modal title={title} onClose={onClose}>
      {asset && mode !== 'add' && <p className="mb-3 text-sm text-slate-600">{asset.category}: <b>{asset.description}</b>{asset.serial_no ? ` · S/N ${asset.serial_no}` : ''} · held by {c.holder(asset.holder_id)?.full_name}</p>}
      {mode === 'add' && (<div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={c.admin ? 'Holder' : 'Holder (yourself)'}>{c.admin ? <HolderSelect c={c} value={holder} onChange={setHolder} /> : <Input value={c.me?.full_name ?? ''} disabled />}</Field></div>
        <DeviceFields f={f} set={set} />
      </div>)}
      {mode === 'edit' && <div className="grid gap-3 sm:grid-cols-2"><DeviceFields f={f} set={set} /></div>}
      {mode === 'move' && asset && (<div className="space-y-3"><Field label="New holder (a person or a branch's stock)"><HolderSelect c={c} value={holder} onChange={setHolder} /></Field><Field label="Note"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. replaced by new laptop, transferred on promotion" /></Field></div>)}
      {mode === 'scrap' && asset && <Field label={asset.status === 'scrapped' ? 'Note' : 'Reason for scrapping'}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={asset.status === 'scrapped' ? 'why it is back in use' : 'e.g. screen broken beyond repair, stolen (case no.), end of life'} /></Field>}
      {mode === 'return' && asset && (<div className="space-y-2"><p className="text-sm text-slate-600">An IT equipment administrator will check the device in and move it to branch stock. Until then it stays recorded against your name.</p><Field label="Note (where it is, who you handed it to)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. handed to Melela at the service desk on 30 Oct" /></Field></div>)}
      {mode === 'decide' && asset && req && (<div className="space-y-3">
        <Alert tone="blue">Requested by {req.requested_by_name} on {fmtDate(req.requested_at.slice(0, 10))}{req.note ? `: ${req.note}` : ''}</Alert>
        <Field label="On approval the device goes to" hint="Leave blank for the holder's branch stock"><HolderSelect c={c} value={to} onChange={setTo} /></Field>
        <Field label="Note"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>)}
      {mode === 'history' && (hist === null ? <Spinner /> : hist.length === 0 ? <Empty>No history.</Empty> : (
        <Table head={['When', 'Action', 'From', 'To', 'By', 'Note']}>{hist.map((h) => <tr key={h.id}><Td className="text-xs">{fmtDate(h.at.slice(0, 10))}</Td><Td>{h.action.replace('_', ' ')}</Td><Td>{h.from_holder ? c.holder(h.from_holder)?.full_name : ''}</Td><Td>{h.to_holder ? c.holder(h.to_holder)?.full_name : ''}</Td><Td>{h.by_name}</Td><Td className="text-xs">{h.note}</Td></tr>)}</Table>))}
      {msg && <div className="mt-3"><Alert tone="red">{msg}</Alert></div>}
      {mode !== 'history' && (
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
          {mode === 'add' && <Button disabled={busy || !holder} onClick={() => void run(supabase.rpc('fleet_it_add', { p_holder: Number(holder), p_category: f.category, p_description: f.description, p_serial: f.serial_no, p_condition: f.condition, p_issued: f.issued_on || null, p_note: f.note }))}>Add</Button>}
          {mode === 'edit' && asset && <Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_update', { p_asset: asset.id, p_category: f.category, p_description: f.description, p_serial: f.serial_no, p_condition: f.condition, p_issued: f.issued_on || null, p_note: f.note }))}>Save</Button>}
          {mode === 'move' && asset && <Button disabled={busy || !holder || Number(holder) === asset.holder_id} onClick={() => void run(supabase.rpc('fleet_it_move', { p_asset: asset.id, p_to: Number(holder), p_note: reason }))}>Move</Button>}
          {mode === 'return' && asset && <Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_request_return', { p_asset: asset.id, p_note: reason }))}>Ask to return</Button>}
          {mode === 'decide' && req && <><Button variant="danger" disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_decide_return', { p_return: req.id, p_approve: false, p_note: reason, p_to: null }))}>Reject</Button><Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_decide_return', { p_return: req.id, p_approve: true, p_note: reason, p_to: to ? Number(to) : null }))}>Approve return</Button></>}
          {mode === 'scrap' && asset && (asset.status === 'scrapped'
            ? <Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_restore', { p_asset: asset.id, p_note: reason }))}>Restore</Button>
            : <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void run(supabase.rpc('fleet_it_scrap', { p_asset: asset.id, p_reason: reason }))}>Scrap</Button>)}
        </div>
      )}
    </Modal>
  )
}

function AssetTable({ c, rows, onAct, showHolder = true }: { c: Ctx; rows: ItAsset[]; onAct: (a: ItAsset, mode: Mode) => void; showHolder?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null); const [view, setView] = useState<{ a: ItAsset; back: boolean } | null>(null); const [msg, setMsg] = useState<string | null>(null)
  async function upload(a: ItAsset, file: File, back: boolean) {
    setBusy(`${a.id}${back ? 'b' : 'f'}`); setMsg(null)
    try {
      const blob = await shrink(file); const path = newPhotoPath(a.id, back); const old = back ? a.photo2_path : a.photo_path
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error
      const { error: e2 } = await supabase.rpc(back ? 'fleet_it_set_photo2' : 'fleet_it_set_photo', { p_asset: a.id, p_path: path }); if (e2) throw e2
      if (old) void supabase.storage.from(BUCKET).remove([old])
      await c.reload()
    } catch (e) { setMsg((e as { message?: string })?.message ?? String(e)) } finally { setBusy(null) }
  }
  const slot = (a: ItAsset, back: boolean, mine: boolean) => { const path = back ? a.photo2_path : a.photo_path; const at = back ? a.photo2_at : a.photo_at; const by = back ? a.photo2_by : a.photo_by; const key = `${a.id}${back ? 'b' : 'f'}`
    return (<div className="inline-block w-16 align-top">
      {photoUrl(path) ? <button type="button" onClick={() => setView({ a, back })} title={`${back ? 'Back' : 'Front'} photo added ${at?.slice(0, 10)} by ${by}`}><img src={photoUrl(path)!} alt={a.description} className="h-10 w-14 rounded object-cover" /></button> : <span className="text-xs text-slate-300">{back ? 'no back' : 'none'}</span>}
      {mine && a.status !== 'scrapped' && <label className="mt-0.5 block cursor-pointer text-[11px] text-brand-purple hover:underline">{busy === key ? 'Uploading…' : path ? 'replace' : back ? 'add back' : 'add photo'}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy === key} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(a, f, back); e.currentTarget.value = '' }} /></label>}
    </div>) }
  async function cancel(r: ItReturn) { setMsg(null); const { error } = await supabase.rpc('fleet_it_cancel_return', { p_return: r.id }); if (error) { setMsg(error.message); return } await c.reload() }
  if (rows.length === 0) return <Empty>Nothing here.</Empty>
  return (<>
    {msg && <div className="mb-2"><Alert tone="red">{msg}</Alert></div>}
    {view && (
      <Modal title={`${view.a.category}: ${view.a.description} (${view.back ? 'back' : 'front'})`} onClose={() => setView(null)} wide>
        <img src={photoUrl(view.back ? view.a.photo2_path : view.a.photo_path)!} alt={view.a.description} className="max-h-[70vh] w-full rounded object-contain" />
        <p className="mt-2 text-xs text-slate-500">{view.a.serial_no ? `S/N ${view.a.serial_no} · ` : ''}photo added {(view.back ? view.a.photo2_at : view.a.photo_at)?.slice(0, 10)} by {view.back ? view.a.photo2_by : view.a.photo_by}</p>
      </Modal>
    )}
    <Table head={['Photos (front · back)', 'Type', 'Device', 'Serial', 'Condition', 'Issued', ...(showHolder ? ['Held by'] : []), 'Status', '']}>
      {rows.map((a) => { const own = a.holder_id === c.me?.id; const mine = c.admin || own; const req = pendingFor(c, a.id)
        return (
          <tr key={a.id} className={a.status === 'scrapped' ? 'text-slate-400' : 'hover:bg-brand-card'}>
            <Td className="whitespace-nowrap">{slot(a, false, mine)} {slot(a, true, mine)}</Td>
            <Td>{a.category}</Td>
            <Td><div>{a.description}</div>{a.note && <div className="text-[11px] text-amber-700">{a.note}</div>}{a.scrap_reason && <div className="text-[11px] text-red-700">Scrapped {fmtDate(a.scrapped_at?.slice(0, 10) ?? null)} by {a.scrapped_by}: {a.scrap_reason}</div>}</Td>
            <Td className="text-xs">{a.serial_no}</Td><Td className="text-xs">{a.condition}</Td><Td className="text-xs">{fmtDate(a.issued_on)}</Td>
            {showHolder && <HolderCell c={c} id={a.holder_id} />}
            <Td><Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>{req && <div className="mt-0.5"><Badge tone="purple">return requested</Badge></div>}</Td>
            <Td className="whitespace-nowrap text-xs">
              {mine && a.status !== 'scrapped' && <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'edit')}>edit</button>}
              {c.admin && a.status !== 'scrapped' && <> · <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'move')}>move</button></>}
              {c.admin && req && <> · <button type="button" className="text-brand-pink hover:underline" onClick={() => onAct(a, 'decide')}>process return</button></>}
              {c.admin && <> · <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'scrap')}>{a.status === 'scrapped' ? 'restore' : 'scrap'}</button></>}
              {!c.admin && own && a.status === 'allocated' && (req ? <> · <button type="button" className="text-slate-500 hover:underline" onClick={() => void cancel(req)}>cancel return</button></> : <> · <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'return')}>return</button></>)}
              {' · '}<button type="button" className="text-slate-500 hover:underline" onClick={() => onAct(a, 'history')}>history</button>
            </Td>
          </tr>)
      })}
    </Table>
  </>)
}
function useDialog(c: Ctx) {
  const [dlg, setDlg] = useState<{ asset: ItAsset | null; mode: Mode } | null>(null)
  const el = dlg ? <Actions c={c} asset={dlg.asset} mode={dlg.mode} onClose={() => setDlg(null)} /> : null
  return { el, open: (asset: ItAsset | null, mode: Mode) => setDlg({ asset, mode }) }
}

// ---------------------------------------------------------------- tabs
function Register({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  const [q, setQ] = useState(''); const [branch, setBranch] = useState(''); const [cat, setCat] = useState(''); const [status, setStatus] = useState<'live' | 'all' | 'scrapped'>('live')
  const rows = c.assets.filter((a) => { const h = c.holder(a.holder_id); const t = `${a.description} ${a.serial_no ?? ''} ${h?.full_name ?? ''} ${h?.emp_no ?? ''}`.toLowerCase()
    return (status === 'all' || (status === 'scrapped' ? a.status === 'scrapped' : a.status !== 'scrapped')) && (!cat || a.category === cat) && (!branch || String(h?.branch_id ?? '') === branch) && (!q || t.includes(q.toLowerCase())) })
  const live = c.assets.filter((a) => a.status !== 'scrapped')
  function exportAll() {
    downloadWorkbook([{ name: 'IT equipment', rows: [['Type', 'Device', 'Serial', 'Condition', 'Issued', 'Holder', 'Emp no', 'Position', 'Branch', 'Holder status', 'Device status', 'Return requested', 'Scrapped', 'Reason', 'Site (Jotform)', 'Note', 'Photo', 'Back photo'],
      ...rows.map((a) => { const h = c.holder(a.holder_id); return [a.category, a.description, a.serial_no, a.condition, a.issued_on, h?.full_name ?? null, h?.emp_no ?? null, h?.position ?? null, h?.branch_code ?? null, h?.kind === 'stock' ? 'stock' : h?.status ?? null, statusLabel(a.status), pendingFor(c, a.id) ? 'yes' : null, a.scrapped_at?.slice(0, 10) ?? null, a.scrap_reason, a.site, a.note, photoUrl(a.photo_path), photoUrl(a.photo2_path)] })], widths: [12, 34, 20, 26, 11, 28, 8, 20, 8, 10, 10, 10, 11, 30, 14, 40, 40, 40] }], `IT equipment ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4"><Stat label="Devices on the register" value={String(live.length)} sub={`${c.assets.length - live.length} scrapped`} /><Stat label="Allocated to people" value={String(live.filter((a) => a.status === 'allocated').length)} tone="teal" /><Stat label="In branch stock" value={String(live.filter((a) => a.status === 'in_stock').length)} tone="purple" /><Stat label="Held by leavers" value={String(live.filter((a) => c.holder(a.holder_id)?.status === 'left' && c.holder(a.holder_id)?.kind === 'person').length)} tone="pink" /></div>
      <Card title="Register" actions={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={exportAll}>Export</Button><Button size="sm" onClick={() => open(null, 'add')}>Add device</Button></div>}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Input placeholder="Search device, serial, name or employee number" value={q} onChange={(e) => setQ(e.target.value)} className="w-80" />
          <Select value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{c.staff.filter((s) => s.kind === 'stock').map((s) => <option key={s.id} value={String(s.branch_id)}>{c.branchName(s.branch_id)}</option>)}</Select>
          <Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All types</option>{IT_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="live">On the register</option><option value="scrapped">Scrapped</option><option value="all">All</option></Select>
          <span className="text-xs text-slate-500">{rows.length} devices</span>
        </div>
        <AssetTable c={c} rows={rows} onAct={open} />
      </Card>
      {el}
    </div>
  )
}
function Returns({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  const pend = c.returns.filter((r) => r.status === 'pending'); const done = c.returns.filter((r) => r.status !== 'pending').slice(0, 50)
  const assetOf = (r: ItReturn) => c.assets.find((a) => a.id === r.asset_id)
  return (
    <div className="space-y-3">
      <Card title={`Waiting for approval · ${pend.length}`}>
        {pend.length === 0 ? <Empty>No return requests waiting.</Empty> : (
          <Table head={['Requested', 'By', 'Device', 'Serial', 'Note', '']}>{pend.map((r) => { const a = assetOf(r); return <tr key={r.id} className="hover:bg-brand-card"><Td className="text-xs">{fmtDate(r.requested_at.slice(0, 10))}</Td><Td>{r.requested_by_name}<div className="text-[11px] text-slate-500">{r.requested_by ? c.holder(r.requested_by)?.branch_code : ''}</div></Td><Td>{a ? `${a.category}: ${a.description}` : '?'}</Td><Td className="text-xs">{a?.serial_no}</Td><Td className="text-xs">{r.note}</Td><Td>{a && <Button size="sm" onClick={() => open(a, 'decide')}>Process</Button>}</Td></tr> })}</Table>
        )}
      </Card>
      <Card title="Processed (latest 50)">
        {done.length === 0 ? <Empty>Nothing processed yet.</Empty> : (
          <Table head={['Requested', 'By', 'Device', 'Outcome', 'Decided', 'Note']}>{done.map((r) => { const a = assetOf(r); return <tr key={r.id}><Td className="text-xs">{fmtDate(r.requested_at.slice(0, 10))}</Td><Td>{r.requested_by_name}</Td><Td>{a ? `${a.category}: ${a.description}` : '?'}</Td><Td><Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'slate'}>{r.status}</Badge>{r.to_holder && <div className="text-[11px] text-slate-500">to {c.holder(r.to_holder)?.full_name}</div>}</Td><Td className="text-xs">{r.decided_by} {fmtDate(r.decided_at?.slice(0, 10) ?? null)}</Td><Td className="text-xs">{r.decision_note}</Td></tr> })}</Table>
        )}
      </Card>
      {el}
    </div>
  )
}
function Mine({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  if (!c.me) return <Alert tone="amber">Your login is not linked to a name on the staff list, so devices cannot be recorded against you. Ask an IT equipment administrator to link your e-mail address on the staff list.</Alert>
  const rows = c.assets.filter((a) => a.holder_id === c.me!.id)
  return (
    <div className="space-y-3">
      {c.contracts.filter((x) => x.holder_id === c.me!.id).length > 0 && (
        <Card title="Your cellphone contract">
          <Table head={['Number', 'Package', 'Device on contract', 'Contract ends', 'Upgrade due', 'Status']}>{c.contracts.filter((x) => x.holder_id === c.me!.id).map((x) => <tr key={x.id}><Td>{x.cell_no}</Td><Td>{x.contract_type}</Td><Td>{x.device}</Td><Td>{fmtDate(x.term_date)}</Td><Td>{fmtDate(x.upgrade_due)}</Td><Td><Badge tone={cellTone(x.status)}>{x.status.replace('_', ' ')}</Badge></Td></tr>)}</Table>
          <p className="mt-2 text-xs text-slate-500">If the number or the package is wrong, tell an IT equipment administrator.</p>
        </Card>
      )}
      <Card title={`Equipment held by ${c.me.full_name}`} actions={<Button size="sm" onClick={() => open(null, 'add')}>Add a device</Button>}>
        <p className="mb-3 text-sm text-slate-600">Record every company laptop, desktop, screen, cellphone, tablet, router or SIM card in your possession. When you hand something back, click <b>return</b>: it stays on your name until an IT equipment administrator approves the return.</p>
        <AssetTable c={c} rows={rows} onAct={open} showHolder={false} />
      </Card>
      {el}
    </div>
  )
}
function Stock({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  const stocks = c.staff.filter((s) => s.kind === 'stock').sort((a, b) => a.full_name.localeCompare(b.full_name))
  return (
    <div className="space-y-3">
      {stocks.map((s) => { const rows = c.assets.filter((a) => a.holder_id === s.id && a.status !== 'scrapped'); if (!rows.length) return null
        return <Card key={s.id} title={`${c.branchName(s.branch_id)} · ${rows.length} in stock`} actions={<Button size="sm" onClick={() => open(null, 'add')}>Add to stock</Button>}><AssetTable c={c} rows={rows} onAct={open} showHolder={false} /></Card> })}
      {el}
    </div>
  )
}
function Leavers({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  const rows = c.assets.filter((a) => a.status !== 'scrapped' && c.holder(a.holder_id)?.kind === 'person' && c.holder(a.holder_id)?.status === 'left').sort((a, b) => (c.holder(a.holder_id)?.full_name ?? '').localeCompare(c.holder(b.holder_id)?.full_name ?? ''))
  const people = new Set(rows.map((a) => a.holder_id))
  return (
    <div className="space-y-3">
      <Alert tone="amber">{people.size} people who are no longer on the payroll still have {rows.length} devices recorded against their names. Move each device to the person who has it now, to the branch&rsquo;s stock, or scrap it. The payroll master is refreshed after each month&rsquo;s payroll, so people who left this month appear here once that load is done.</Alert>
      <Card title="Devices held by leavers"><AssetTable c={c} rows={rows} onAct={open} /></Card>
      {el}
    </div>
  )
}

// ---------------------------------------------------------------- cellphone contracts (Vodacom master)
const CONTRACT_FIELDS: [keyof CellContract, string][] = [['cell_no', 'Cell number'], ['msisdn', 'MSISDN (as billed)'], ['subscriber_name', 'Subscriber name on Vodacom'], ['job_title', 'Job title'], ['contract_type', 'Package'], ['package_range', 'Package range for the role'], ['device_category', 'Standard device for the role'], ['device', 'Device on contract'], ['previous_device', 'Previous device'], ['sim_number', 'SIM number'], ['activation_date', 'Activated'], ['term_date', 'Contract ends'], ['upgrade_due', 'Upgrade due'], ['last_upgrade', 'Last upgrade'], ['note', 'Note']]
function ContractDialog({ c, row, onClose }: { c: Ctx; row: CellContract | null; onClose: () => void }) {
  const blank: Partial<CellContract> = { status: 'active', branch_code: null, category: null, holder_id: null }
  const [f, setF] = useState<Partial<CellContract>>(row ?? blank); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const set = (k: keyof CellContract, v: unknown) => setF({ ...f, [k]: v === '' ? null : v })
  function setHolder(v: string) { const h = c.holder(Number(v)); setF({ ...f, holder_id: v ? Number(v) : null, branch_code: h?.branch_code ?? f.branch_code ?? null, branch_id: h?.branch_id ?? f.branch_id ?? null, category: h?.category ?? f.category ?? null }) }
  async function save() {
    setBusy(true); const { id, created_at, updated_at, ...rest } = f as CellContract; void created_at; void updated_at
    const payload = { ...rest, msisdn: (rest.msisdn || (rest.cell_no ?? '').replace(/^0/, '') + '000').replace(/\D/g, ''), updated_at: new Date().toISOString() }
    if (!payload.msisdn) { setMsg('Enter the cell number'); setBusy(false); return }
    const { error } = id ? await supabase.from('fleet_cell_contracts').update(payload).eq('id', id) : await supabase.from('fleet_cell_contracts').insert({ ...payload, source: 'app' })
    setBusy(false); if (error) { setMsg(error.message); return } await c.reload(); onClose()
  }
  const isDate = (k: string) => /date|term|due|upgrade/.test(k)
  return (
    <Modal title={row ? `Contract ${row.cell_no ?? row.msisdn}` : 'Add a contract'} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3"><Field label="Holder (the person who has the number)" hint="The holder’s payroll branch and department decide where the monthly bill is posted; both update automatically with each payroll load">{f.holder_id && <div className="mb-1 text-xs text-slate-600">{c.holder(f.holder_id)?.full_name} <button type="button" className="ml-2 text-brand-purple hover:underline" onClick={() => setF({ ...f, holder_id: null })}>clear (pool number)</button></div>}<HolderSelect c={c} value={String(f.holder_id ?? '')} onChange={setHolder} /></Field></div>
        <Field label="Branch (cost centre)" hint={f.holder_id ? 'From the payroll record of the holder' : 'Only for numbers without a person (tablets, office data SIMs)'}><Select value={f.branch_code ?? ''} disabled={!!f.holder_id} onChange={(e) => { const code = e.target.value; setF({ ...f, branch_code: code || null, branch_id: c.staff.find((s) => s.kind === 'stock' && s.branch_code === code)?.branch_id ?? null }) }}><option value="">—</option>{c.staff.filter((s) => s.kind === 'stock').map((s) => <option key={s.id} value={s.branch_code ?? ''}>{s.branch_code} · {c.branchName(s.branch_id)}</option>)}</Select></Field>
        <Field label="Category (GL)" hint={f.holder_id ? 'The holder’s payroll department drives the account' : undefined}><Select value={f.category ?? ''} disabled={!!f.holder_id} onChange={(e) => set('category', e.target.value)}><option value="">—</option>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Line type" hint="Data SIMs post to the data account"><Select value={f.line_type ?? 'voice'} onChange={(e) => set('line_type', e.target.value)}><option value="voice">voice</option><option value="data">data SIM</option></Select></Field>
        <Field label="Status"><Select value={f.status ?? 'active'} onChange={(e) => set('status', e.target.value)}>{CELL_STATUSES.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></Field>
        {CONTRACT_FIELDS.map(([k, label]) => <Field key={k} label={label}><Input type={isDate(k) ? 'date' : 'text'} value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value)} /></Field>)}
      </div>
      {msg && <div className="mt-3"><Alert tone="red">{msg}</Alert></div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></div>
    </Modal>
  )
}
function Contracts({ c }: { c: Ctx }) {
  const [q, setQ] = useState(''); const [branch, setBranch] = useState(''); const [status, setStatus] = useState(''); const [dlg, setDlg] = useState<{ row: CellContract | null } | null>(null)
  const [last, setLast] = useState<Map<number, { period: string; total: number }>>(new Map())   // latest Vodacom bill line per contract
  useEffect(() => { void supabase.from('fleet_cell_bill_lines').select('contract_id,period,total').not('contract_id', 'is', null).order('period', { ascending: false }).then(({ data }) => {
    const m = new Map<number, { period: string; total: number }>(); for (const l of (data ?? []) as { contract_id: number; period: string; total: number }[]) if (!m.has(l.contract_id)) m.set(l.contract_id, { period: l.period, total: Number(l.total) }); setLast(m) }) }, [c.contracts])
  const latest = [...last.values()].reduce((p, l) => (l.period > p ? l.period : p), '')
  const rows = c.contracts.filter((x) => { const h = x.holder_id ? c.holder(x.holder_id) : undefined; const t = `${x.cell_no ?? ''} ${x.msisdn} ${x.subscriber_name ?? ''} ${h?.full_name ?? ''} ${x.contract_type ?? ''} ${x.device ?? ''}`.toLowerCase()
    return (!status || x.status === status) && (!branch || (x.branch_code ?? '') === branch) && (!q || t.includes(q.toLowerCase())) })
  const live = c.contracts.filter((x) => x.status !== 'cancelled'); const soon = live.filter((x) => x.upgrade_due && x.upgrade_due <= SOON)
  function exportAll() {
    downloadWorkbook([{ name: 'Cellphone contracts', rows: [['Cell no', 'MSISDN', 'Holder', 'Emp no', 'Subscriber name (Vodacom)', 'Branch', 'Category', 'Job title', 'Package', 'Device', 'Contract ends', 'Upgrade due', 'Last upgrade', 'Last bill (incl VAT)', 'Bill period', 'Status', 'Note'],
      ...rows.map((x) => { const h = x.holder_id ? c.holder(x.holder_id) : undefined; const l = last.get(x.id); return [x.cell_no, x.msisdn, h?.full_name ?? null, h?.emp_no ?? null, x.subscriber_name, x.branch_code, x.category, x.job_title, x.contract_type, x.device, x.term_date, x.upgrade_due, x.last_upgrade, l?.total ?? null, l?.period ?? null, x.status, x.note] })], widths: [12, 14, 28, 8, 30, 8, 12, 22, 28, 22, 12, 12, 12, 14, 10, 10, 50] }], `Cellphone contracts ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5"><Stat label="Numbers on the master" value={String(live.length)} sub={`${c.contracts.length - live.length} cancelled`} /><Stat label="Linked to a person" value={String(live.filter((x) => x.holder_id).length)} tone="teal" /><Stat label="Unclaimed or unassigned" value={String(live.filter((x) => x.status === 'unclaimed' || x.status === 'unassigned').length)} sub="numbers still billed with nobody on them" tone="pink" /><Stat label="Upgrade due within 90 days" value={String(soon.length)} tone="purple" /><Stat label={latest ? `Vodacom bill ${periodLabel(latest)}` : 'Vodacom bill'} value={money([...last.values()].filter((l) => l.period === latest).reduce((s, l) => s + l.total, 0))} sub="incl VAT, numbers on the list" /></div>
      <Card title="Cellphone contracts (Vodacom master)" actions={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={exportAll}>Export</Button><Button size="sm" onClick={() => setDlg({ row: null })}>Add contract</Button></div>}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Input placeholder="Search number, name, package or device" value={q} onChange={(e) => setQ(e.target.value)} className="w-80" />
          <Select value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{[...new Set(c.contracts.map((x) => x.branch_code).filter(Boolean))].sort().map((b) => <option key={b!} value={b!}>{b}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{CELL_STATUSES.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
          <span className="text-xs text-slate-500">{rows.length} numbers</span>
        </div>
        {rows.length === 0 ? <Empty>Nothing here.</Empty> : (
          <Table head={['Number', 'Holder', 'Branch · category', 'Package', 'Device', 'Ends', 'Upgrade due', latest ? `Last bill (${periodLabel(latest)})` : 'Last bill', 'Status', '']}>
            {rows.map((x) => { const h = x.holder_id ? c.holder(x.holder_id) : undefined; const a = x.asset_id ? c.assets.find((y) => y.id === x.asset_id) : undefined
              return <tr key={x.id} className="hover:bg-brand-card"><Td><div>{x.cell_no}</div><div className="text-[11px] text-slate-500">{x.msisdn}</div></Td>
                <Td>{h ? <><div>{h.full_name}{h.status === 'left' && <Badge tone="red">left {h.left_period ?? ''}</Badge>}</div><div className="text-[11px] text-slate-500">{[h.emp_no, h.position].filter(Boolean).join(' · ')}</div></> : <span className="text-slate-500">{x.subscriber_name}</span>}{h && x.subscriber_name && nkName(x.subscriber_name) !== nkName(h.full_name) && <div className="text-[11px] text-slate-400">Vodacom: {x.subscriber_name}</div>}</Td>
                <Td className="text-xs">{x.branch_code ?? '—'}{x.category ? ` · ${x.category}` : ''}</Td><Td className="text-xs">{x.contract_type}</Td><Td className="text-xs">{x.device}{a && <div className="text-brand-purple">on register: {a.description}</div>}</Td>
                <Td className="text-xs">{fmtDate(x.term_date)}</Td><Td className="text-xs">{fmtDate(x.upgrade_due)}</Td>
                <Td className="text-right text-xs">{(() => { const l = last.get(x.id); if (!l) return <span className="text-slate-400">not billed</span>; return <><div>{money(l.total)}</div>{l.period !== latest && <div className="text-[11px] text-amber-700">last {periodLabel(l.period)}</div>}</> })()}</Td><Td><Badge tone={cellTone(x.status)}>{x.status.replace('_', ' ')}</Badge>{x.note && <div className="max-w-[16rem] text-[11px] text-amber-700">{x.note}</div>}</Td>
                <Td className="text-xs"><button type="button" className="text-brand-purple hover:underline" onClick={() => setDlg({ row: x })}>edit</button></Td></tr> })}
          </Table>
        )}
      </Card>
      {dlg && <ContractDialog c={c} row={dlg.row} onClose={() => setDlg(null)} />}
    </div>
  )
}
const SOON = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
const nkName = (s: string) => s.toLowerCase().replace(/\s*[-.]\s*[a-z]{2,4}\s*$/, '').replace(/[^a-z]/g, '')
