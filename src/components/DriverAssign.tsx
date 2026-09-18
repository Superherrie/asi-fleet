import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'
import { Modal, when } from './QueryThread'

export interface StaffRow { branch_code: string; name: string; title: string | null }
interface Hist { id: number; driver_name: string | null; effective_from: string; note: string | null; assigned_by_name: string; created_at: string }

/** The Budget-app staff the signed-in person may assign (their cost centres; every cost centre for admins). */
export function useBranchStaff() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  useEffect(() => { void supabase.rpc('fleet_branch_staff').then(({ data }) => setStaff((data ?? []) as StaffRow[])) }, [])
  return staff
}

/** Dialog: allocate a vehicle to a driver from the branch's Budget staff list (or a typed name / pool), with the history underneath. */
export default function DriverAssign({ vehicleId, label, branchCode, current, staff, onClose, onSaved }: { vehicleId: number; label: string; branchCode: string; current: string | null; staff: StaffRow[]; onClose: () => void; onSaved: () => void }) {
  const [pick, setPick] = useState(current ?? ''); const [other, setOther] = useState(''); const [note, setNote] = useState(''); const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [allBranches, setAllBranches] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [hist, setHist] = useState<Hist[]>([])
  useEffect(() => { void supabase.from('fleet_vehicle_drivers').select('*').eq('vehicle_id', vehicleId).order('effective_from', { ascending: false }).order('id', { ascending: false }).then(({ data }) => setHist((data ?? []) as Hist[])) }, [vehicleId])
  const hasOwn = staff.some((s) => s.branch_code === branchCode)
  const list = useMemo(() => staff.filter((s) => allBranches || !hasOwn || s.branch_code === branchCode), [staff, allBranches, hasOwn, branchCode])
  const inList = !current || list.some((s) => s.name === current)
  const value = pick === '__other' ? other.trim() : pick === '__pool' ? '' : pick
  async function save() {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('fleet_assign_driver', { p_vehicle: vehicleId, p_driver: value || null, p_note: note || null, p_from: from })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }
  const box = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-lilac focus:outline-none'
  return (
    <Modal title={`Allocate ${label}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Currently: <b>{current ?? 'not allocated (pool)'}</b>. Choose who drives this vehicle from the {branchCode} staff list in the Budget app. The change is dated, so the history of who had the vehicle is kept.</p>
        <label className="block text-xs font-medium text-slate-600">Driver
          <select className={box} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="__pool">— not allocated / pool vehicle —</option>
            {!inList && current && <option value={current}>{current} (current)</option>}
            {list.map((s, i) => <option key={`${s.branch_code}-${s.name}-${i}`} value={s.name}>{s.name}{s.title ? ` · ${s.title}` : ''}{allBranches || !hasOwn ? ` · ${s.branch_code}` : ''}</option>)}
            <option value="__other">Someone not on the list…</option>
          </select>
        </label>
        {pick === '__other' && <input className={box} placeholder="Name and surname" value={other} onChange={(e) => setOther(e.target.value)} autoFocus />}
        {hasOwn && staff.some((s) => s.branch_code !== branchCode) && <label className="block text-xs text-slate-500"><input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} /> show staff from all my branches</label>}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-600">From date<input type="date" className={box} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="block text-xs font-medium text-slate-600">Note (optional)<input className={box} placeholder="e.g. replaces KZ18CTGP" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={busy || (pick === '__other' && !other.trim()) || value === (current ?? '')} onClick={() => void save()}>Save allocation</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
        {hist.length > 0 && (
          <div className="border-t border-slate-200 pt-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</div>
            <ul className="space-y-1 text-xs text-slate-600">
              {hist.map((h) => <li key={h.id}><b>{h.effective_from}</b> · {h.driver_name ?? 'pool / not allocated'}{h.note ? ` — ${h.note}` : ''} <span className="text-slate-400">({h.assigned_by_name || 'system'}, {when(h.created_at)})</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
