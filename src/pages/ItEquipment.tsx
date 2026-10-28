import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import { IT_CATEGORIES, IT_CONDITIONS, type ItAsset, type ItMove, type Staff } from '../lib/types'
import { fmtDate } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Badge, Select, Input, Field, Spinner, Empty, Stat, Alert } from '../components/ui'
import { Modal } from '../components/QueryThread'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`
const statusTone = (s: ItAsset['status']) => (s === 'scrapped' ? 'red' : s === 'in_stock' ? 'amber' : 'green')
const statusLabel = (s: ItAsset['status']) => (s === 'scrapped' ? 'scrapped' : s === 'in_stock' ? 'in stock' : 'allocated')
const BUCKET = 'it-photos'
const newPhotoPath = (id: number) => `${id}/${Date.now()}.jpg`
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

interface Ctx { assets: ItAsset[]; staff: Staff[]; holder: (id: number) => Staff | undefined; branchName: (id: number | null) => string; isAdmin: boolean; myBranches: Set<number>; me: Staff | null; reload: () => Promise<void> }

/** IT equipment: laptops, phones, screens and the like, allocated to a person or to a branch's stock. Everyone sees the register and may add devices to themselves; branch managers manage their branches; fleet admins manage everything. */
export default function ItEquipment() {
  const { isAdmin } = useAuth(); const m = useMasters()
  const [assets, setAssets] = useState<ItAsset[] | null>(null); const [staff, setStaff] = useState<Staff[]>([]); const [myBranches, setMyBranches] = useState<Set<number>>(new Set()); const [meId, setMeId] = useState<number | null>(null)
  const reload = async () => {
    const [a, s] = await Promise.all([supabase.from('fleet_it_assets').select('*').order('id'), supabase.from('fleet_staff').select('*').order('full_name')])
    setAssets((a.data ?? []) as ItAsset[]); setStaff((s.data ?? []) as Staff[])
  }
  useEffect(() => { void reload(); void supabase.rpc('fleet_my_branches').then(({ data }) => setMyBranches(new Set((data ?? []) as number[]))); void supabase.rpc('fleet_my_staff').then(({ data }) => setMeId((data as number | null) ?? null)) }, [])
  const byId = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const ctx: Ctx = { assets: assets ?? [], staff, holder: (id) => byId.get(id), branchName: (id) => m.branches.find((b) => b.id === id)?.name ?? '', isAdmin, myBranches, me: meId ? byId.get(meId) ?? null : null, reload }
  return (
    <Page title="IT equipment" subtitle="Laptops, desktops, screens, cellphones, tablets, routers and SIM cards, and who holds each one. People add their own devices and hand them in to branch stock; branch managers move devices within their branches; fleet administrators manage everything. Scrapped devices stay on the register with the reason.">
      <nav className="mb-4 flex gap-1 border-b border-brand-hairline pb-2"><NavLink to="/it/register" className={tab}>Register</NavLink><NavLink to="/it/mine" className={tab}>My equipment</NavLink><NavLink to="/it/stock" className={tab}>In stock</NavLink><NavLink to="/it/leavers" className={tab}>Leavers</NavLink></nav>
      {assets === null || m.loading ? <Spinner /> : (
        <Routes>
          <Route path="register" element={<Register c={ctx} />} />
          <Route path="mine" element={<Mine c={ctx} />} />
          <Route path="stock" element={<Stock c={ctx} />} />
          <Route path="leavers" element={<Leavers c={ctx} />} />
          <Route path="*" element={<Navigate to="/it/register" replace />} />
        </Routes>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------- shared pieces
function canManage(c: Ctx, holderId: number) { const h = c.holder(holderId); return c.isAdmin || (!!h?.branch_id && c.myBranches.has(h.branch_id)) || holderId === c.me?.id }
function HolderCell({ c, id }: { c: Ctx; id: number }) { const h = c.holder(id); if (!h) return <Td>?</Td>; return <Td><div>{h.full_name}{h.kind === 'person' && h.status === 'left' && <Badge tone="red">left {h.left_period ?? ''}</Badge>}</div><div className="text-[11px] text-slate-500">{h.kind === 'stock' ? 'branch stock' : [h.emp_no, h.position, h.branch_code].filter(Boolean).join(' · ')}</div></Td> }
function HolderSelect({ c, value, onChange, stockOnly = false }: { c: Ctx; value: string; onChange: (v: string) => void; stockOnly?: boolean }) {
  const [q, setQ] = useState('')
  const opts = useMemo(() => c.staff.filter((s) => (stockOnly ? s.kind === 'stock' : s.status === 'active' || s.kind === 'stock') && (c.isAdmin || (s.branch_id != null && c.myBranches.has(s.branch_id)) || s.id === c.me?.id || (stockOnly && s.branch_id === c.me?.branch_id)))
    .filter((s) => !q || s.full_name.toLowerCase().includes(q.toLowerCase()) || (s.emp_no ?? '').includes(q)).sort((a, b) => (a.kind === b.kind ? a.full_name.localeCompare(b.full_name) : a.kind === 'stock' ? -1 : 1)), [c, q, stockOnly])
  return (
    <div className="space-y-1">
      {!stockOnly && <Input placeholder="Search by name or employee number" value={q} onChange={(e) => setQ(e.target.value)} />}
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
/** add / edit / move / scrap dialogs */
function Actions({ c, asset, mode, onClose }: { c: Ctx; asset: ItAsset | null; mode: 'add' | 'edit' | 'move' | 'scrap' | 'history'; onClose: () => void }) {
  const [f, setF] = useState<Form>(asset ? { category: asset.category, description: asset.description, serial_no: asset.serial_no ?? '', condition: asset.condition ?? 'Used Device - good condition', issued_on: asset.issued_on ?? '', note: asset.note ?? '' } : blankForm())
  const [holder, setHolder] = useState(String(asset?.holder_id ?? c.me?.id ?? '')); const [reason, setReason] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [hist, setHist] = useState<ItMove[] | null>(null)
  const set = (k: keyof Form, v: string) => setF({ ...f, [k]: v })
  useEffect(() => { if (mode === 'history' && asset) void supabase.from('fleet_it_moves').select('*').eq('asset_id', asset.id).order('at').then(({ data }) => setHist((data ?? []) as ItMove[])) }, [mode, asset])
  async function run(p: PromiseLike<{ error: { message: string } | null }>) { setBusy(true); const { error } = await p; setBusy(false); if (error) { setMsg(error.message); return } await c.reload(); onClose() }
  const ownOnly = !c.isAdmin && c.myBranches.size === 0
  const title = { add: 'Add a device', edit: 'Edit device', move: 'Move device', scrap: asset?.status === 'scrapped' ? 'Restore device' : 'Scrap device', history: 'History' }[mode]
  return (
    <Modal title={title} onClose={onClose}>
      {asset && mode !== 'add' && <p className="mb-3 text-sm text-slate-600">{asset.category}: <b>{asset.description}</b>{asset.serial_no ? ` · S/N ${asset.serial_no}` : ''} · held by {c.holder(asset.holder_id)?.full_name}</p>}
      {mode === 'add' && (<div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={ownOnly ? 'Holder (yourself)' : 'Holder'} hint={ownOnly ? 'Devices you add are recorded against your own name. Hand a device in to branch stock from My equipment.' : undefined}>{ownOnly ? <Input value={c.me?.full_name ?? 'You are not on the staff list - ask a fleet administrator'} disabled /> : <HolderSelect c={c} value={holder} onChange={setHolder} />}</Field></div>
        <DeviceFields f={f} set={set} />
      </div>)}
      {mode === 'edit' && <div className="grid gap-3 sm:grid-cols-2"><DeviceFields f={f} set={set} /></div>}
      {mode === 'move' && asset && (<div className="space-y-3">
        <Field label={canManage(c, asset.holder_id) && (c.isAdmin || c.myBranches.size) ? 'New holder (a person or a branch’s stock)' : 'Hand in to branch stock'}><HolderSelect c={c} value={holder} onChange={setHolder} stockOnly={!(c.isAdmin || c.myBranches.size)} /></Field>
        <Field label="Note"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. returned on resignation, replaced by new laptop" /></Field>
      </div>)}
      {mode === 'scrap' && asset && <Field label={asset.status === 'scrapped' ? 'Note' : 'Reason for scrapping'}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={asset.status === 'scrapped' ? 'why it is back in use' : 'e.g. screen broken beyond repair, stolen (case no.), end of life'} /></Field>}
      {mode === 'history' && (hist === null ? <Spinner /> : hist.length === 0 ? <Empty>No history.</Empty> : (
        <Table head={['When', 'Action', 'From', 'To', 'By', 'Note']}>{hist.map((h) => <tr key={h.id}><Td className="text-xs">{fmtDate(h.at.slice(0, 10))}</Td><Td>{h.action}</Td><Td>{h.from_holder ? c.holder(h.from_holder)?.full_name : ''}</Td><Td>{h.to_holder ? c.holder(h.to_holder)?.full_name : ''}</Td><Td>{h.by_name}</Td><Td className="text-xs">{h.note}</Td></tr>)}</Table>))}
      {msg && <div className="mt-3"><Alert tone="red">{msg}</Alert></div>}
      {mode !== 'history' && (
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
          {mode === 'add' && <Button disabled={busy || !holder} onClick={() => void run(supabase.rpc('fleet_it_add', { p_holder: Number(holder), p_category: f.category, p_description: f.description, p_serial: f.serial_no, p_condition: f.condition, p_issued: f.issued_on || null, p_note: f.note }))}>Add</Button>}
          {mode === 'edit' && asset && <Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_update', { p_asset: asset.id, p_category: f.category, p_description: f.description, p_serial: f.serial_no, p_condition: f.condition, p_issued: f.issued_on || null, p_note: f.note }))}>Save</Button>}
          {mode === 'move' && asset && <Button disabled={busy || !holder || Number(holder) === asset.holder_id} onClick={() => void run(supabase.rpc('fleet_it_move', { p_asset: asset.id, p_to: Number(holder), p_note: reason }))}>Move</Button>}
          {mode === 'scrap' && asset && (asset.status === 'scrapped'
            ? <Button disabled={busy} onClick={() => void run(supabase.rpc('fleet_it_restore', { p_asset: asset.id, p_note: reason }))}>Restore</Button>
            : <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void run(supabase.rpc('fleet_it_scrap', { p_asset: asset.id, p_reason: reason }))}>Scrap</Button>)}
        </div>
      )}
    </Modal>
  )
}

function AssetTable({ c, rows, onAct, showHolder = true }: { c: Ctx; rows: ItAsset[]; onAct: (a: ItAsset, mode: 'edit' | 'move' | 'scrap' | 'history') => void; showHolder?: boolean }) {
  const [busy, setBusy] = useState<number | null>(null); const [view, setView] = useState<ItAsset | null>(null); const [msg, setMsg] = useState<string | null>(null)
  async function upload(a: ItAsset, file: File) {
    setBusy(a.id); setMsg(null)
    try {
      const blob = await shrink(file); const path = newPhotoPath(a.id)
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error
      const { error: e2 } = await supabase.rpc('fleet_it_set_photo', { p_asset: a.id, p_path: path }); if (e2) throw e2
      if (a.photo_path) void supabase.storage.from(BUCKET).remove([a.photo_path])
      await c.reload()
    } catch (e) { setMsg((e as { message?: string })?.message ?? String(e)) } finally { setBusy(null) }
  }
  if (rows.length === 0) return <Empty>Nothing here.</Empty>
  return (<>
    {msg && <div className="mb-2"><Alert tone="red">{msg}</Alert></div>}
    {view && photoUrl(view.photo_path) && (
      <Modal title={`${view.category}: ${view.description}`} onClose={() => setView(null)} wide>
        <img src={photoUrl(view.photo_path)!} alt={view.description} className="max-h-[70vh] w-full rounded object-contain" />
        <p className="mt-2 text-xs text-slate-500">{view.serial_no ? `S/N ${view.serial_no} · ` : ''}photo added {view.photo_at?.slice(0, 10)} by {view.photo_by}</p>
      </Modal>
    )}
    <Table head={['Photo', 'Type', 'Device', 'Serial', 'Condition', 'Issued', ...(showHolder ? ['Held by'] : []), 'Status', '']}>
      {rows.map((a) => { const mine = canManage(c, a.holder_id); const mgr = c.isAdmin || (!!c.holder(a.holder_id)?.branch_id && c.myBranches.has(c.holder(a.holder_id)!.branch_id!))
        return (
          <tr key={a.id} className={a.status === 'scrapped' ? 'text-slate-400' : 'hover:bg-brand-card'}>
            <Td>
              {photoUrl(a.photo_path) ? <button type="button" onClick={() => setView(a)} title={`Photo added ${a.photo_at?.slice(0, 10)} by ${a.photo_by}`}><img src={photoUrl(a.photo_path)!} alt={a.description} className="h-10 w-14 rounded object-cover" /></button> : <span className="text-xs text-slate-300">none</span>}
              {mine && a.status !== 'scrapped' && <label className="mt-0.5 block cursor-pointer text-[11px] text-brand-purple hover:underline">{busy === a.id ? 'Uploading…' : a.photo_path ? 'replace' : 'add photo'}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy === a.id} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(a, f); e.currentTarget.value = '' }} /></label>}
            </Td>
            <Td>{a.category}</Td><Td><div>{a.description}</div>{a.note && <div className="text-[11px] text-amber-700">{a.note}</div>}{a.scrap_reason && <div className="text-[11px] text-red-700">Scrapped {fmtDate(a.scrapped_at?.slice(0, 10) ?? null)} by {a.scrapped_by}: {a.scrap_reason}</div>}</Td>
            <Td className="text-xs">{a.serial_no}</Td><Td className="text-xs">{a.condition}</Td><Td className="text-xs">{fmtDate(a.issued_on)}</Td>
            {showHolder && <HolderCell c={c} id={a.holder_id} />}
            <Td><Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge></Td>
            <Td className="whitespace-nowrap text-xs">
              {mine && a.status !== 'scrapped' && <><button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'edit')}>edit</button> · <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'move')}>{mgr ? 'move' : 'hand in'}</button></>}
              {mgr && <> · <button type="button" className="text-brand-purple hover:underline" onClick={() => onAct(a, 'scrap')}>{a.status === 'scrapped' ? 'restore' : 'scrap'}</button></>}
              {' · '}<button type="button" className="text-slate-500 hover:underline" onClick={() => onAct(a, 'history')}>history</button>
            </Td>
          </tr>)
      })}
    </Table>
  </>)
}
function useDialog(c: Ctx) {
  const [dlg, setDlg] = useState<{ asset: ItAsset | null; mode: 'add' | 'edit' | 'move' | 'scrap' | 'history' } | null>(null)
  const el = dlg ? <Actions c={c} asset={dlg.asset} mode={dlg.mode} onClose={() => setDlg(null)} /> : null
  return { el, open: (asset: ItAsset | null, mode: 'add' | 'edit' | 'move' | 'scrap' | 'history') => setDlg({ asset, mode }) }
}

// ---------------------------------------------------------------- tabs
function Register({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  const [q, setQ] = useState(''); const [branch, setBranch] = useState(''); const [cat, setCat] = useState(''); const [status, setStatus] = useState<'live' | 'all' | 'scrapped'>('live')
  const rows = c.assets.filter((a) => { const h = c.holder(a.holder_id); const t = `${a.description} ${a.serial_no ?? ''} ${h?.full_name ?? ''} ${h?.emp_no ?? ''}`.toLowerCase()
    return (status === 'all' || (status === 'scrapped' ? a.status === 'scrapped' : a.status !== 'scrapped')) && (!cat || a.category === cat) && (!branch || String(h?.branch_id ?? '') === branch) && (!q || t.includes(q.toLowerCase())) })
  const live = c.assets.filter((a) => a.status !== 'scrapped')
  function exportAll() {
    downloadWorkbook([{ name: 'IT equipment', rows: [['Type', 'Device', 'Serial', 'Condition', 'Issued', 'Holder', 'Emp no', 'Position', 'Branch', 'Holder status', 'Device status', 'Scrapped', 'Reason', 'Site (Jotform)', 'Note', 'Photo'],
      ...rows.map((a) => { const h = c.holder(a.holder_id); return [a.category, a.description, a.serial_no, a.condition, a.issued_on, h?.full_name ?? null, h?.emp_no ?? null, h?.position ?? null, h?.branch_code ?? null, h?.kind === 'stock' ? 'stock' : h?.status ?? null, statusLabel(a.status), a.scrapped_at?.slice(0, 10) ?? null, a.scrap_reason, a.site, a.note, photoUrl(a.photo_path)] })], widths: [12, 34, 20, 26, 11, 28, 8, 20, 8, 10, 10, 11, 30, 14, 40, 40] }], `IT equipment ${new Date().toISOString().slice(0, 10)}.xlsx`)
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
function Mine({ c }: { c: Ctx }) {
  const { el, open } = useDialog(c)
  if (!c.me) return <Alert tone="amber">Your login is not linked to a name on the staff list, so devices cannot be recorded against you. Ask a fleet administrator to link your e-mail address on the staff list.</Alert>
  const rows = c.assets.filter((a) => a.holder_id === c.me!.id)
  return (
    <div className="space-y-3">
      <Card title={`Equipment held by ${c.me.full_name}`} actions={<Button size="sm" onClick={() => open(null, 'add')}>Add a device</Button>}>
        <p className="mb-3 text-sm text-slate-600">Record every company laptop, desktop, screen, cellphone, tablet, router or SIM card in your possession. When you hand something back, use <b>hand in</b> to move it to your branch&rsquo;s stock.</p>
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
        return <Card key={s.id} title={`${c.branchName(s.branch_id)} · ${rows.length} in stock`} actions={canManage(c, s.id) ? <Button size="sm" onClick={() => open(null, 'add')}>Add to stock</Button> : undefined}><AssetTable c={c} rows={rows} onAct={open} showHolder={false} /></Card> })}
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
export type { ReactNode }
