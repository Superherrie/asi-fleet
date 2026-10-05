import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMasters } from '../hooks/useMasters'
import type { EquipmentCount, EquipmentItem } from '../lib/types'
import { money, num, fmtDate } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Money, Badge, Select, Spinner, Stat, Input, Field, Alert } from '../components/ui'
import { Modal } from '../components/QueryThread'

const CATEGORIES = ['Testers and certifiers', 'OTDRs', 'Splicers and cleavers', 'Fibre blowing and compressors', 'Tools and toolboxes', 'Other']
const NOT_INSURED = 'Not insured'
const BLANK = { description: '', category: CATEGORIES[0], insured_qty: '0', unit_value: '', serial_no: '', note: '' }
type Form = typeof BLANK
const key = (item: number, branch: number) => `${item}:${branch}`
const th = 'px-2 py-1.5 font-semibold whitespace-nowrap'

/** One quantity cell: a number box for the branches this login may capture, plain text for the rest. Saves when the box is left. */
function Qty({ value, editable, onSave, title }: { value: number | null; editable: boolean; onSave: (v: number | null) => Promise<boolean>; title?: string }) {
  const shown = value == null ? '' : String(value)
  const [draft, setDraft] = useState(shown); const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  useEffect(() => { setDraft(shown) }, [shown])
  if (!editable) return <span title={title} className="tabular-nums">{value == null ? <span className="text-slate-300">–</span> : num(value)}</span>
  async function commit() {
    const t = draft.trim(); if (t === shown) return
    const v = t === '' ? null : Number(t)
    if (v != null && (!Number.isFinite(v) || v < 0)) { setDraft(shown); return }
    setState('saving'); const ok = await onSave(v); setState(ok ? 'idle' : 'error'); if (!ok) setDraft(shown)
  }
  return <input type="number" min={0} step={1} inputMode="numeric" value={draft} title={title} disabled={state === 'saving'} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    className={`w-14 rounded border px-1 py-0.5 text-right tabular-nums focus:border-brand-lilac focus:outline-none ${state === 'error' ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-amber-50/60'}`} />
}

/** Equipment register: the testers, splicers, tools and similar items on the insurer's schedule against what each branch actually has, to show where we are under- or over-insured. */
export default function Equipment() {
  const { isAdmin } = useAuth(); const m = useMasters()
  const [items, setItems] = useState<EquipmentItem[] | null>(null); const [counts, setCounts] = useState<Record<string, EquipmentCount>>({}); const [mine, setMine] = useState<Set<number>>(new Set())
  const [cat, setCat] = useState(''); const [onlyMine, setOnlyMine] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: number | null; insured: boolean; f: Form } | null>(null); const [busy, setBusy] = useState(false)
  async function load() {
    const [i, c, b] = await Promise.all([supabase.from('fleet_equipment_items').select('*').eq('active', true).order('item_no'), supabase.from('fleet_equipment_counts').select('*'), supabase.rpc('fleet_my_branches')])
    if (i.error || c.error) setErr((i.error ?? c.error)!.message)
    setItems((i.data ?? []) as EquipmentItem[]); setCounts(Object.fromEntries(((c.data ?? []) as EquipmentCount[]).map((x) => [key(x.item_id, x.branch_id), x])))
    setMine(new Set(((b.data ?? []) as (number | string)[]).map(Number)))
  }
  useEffect(() => { void load() }, [])

  const allBranches = useMemo(() => m.branches.filter((b) => b.active && b.code !== 'ZZZ'), [m.branches])
  const branches = onlyMine ? allBranches.filter((b) => mine.has(b.id)) : allBranches
  const canCapture = allBranches.some((b) => mine.has(b.id))
  const qty = (item: number, branch: number) => counts[key(item, branch)]?.qty ?? null
  /** total across every branch (not only the columns shown); null until at least one branch has captured the item */
  const counted = (it: EquipmentItem) => { let n: number | null = null; for (const b of allBranches) { const q = qty(it.id, b.id); if (q != null) n = (n ?? 0) + Number(q) } return n }
  const unit = (it: EquipmentItem) => Number(it.unit_value ?? 0)
  const shown = useMemo(() => (items ?? []).filter((i) => !cat || i.category === cat), [items, cat])
  const groups = useMemo(() => [...CATEGORIES, ...new Set((items ?? []).map((i) => i.category).filter((c) => !CATEGORIES.includes(c)))].map((c) => ({ cat: c, rows: shown.filter((i) => i.category === c) })).filter((g) => g.rows.length), [shown, items])
  const captured = useMemo(() => allBranches.filter((b) => (items ?? []).some((i) => qty(i.id, b.id) != null)), [allBranches, items, counts]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = useMemo(() => {
    let insured = 0, premium = 0, onHand = 0, under = 0, over = 0, uncounted = 0
    for (const i of shown) { insured += Number(i.sum_insured); premium += Number(i.monthly_premium); const c = counted(i); if (c == null) { uncounted++; continue } onHand += c * unit(i); const gap = (c - Number(i.insured_qty)) * unit(i); if (gap > 0) under += gap; else over -= gap }
    return { insured, premium, onHand, under, over, uncounted }
  }, [shown, counts, allBranches]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveQty(item: EquipmentItem, branchId: number, v: number | null) {
    setErr(null)
    const { error } = v == null ? await supabase.from('fleet_equipment_counts').delete().eq('item_id', item.id).eq('branch_id', branchId) : await supabase.from('fleet_equipment_counts').upsert({ item_id: item.id, branch_id: branchId, qty: v }, { onConflict: 'item_id,branch_id' })
    if (error) { setErr(`${item.description}: ${error.message}`); return false }
    setCounts((old) => { const next = { ...old }; if (v == null) delete next[key(item.id, branchId)]; else next[key(item.id, branchId)] = { item_id: item.id, branch_id: branchId, qty: v, updated_by_name: 'you', updated_at: new Date().toISOString() }; return next })
    return true
  }
  const startEdit = (i: EquipmentItem | null) => setEdit({ id: i?.id ?? null, insured: !!i && i.section !== NOT_INSURED, f: i ? { description: i.description, category: i.category, insured_qty: String(i.insured_qty), unit_value: i.unit_value == null ? '' : String(i.unit_value), serial_no: i.serial_no ?? '', note: i.note ?? '' } : { ...BLANK } })
  async function saveItem() {
    if (!edit) return
    const f = edit.f; if (!f.description.trim()) { setErr('Give the item a description.'); return }
    setBusy(true); setErr(null)
    const row = { description: f.description.trim(), category: f.category, insured_qty: Number(f.insured_qty) || 0, unit_value: f.unit_value.trim() === '' ? null : Number(f.unit_value), serial_no: f.serial_no.trim() || null, note: f.note.trim() || null, updated_at: new Date().toISOString() }
    const { error } = edit.id ? await supabase.from('fleet_equipment_items').update(row).eq('id', edit.id) : await supabase.from('fleet_equipment_items').insert({ ...row, section: NOT_INSURED, insured_qty: 0, sum_insured: 0, monthly_premium: 0 })
    setBusy(false); if (error) { setErr(error.message); return } setEdit(null); await load()
  }
  async function removeItem() {
    if (!edit?.id || !confirm('Remove this item and the quantities the branches captured for it?')) return
    setBusy(true); const { error } = await supabase.from('fleet_equipment_items').delete().eq('id', edit.id); setBusy(false)
    if (error) { setErr(error.message); return } setEdit(null); await load()
  }
  function exportXlsx() {
    const head = ['Schedule section', 'Item no', 'Category', 'Item', 'Serial no', 'Insured qty', 'Value per unit', 'Sum insured', 'Monthly premium', ...allBranches.map((b) => b.name), 'Counted', 'Difference (counted - insured)', 'Under-insured value', 'Insured but not counted value', 'Note']
    const rows = shown.map((i) => { const c = counted(i); const d = c == null ? null : c - Number(i.insured_qty); const g = d == null ? null : d * unit(i)
      return [i.section, i.item_no, i.category, i.description, i.serial_no, Number(i.insured_qty), i.unit_value == null ? null : Number(i.unit_value), Number(i.sum_insured), Number(i.monthly_premium), ...allBranches.map((b) => qty(i.id, b.id)), c, d, g != null && g > 0 ? g : null, g != null && g < 0 ? -g : null, i.note] })
    downloadWorkbook([{ name: 'Equipment', rows: [head, ...rows], widths: [20, 8, 26, 60, 26, 10, 14, 14, 14, ...allBranches.map(() => 12), 10, 14, 16, 18, 60] }], `Equipment insured vs on hand - ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (items == null || m.loading) return <Spinner />
  const set = (k: keyof Form, v: string) => setEdit((e) => (e ? { ...e, f: { ...e.f, [k]: v } } : e))
  return (
    <Page title="Equipment" subtitle="Testers, splicers, tools and similar equipment as listed on the insurer's schedule, against the quantity each branch actually has. Branch managers fill in the columns of their own branches; the comparison shows where we are under-insured or paying for cover on equipment we no longer have."
      actions={<>{isAdmin && <Button size="sm" onClick={() => startEdit(null)}>Add item not on schedule</Button>}<Button variant="secondary" size="sm" onClick={exportXlsx} disabled={!shown.length}>Export to Excel</Button></>}>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Sum insured" value={money(tot.insured)} sub={`${shown.length} items · ${money(tot.premium)} a month`} />
        <Stat label="Counted at insured value" value={money(tot.onHand)} sub={`${captured.length} of ${allBranches.length} branches have captured`} tone="teal" />
        <Stat label="Under-insured" value={money(tot.under)} sub="more on hand than insured" tone="pink" />
        <Stat label="Insured but not counted" value={money(tot.over)} sub="insured quantity above the count" tone="purple" />
        <Stat label="Items nobody has counted" value={tot.uncounted} sub="no branch has entered a quantity" />
      </div>
      {err && <div className="mb-3"><Alert tone="red">{err}</Alert></div>}
      {captured.length < allBranches.length && <div className="mb-3"><Alert tone="amber">The comparison is only complete once every branch has captured. Still outstanding: {allBranches.filter((b) => !captured.includes(b)).map((b) => b.name).join(', ')}. A branch that has none of an item enters 0.</Alert></div>}
      <Card title="Insured against on hand" actions={<div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        {canCapture && !isAdmin && <label><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> only my branches</label>}
        <Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{[...new Set((items ?? []).map((i) => i.category))].sort().map((c) => <option key={c}>{c}</option>)}</Select></div>}>
        {canCapture ? <p className="mb-2 text-xs text-slate-500">Type the quantity your branch has in the shaded boxes — it saves when you leave the box. Enter 0 where the branch has none; leave blank only where you have not counted yet. If you have equipment that is not on this list, ask the fleet administrator to add it.</p>
          : <p className="mb-2 text-xs text-slate-500">View only — quantities are captured by the manager of each branch.</p>}
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-brand-navy text-left text-xs uppercase tracking-wide text-white">
                <th className={`${th} sticky left-0 z-30 bg-brand-navy`}>Item</th><th className={`${th} text-right`}>Insured qty</th><th className={`${th} text-right`}>Value each</th><th className={`${th} text-right`}>Sum insured</th>
                {branches.map((b) => <th key={b.id} title={b.name} className={`${th} text-right ${mine.has(b.id) ? 'bg-brand-purple' : ''}`}>{b.code}</th>)}
                <th className={`${th} text-right`}>Counted</th><th className={`${th} text-right`}>Difference</th><th className={`${th} text-right`}>Value of difference</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => { const gi = g.rows.reduce((a, i) => a + Number(i.sum_insured), 0)
                return (<Fragment key={g.cat}>
                  <tr className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-brand-navy"><td className="sticky left-0 z-10 bg-slate-100 px-2 py-1">{g.cat} ({g.rows.length})</td><td /><td /><td className="px-2 py-1 text-right tabular-nums">{money(gi)}</td><td colSpan={branches.length + 3} /></tr>
                  {g.rows.map((i) => { const c = counted(i); const d = c == null ? null : c - Number(i.insured_qty); const gap = d == null ? null : d * unit(i)
                    return (
                      <tr key={i.id} className="border-b border-brand-hairline hover:bg-slate-50">
                        <td className="sticky left-0 z-10 max-w-xs border-b border-brand-hairline bg-white px-2 py-1 align-top sm:max-w-md">
                          <div className="font-medium text-slate-800">{i.description} {i.section === NOT_INSURED && <Badge tone="red">not insured</Badge>}{isAdmin && <button type="button" className="ml-1 text-xs text-brand-purple hover:underline" onClick={() => startEdit(i)}>edit</button>}</div>
                          <div className="text-[11px] text-slate-500">{i.section === NOT_INSURED ? 'Added by us' : `${i.section} #${i.item_no}`}{i.serial_no ? ` · S/N ${i.serial_no}` : ''}</div>
                          {i.note && <div className="text-[11px] text-amber-700">{i.note}</div>}
                        </td>
                        <td className="border-b border-brand-hairline px-2 py-1 text-right align-top tabular-nums">{num(Number(i.insured_qty))}</td>
                        <td className="border-b border-brand-hairline px-2 py-1 text-right align-top"><Money v={i.unit_value == null ? null : Number(i.unit_value)} /></td>
                        <td className="border-b border-brand-hairline px-2 py-1 text-right align-top"><Money v={Number(i.sum_insured)} /></td>
                        {branches.map((b) => { const cnt = counts[key(i.id, b.id)]
                          return <td key={b.id} className="border-b border-brand-hairline px-1 py-1 text-right align-top"><Qty value={cnt ? Number(cnt.qty) : null} editable={mine.has(b.id)} onSave={(v) => saveQty(i, b.id, v)} title={cnt ? `${b.name}: ${cnt.updated_by_name || 'captured'} ${fmtDate(cnt.updated_at.slice(0, 10))}` : `${b.name}: not captured`} /></td> })}
                        <td className="border-b border-brand-hairline px-2 py-1 text-right align-top font-semibold tabular-nums">{c == null ? <span className="font-normal text-slate-300">–</span> : num(c)}</td>
                        <td className={`border-b border-brand-hairline px-2 py-1 text-right align-top tabular-nums ${d != null && d > 0 ? 'font-semibold text-red-600' : d != null && d < 0 ? 'text-brand-purple' : ''}`}>{d == null ? '' : d > 0 ? `+${num(d)}` : num(d)}</td>
                        <td className="border-b border-brand-hairline px-2 py-1 text-right align-top whitespace-nowrap">{gap == null || gap === 0 ? '' : gap > 0 ? <span className="font-semibold text-red-600">{money(gap)} short</span> : <span className="text-brand-purple">{money(-gap)} over</span>}</td>
                      </tr>) })}
                </Fragment>) })}
              <tr className="bg-brand-navy text-xs font-semibold text-white"><td className="sticky left-0 z-10 bg-brand-navy px-2 py-1.5">Total</td><td /><td /><td className="px-2 py-1.5 text-right tabular-nums">{money(tot.insured)}</td><td colSpan={branches.length + 2} /><td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{money(tot.under)} short · {money(tot.over)} over</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Difference = counted across all branches less the insured quantity. <span className="font-semibold text-red-600">Red</span> means more on hand than insured (under-insured); <span className="text-brand-purple">purple</span> means cover for more than was counted. Values use the insured value per unit, so they do not show whether that value is still enough to replace the item.</p>
      </Card>

      {edit && (
        <Modal title={edit.id ? 'Edit equipment item' : 'Add item not on the schedule'} onClose={() => setEdit(null)}>
          <div className="space-y-3 text-sm">
            {!edit.id && <Alert tone="blue">Use this for equipment the branches have that is not on the insurer's schedule. It shows as "not insured" and everything counted against it is under-insured.</Alert>}
            <Field label="Description"><Input value={edit.f.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category"><Select value={edit.f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Replacement value each (R)"><Input type="number" value={edit.f.unit_value} onChange={(e) => set('unit_value', e.target.value)} /></Field>
              {edit.insured && <Field label="Insured quantity" hint="As read from the schedule wording"><Input type="number" value={edit.f.insured_qty} onChange={(e) => set('insured_qty', e.target.value)} /></Field>}
              <Field label="Serial number(s)"><Input value={edit.f.serial_no} onChange={(e) => set('serial_no', e.target.value)} /></Field>
            </div>
            <Field label="Note"><Input value={edit.f.note} onChange={(e) => set('note', e.target.value)} /></Field>
            <div className="flex items-center gap-2"><Button onClick={() => void saveItem()} disabled={busy}>Save</Button><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>{edit.id && !edit.insured && <Button variant="danger" className="ml-auto" onClick={() => void removeItem()} disabled={busy}>Remove</Button>}</div>
          </div>
        </Modal>
      )}
    </Page>
  )
}
