import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import type { Copier, CopierInvoiceRow, VehicleQuery } from '../lib/types'
import { pdfTextLines } from '../lib/pdfText'
import { parseCopierInvoices } from '../lib/copierPdf'
import { money, num } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Select, Spinner, Empty, Stat, Input, Alert, FileDrop } from '../components/ui'
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
  const [invoices, setInvoices] = useState<CopierInvoiceRow[]>([]); const [invFor, setInvFor] = useState<Copier | null>(null); const [showImport, setShowImport] = useState(false); const [note, setNote] = useState<string | null>(null)
  const [add, setAdd] = useState({ model: '', serial_no: '', location: '', branch_id: '', contract_end: '', month_to_month: false, rental_excl: '' })
  const load = () => Promise.all([
    supabase.rpc('fleet_my_copiers').then(({ data }) => setRows((data ?? []) as Copier[])),
    supabase.from('fleet_vehicle_queries').select(QUERY_SELECT).not('copier_id', 'is', null).order('updated_at', { ascending: false }).then(({ data }) => setQueries((data ?? []) as VehicleQuery[])),
    supabase.from('fleet_copier_invoices').select('*').order('invoice_date', { ascending: false }).then(({ data }) => setInvoices((data ?? []) as CopierInvoiceRow[])),
  ])
  // latest service (click-charge) invoice per copier, and what is normal across the fleet for the colour rate
  const lastService = useMemo(() => { const mp = new Map<number, CopierInvoiceRow>(); for (const i of invoices) if ((i.mono_qty != null || i.colour_qty != null) && i.copier_id && !mp.has(i.copier_id)) mp.set(i.copier_id, i); return mp }, [invoices])
  const medianColour = useMemo(() => { const r = [...lastService.values()].map((i) => Number(i.colour_rate)).filter(Boolean).sort((a, b) => a - b); return r.length ? r[Math.floor(r.length / 2)] : null }, [lastService])
  async function importPdf(file: File) {
    setMsg(null); setNote(null)
    try {
      const parsed = parseCopierInvoices((await pdfTextLines(file)).layout)
      if (!parsed.length) { setMsg('No tax invoices found in that PDF. Statement pages are skipped; the file must contain the CBS tax invoice pages.'); return }
      const bySerial = new Map<string, Copier>(); for (const c of rows ?? []) for (const sn of c.serial_no.split('/')) bySerial.set(sn.trim().toUpperCase(), c)
      const unmatched: string[] = []
      for (const i of parsed) {
        const c = bySerial.get(i.serial_no); if (!c) unmatched.push(`${i.serial_no} (${i.invoice_no})`)
        const { error } = await supabase.from('fleet_copier_invoices').upsert({
          copier_id: c?.id ?? null, serial_no: i.serial_no, supplier_entity: i.supplier_entity, account_no: i.account_no, customer_name: i.customer_name, invoice_no: i.invoice_no, invoice_date: i.invoice_date, period: i.period, kind: i.kind,
          contract_no: i.contract_no, model: i.model, site: i.site, rental_excl: i.rental_excl, rental_for: i.rental_for, admin_fee: i.admin_fee,
          mono_open: i.mono?.open ?? null, mono_close: i.mono?.close ?? null, mono_qty: i.mono?.qty ?? null, mono_rate: i.mono?.rate ?? null, mono_charge: i.mono?.charge ?? null, mono_read: i.mono?.read_date ?? null,
          colour_open: i.colour?.open ?? null, colour_close: i.colour?.close ?? null, colour_qty: i.colour?.qty ?? null, colour_rate: i.colour?.rate ?? null, colour_charge: i.colour?.charge ?? null,
          scan_qty: i.scan?.qty ?? null, scan_rate: i.scan?.rate ?? null, scan_charge: i.scan?.charge ?? null, subtotal: i.subtotal, vat: i.vat, total: i.total, source_file: file.name,
        }, { onConflict: 'invoice_no' })
        if (error) throw error
      }
      setNote(`Loaded ${parsed.length} invoice${parsed.length === 1 ? '' : 's'} from ${file.name}: R ${money(parsed.reduce((s, i) => s + i.total, 0))} incl VAT.${unmatched.length ? ` Not matched to a copier on file: ${unmatched.join(', ')} — add the machine and import again.` : ''}`)
      setShowImport(false); await load()
    } catch (e) { setMsg((e as Error).message) }
  }
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
      actions={<>{isAdmin && <Button size="sm" onClick={() => setShowImport((x) => !x)}>Import invoices (PDF)</Button>}<Button variant="secondary" size="sm" onClick={exportXlsx} disabled={!shown.length}>Export to Excel</Button></>}>
      {msg && <div className="mb-3"><Alert tone="red">{msg}</Alert></div>}
      {note && <div className="mb-3"><Alert tone="green">{note}</Alert></div>}
      {showImport && <div className="mb-3"><FileDrop accept=".pdf" onFile={(f) => void importPdf(f)} label="Drop the CBS invoice PDF here (rental or service). Statement pages are skipped; re-importing the same invoice replaces it." /></div>}
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
            <Table head={['Photo', 'Model', 'Serial', 'Location', 'Branch', 'Contract end', 'Rental excl', 'Avg black', 'Avg colour', 'Last click charges', 'Query', isAdmin ? 'Status' : '']}>
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
                    <Td className="whitespace-nowrap text-xs">{(() => { const i = lastService.get(r.id); const n = invoices.filter((x) => x.copier_id === r.id).length; if (!n) return <span className="text-slate-400">no invoices</span>
                      const high = !!i && !!medianColour && Number(i.colour_rate) > medianColour * 1.3
                      return <button type="button" className="text-left hover:underline" onClick={() => setInvFor(r)}>{i ? <><div className="font-medium tabular-nums">R {money(Number(i.subtotal) - Number(i.rental_excl))} <span className="font-normal text-slate-400">{i.period}</span></div><div className={high ? 'font-semibold text-amber-700' : 'text-slate-500'}>{[i.colour_rate != null ? `colour ${Number(i.colour_rate).toFixed(2)}` : null, i.mono_rate != null ? `mono ${Number(i.mono_rate).toFixed(2)}` : null].filter(Boolean).join(' · ')}{high ? ' · high' : ''}</div></> : <span className="text-brand-purple">{n} invoice{n === 1 ? '' : 's'}</span>}</button> })()}</Td>
                    <Td><button type="button" className="whitespace-nowrap rounded-md border border-brand-purple/40 px-2 py-0.5 text-xs font-medium text-brand-purple hover:bg-brand-card" onClick={() => setQCopier(r)}>Query{openFor(r.id).length > 0 && <span className={`ml-1 rounded-full px-1.5 text-[10px] font-semibold ${openFor(r.id).some((x) => x.status === 'answered') ? 'bg-brand-teal text-brand-navy' : 'bg-amber-400 text-brand-navy'}`}>{openFor(r.id).length}</span>}</button></Td>
                    <Td>{isAdmin ? (r.active ? <button type="button" className="text-xs text-slate-500 hover:text-red-600 hover:underline" onClick={() => { const note = prompt('Returned / cancelled — note (date, reason):'); if (note != null) void save(r, { active: false, disposal_note: note || null }) }}>mark returned</button> : <span className="text-xs text-slate-500">returned{r.disposal_note ? ` · ${r.disposal_note}` : ''} <button type="button" className="text-brand-purple hover:underline" onClick={() => save(r, { active: true, disposal_note: null })}>undo</button></span>) : null}</Td>
                  </tr>
                )
              })}
              {shown.length > 0 && <tr className="bg-brand-card font-semibold"><Td>Total ({shown.length})</Td><Td /><Td /><Td /><Td /><Td /><Td num><Money v={rental} /></Td><Td num>{num(shown.reduce((s, r) => s + (r.avg_black ?? 0), 0))}</Td><Td num>{num(shown.reduce((s, r) => s + (r.avg_colour ?? 0), 0))}</Td><Td className="text-xs tabular-nums">R {money(shown.reduce((s, r) => s + Number(lastService.get(r.id)?.subtotal ?? 0), 0))}</Td><Td /><Td /></tr>}
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
      {invFor && (
        <Modal title={`Invoices — ${invFor.model} · ${invFor.serial_no}`} onClose={() => setInvFor(null)} wide>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-brand-navy text-left uppercase tracking-wide text-white">{['Date', 'Invoice', 'Type', 'Rental', 'Admin fee', 'Mono', 'Colour', 'Scans', 'Excl', 'Incl VAT'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-brand-hairline">
                {invoices.filter((x) => x.copier_id === invFor.id).map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="whitespace-nowrap px-2 py-1">{i.invoice_date}</td>
                    <td className="px-2 py-1">{i.invoice_no}<div className="text-slate-400">{i.supplier_entity}{i.contract_no ? ` · ${i.contract_no}` : ''}</div><div className="text-slate-400">{i.site}</div></td>
                    <td className="px-2 py-1"><Badge tone={i.kind === 'rental' ? 'purple' : 'teal'}>{i.kind === 'rental' && (i.mono_qty != null || i.colour_qty != null) ? 'rental + clicks' : i.kind}</Badge>{i.rental_for && <div className="text-slate-400">for {i.rental_for}</div>}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{Number(i.rental_excl) ? money(Number(i.rental_excl)) : ''}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{Number(i.admin_fee) ? money(Number(i.admin_fee)) : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1">{i.mono_qty != null && <>{num(i.mono_qty)} × {Number(i.mono_rate).toFixed(4)} = {money(Number(i.mono_charge))}<div className="text-slate-400">{num(i.mono_open)} → {num(i.mono_close)}{i.mono_read ? ` · read ${i.mono_read}` : ''}</div></>}</td>
                    <td className="whitespace-nowrap px-2 py-1">{i.colour_qty != null && <>{num(i.colour_qty)} × {Number(i.colour_rate).toFixed(4)} = {money(Number(i.colour_charge))}<div className="text-slate-400">{num(i.colour_open)} → {num(i.colour_close)}</div></>}</td>
                    <td className="whitespace-nowrap px-2 py-1">{i.scan_qty != null && <>{num(i.scan_qty)} × {Number(i.scan_rate).toFixed(4)} = {money(Number(i.scan_charge))}</>}</td>
                    <td className="num-cell px-2 py-1 font-medium tabular-nums">{money(Number(i.subtotal))}</td>
                    <td className="num-cell px-2 py-1 tabular-nums">{money(Number(i.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Schedule rental for this machine: R {money(Number(invFor.rental_excl))} a month excl VAT{invFor.contract_no ? ` · rental contract ${invFor.contract_no}` : ''}{invFor.service_contract_no ? ` · service contract ${invFor.service_contract_no}` : ''}.</p>
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
