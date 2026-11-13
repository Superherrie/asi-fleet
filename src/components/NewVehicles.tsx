// New vehicles: every registration a supplier has billed that is not on the fleet master and has no decision yet.
// Shown as a count on the Fleet menu, a banner on the Dashboard and the Vehicles tab, and worked from Fleet → New vehicles.
import { useCallback, useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { Masters } from '../hooks/useMasters'
import { CATEGORIES, type Category, type Ownership } from '../lib/types'
import { addNewRegToMaster, announceNewRegs, invalidateNewRegs, loadNewRegsShared, markNotOurs, reopenReg, NEW_REG_EVENT, type NewReg, type NewRegState } from '../lib/newVehicles'
import { money, periodLabel } from '../lib/format'
import { Alert, Badge, Button, Card, Empty, Money, Spinner, Table, Td } from './ui'

/** Loads the open registrations; refreshes after an import, after a decision and every few minutes. Only fleet admins can read the supplier lines. */
// eslint-disable-next-line react-refresh/only-export-components
export function useNewRegs(enabled: boolean) {
  const [state, setState] = useState<NewRegState | null>(null); const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    if (!enabled) return
    try { setState(await loadNewRegsShared()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    void reload()
    const h = () => void reload(); const fresh = () => { invalidateNewRegs(); h() }
    const later = () => setTimeout(fresh, 2500)   // an import announces itself before its lines are saved
    window.addEventListener(NEW_REG_EVENT, h); window.addEventListener('fleet-imported', later)
    const t = setInterval(fresh, 300000)
    return () => { window.removeEventListener(NEW_REG_EVENT, h); window.removeEventListener('fleet-imported', later); clearInterval(t) }
  }, [enabled, reload])
  return { state, error, reload, count: state?.open.length ?? 0 }
}

const list = (rs: NewReg[], n = 6) => rs.slice(0, n).map((r) => `${r.reg} (${r.sources.join(' + ')}, R ${money(r.amount)})`).join('; ') + (rs.length > n ? `; and ${rs.length - n} more` : '')

/** One-line flag with a link to the list. Renders nothing when there is nothing to decide. */
export function NewVehiclesBanner({ enabled }: { enabled: boolean }) {
  const { state } = useNewRegs(enabled)
  if (!state || state.open.length === 0) return null
  const o = state.open
  return (
    <div className="mb-3">
      <Alert tone="red">
        <b>{o.length} new registration{o.length > 1 ? 's need' : ' needs'} a decision.</b> {o.length > 1 ? 'They were' : 'It was'} billed by a supplier but {o.length > 1 ? 'are' : 'is'} not on the fleet master, so the cost is not allocated to any branch: {list(o)}.{' '}
        <NavLink to="/fleet/new" className="font-semibold underline">Decide under Fleet → New vehicles</NavLink>
      </Alert>
    </div>
  )
}

type Pick = { branch_id: string; category: Category | ''; ownership: Ownership }

/** The working list: per registration, add it to the master with a branch and category, or mark it not ours. */
export function NewVehiclesPanel({ m }: { m: Masters }) {
  const { state, error } = useNewRegs(true)
  const [pick, setPick] = useState<Record<string, Pick>>({}); const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)
  if (error) return <Alert tone="red">Could not load the new registrations: {error}</Alert>
  if (!state) return <Spinner />
  const p = (r: NewReg): Pick => pick[r.key] ?? { branch_id: '', category: '', ownership: r.ownership }
  const set = (r: NewReg, patch: Partial<Pick>) => setPick({ ...pick, [r.key]: { ...p(r), ...patch } })
  const done = async (text: string) => { setMsg({ tone: 'green', text }); setSel(new Set()); announceNewRegs(); await m.reload() }
  async function add(r: NewReg) {
    const c = p(r); if (!c.branch_id || !c.category) { setMsg({ tone: 'red', text: `Choose the branch and the category for ${r.reg} first.` }); return }
    setBusy(true); setMsg(null)
    try { await addNewRegToMaster(r, { branch_id: Number(c.branch_id), category: c.category, ownership: c.ownership }); await done(`${r.reg} added to the fleet master (${m.bm.code(Number(c.branch_id))}, ${c.category}) from ${periodLabel(r.first)}. Its ${r.lines} supplier line${r.lines > 1 ? 's are' : ' is'} now allocated to it — generate the month's journal again if it was already generated.`) }
    catch (e) { setMsg({ tone: 'red', text: (e as Error).message }) } finally { setBusy(false) }
  }
  async function notOurs(regs: NewReg[]) {
    if (!regs.length) return
    const note = window.prompt(`Why ${regs.length > 1 ? `are these ${regs.length} registrations` : `is ${regs[0].reg}`} not ours? (e.g. "ASI Group vehicle billed to our account — Avis to move and credit", "fine on a vehicle we never had")`)
    if (note == null) return
    if (!note.trim()) { setMsg({ tone: 'red', text: 'A short reason is needed for a not-ours decision.' }); return }
    setBusy(true); setMsg(null)
    try { await markNotOurs(regs.map((r) => r.reg), note); await done(`${regs.length > 1 ? `${regs.length} registrations` : regs[0].reg} marked not ours. The cost posts to branch ZZZ (Other) until the supplier corrects it.`) }
    catch (e) { setMsg({ tone: 'red', text: (e as Error).message }) } finally { setBusy(false) }
  }
  async function reopen(reg: string) {
    setBusy(true); setMsg(null)
    try { await reopenReg(reg); await done(`${reg} needs a decision again.`) } catch (e) { setMsg({ tone: 'red', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const o = state.open; const chosen = o.filter((r) => sel.has(r.key)); const fineOnly = o.filter((r) => r.desc === 'fine administration fee')
  const toggle = (k: string) => { const s = new Set(sel); if (s.has(k)) s.delete(k); else s.add(k); setSel(s) }
  const cell = 'rounded border border-slate-300 bg-white px-1 py-0.5 text-sm'
  return (
    <div className="space-y-3">
      <Alert tone="blue">A registration lands here when a supplier bills it (Avis, First Auto, WesBank maintenance, tracking, insurance) and it is not on the fleet master. Nothing is assumed: the cost is held, and the month's journal cannot be saved, until you either add the vehicle with its branch and category or mark it not ours. Only a not-ours decision posts to branch ZZZ.</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title={`Needs a decision — ${o.length} registration${o.length === 1 ? '' : 's'} · R ${money(o.reduce((s, r) => s + r.amount, 0))}`}
        actions={<div className="flex flex-wrap items-center gap-2">
          {fineOnly.length > 0 && <Button size="sm" variant="ghost" disabled={busy} title="Registrations that only ever carried Avis's R57.50 fine-administration fee" onClick={() => setSel(new Set(fineOnly.map((r) => r.key)))}>Select the {fineOnly.length} with fine fees only</Button>}
          {chosen.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void notOurs(chosen)}>Mark {chosen.length} selected not ours</Button>}
        </div>}>
        {o.length === 0 ? <Empty>Nothing to decide. Every billed registration is on the fleet master or has been decided.</Empty> : (
          <Table head={[<input key="all" type="checkbox" aria-label="Select all" checked={o.length > 0 && sel.size === o.length} onChange={(e) => setSel(e.target.checked ? new Set(o.map((r) => r.key)) : new Set())} />, 'Registration', 'Billed by', 'What', 'Vehicle (per supplier)', 'First', 'Last', 'Lines', 'Amount', 'Supplier cost centre', 'Branch', 'Category', 'Ownership', '']}>
            {o.map((r) => { const c = p(r); return (
              <tr key={r.key}>
                <Td><input type="checkbox" aria-label={`Select ${r.reg}`} checked={sel.has(r.key)} onChange={() => toggle(r.key)} /></Td>
                <Td className="whitespace-nowrap font-semibold">{r.reg}</Td>
                <Td className="whitespace-nowrap">{r.sources.map((s) => <span key={s} className="mr-1"><Badge tone="purple">{s}</Badge></span>)}</Td>
                <Td className="text-xs">{r.desc}</Td>
                <Td className="text-xs">{[r.year, r.make, r.model].filter(Boolean).join(' ') || <span className="text-slate-400">not given</span>}{r.mva && <div className="text-slate-400">Avis MVA {r.mva}</div>}</Td>
                <Td className="whitespace-nowrap text-xs">{periodLabel(r.first)}</Td><Td className="whitespace-nowrap text-xs">{periodLabel(r.last)}</Td>
                <Td num>{r.lines}</Td><Td num className="font-semibold"><Money v={r.amount} /></Td>
                <Td className="text-xs text-slate-500" title="What the supplier shows. The app's allocation decides the branch, not the supplier.">{r.supplierBranch}</Td>
                <Td><select className={cell} aria-label={`Branch for ${r.reg}`} value={c.branch_id} onChange={(e) => set(r, { branch_id: e.target.value })}><option value="">choose…</option>{m.branches.filter((b) => b.active && b.code !== 'ZZZ').map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></Td>
                <Td><select className={cell} aria-label={`Category for ${r.reg}`} value={c.category} onChange={(e) => set(r, { category: e.target.value as Category })}><option value="">choose…</option>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></Td>
                <Td><select className={cell} aria-label={`Ownership of ${r.reg}`} value={c.ownership} onChange={(e) => set(r, { ownership: e.target.value as Ownership })}><option value="owned">owned</option><option value="avis">avis</option><option value="other">other</option></select></Td>
                <Td className="whitespace-nowrap space-x-1"><Button size="sm" disabled={busy} onClick={() => void add(r)}>Add to master</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void notOurs([r])}>Not ours</Button></Td>
              </tr>) })}
          </Table>
        )}
      </Card>
      {state.decisions.length > 0 && (
        <details className="rounded-lg border border-brand-hairline bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-2 font-display text-sm font-semibold text-brand-navy">Decided not ours — {state.decisions.length} registration{state.decisions.length === 1 ? '' : 's'} (posted to branch ZZZ)</summary>
          <div className="p-4">
            <Table head={['Registration', 'Reason', 'Decided by', 'When', '']}>
              {state.decisions.map((d) => (
                <tr key={d.registration}>
                  <Td className="font-semibold">{d.registration}</Td><Td className="text-xs">{d.note}</Td><Td className="text-xs">{d.decided_by_name}</Td>
                  <Td className="whitespace-nowrap text-xs">{new Date(d.decided_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                  <Td><Button size="sm" variant="ghost" disabled={busy} onClick={() => void reopen(d.registration)}>Reopen</Button></Td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}
    </div>
  )
}
