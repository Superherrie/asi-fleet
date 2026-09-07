import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Branch, Employee, TravelLog, TravelLogLine } from '../../lib/types'
import { daysInPeriod, fmtDate, num, periodLabel, round2 } from '../../lib/format'
import { parseTravelLogWorkbook, readWorkbook } from '../../lib/parsers'
import { Page, Card, Button, Badge, statusTone, Input, Field, Alert, Spinner, FileDrop } from '../../components/ui'

type Line = Omit<TravelLogLine, 'log_id'> & { key: string }

export default function LogEditor({ readOnly = false }: { readOnly?: boolean }) {
  const { id } = useParams()
  const nav = useNavigate()
  const { isAdmin, employee: me } = useAuth()
  const [log, setLog] = useState<TravelLog | null>(null)
  const [emp, setEmp] = useState<Employee | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null)
  const [comment, setComment] = useState('')
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from('fleet_travel_logs').select('*').eq('id', id).maybeSingle()
      if (!l) { setMsg({ tone: 'red', text: 'Log not found or you do not have access to it.' }); return }
      const [{ data: e }, { data: ls }] = await Promise.all([
        supabase.from('fleet_employees').select('*').eq('id', l.employee_id).maybeSingle(),
        supabase.from('fleet_travel_log_lines').select('*').eq('log_id', l.id).order('line_no'),
      ])
      setLog(l as TravelLog); setEmp((e as Employee) ?? null)
      if (l.branch_id) supabase.from('fleet_branches').select('*').eq('id', l.branch_id).maybeSingle().then(({ data }) => setBranch((data as Branch) ?? null))
      const existing = ((ls ?? []) as TravelLogLine[]).map((x, i) => ({ ...x, key: `k${i}` }))
      setLines(existing.length ? existing : blankMonth(l.period))
    })()
  }, [id])

  const editable = !!log && !readOnly && (isAdmin || (log.employee_id === me?.id && ['draft', 'rejected'].includes(log.status)))
  const canDecide = !!log && log.status === 'submitted' && (readOnly || isAdmin)

  const totals = useMemo(() => {
    const b = round2(lines.reduce((s, l) => s + (Number(l.business_km) || 0), 0))
    const p = round2(lines.reduce((s, l) => s + (Number(l.private_km) || 0), 0))
    const withKm = lines.filter((l) => l.opening_km != null && l.closing_km != null)
    const first = withKm[0]; const last = withKm[withKm.length - 1]
    return { business: b, priv: p, total: b + p, pct: b + p ? (b / (b + p)) * 100 : 0, firstOpen: first?.opening_km ?? null, lastClose: last?.closing_km ?? null }
  }, [lines])

  const warnings = useMemo(() => {
    const w: string[] = []
    let prevClose: number | null = null
    lines.forEach((l, i) => {
      if (l.opening_km == null && l.closing_km == null && !l.business_km && !l.private_km) return
      if (l.opening_km != null && l.closing_km != null) {
        const trip = l.closing_km - l.opening_km
        if (trip < 0) w.push(`Row ${i + 1}: closing km is less than opening km`)
        else if (Math.abs(trip - (Number(l.business_km) || 0) - (Number(l.private_km) || 0)) > 0.5) w.push(`Row ${i + 1}: business + private (${num((Number(l.business_km) || 0) + (Number(l.private_km) || 0))}) ≠ odometer difference (${num(trip)})`)
        if (prevClose != null && l.opening_km !== prevClose) w.push(`Row ${i + 1}: opening km ${num(l.opening_km)} does not follow previous closing km ${num(prevClose)}`)
        prevClose = l.closing_km
      }
      if (Number(l.business_km) > 0 && !l.destination?.trim()) w.push(`Row ${i + 1}: business km without a destination`)
    })
    return w
  }, [lines])

  function upd(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l
      const n = { ...l, ...patch }
      // auto-derive private km when opening/closing/business are known and private wasn't the field edited
      if (!('private_km' in patch) && n.opening_km != null && n.closing_km != null) {
        const trip = n.closing_km - n.opening_km
        if (trip >= 0) n.private_km = round2(Math.max(0, trip - (Number(n.business_km) || 0)))
      }
      return n
    }))
    setDirty(true)
  }
  function addRow(after: string) {
    setLines((ls) => { const i = ls.findIndex((l) => l.key === after); const base = ls[i]; const n = { ...blankLine(base.trip_date), key: `n${Date.now()}`, opening_km: base.closing_km }; return [...ls.slice(0, i + 1), n, ...ls.slice(i + 1)] })
    setDirty(true)
  }
  function delRow(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); setDirty(true) }

  async function save(silent = false) {
    if (!log) return false
    setBusy(true); setMsg(null)
    const kept = lines.filter((l) => l.opening_km != null || l.closing_km != null || l.business_km || l.private_km || l.destination?.trim() || l.reason?.trim())
    const { error: dErr } = await supabase.from('fleet_travel_log_lines').delete().eq('log_id', log.id)
    if (dErr) { setMsg({ tone: 'red', text: dErr.message }); setBusy(false); return false }
    if (kept.length) {
      const { error } = await supabase.from('fleet_travel_log_lines').insert(kept.map((l, i) => ({
        log_id: log.id, line_no: i + 1, trip_date: l.trip_date, opening_km: l.opening_km, closing_km: l.closing_km,
        private_km: Number(l.private_km) || 0, business_km: Number(l.business_km) || 0, destination: l.destination || null, reason: l.reason || null,
      })))
      if (error) { setMsg({ tone: 'red', text: error.message }); setBusy(false); return false }
    }
    const patch = {
      vehicle_reg: log.vehicle_reg, department: log.department, manager_email: log.manager_email,
      opening_odo: log.opening_odo ?? totals.firstOpen, closing_odo: log.closing_odo ?? totals.lastClose,
      opening_date: log.opening_date, closing_date: log.closing_date, business_km: totals.business, private_km: totals.priv, updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('fleet_travel_logs').update(patch).eq('id', log.id)
    if (error) { setMsg({ tone: 'red', text: error.message }); setBusy(false); return false }
    setLog({ ...log, ...patch }); setDirty(false); setBusy(false)
    if (!silent) setMsg({ tone: 'green', text: 'Saved.' })
    return true
  }
  async function submit() {
    if (!log) return
    if (!log.manager_email?.trim() && !emp?.manager_email && !emp?.manager_employee_id) { setMsg({ tone: 'amber', text: 'Enter your manager’s e-mail address before submitting.' }); return }
    if (warnings.length && !confirm(`There are ${warnings.length} warning(s) on this log. Submit anyway?`)) return
    if (!(await save(true))) return
    setBusy(true)
    const { error } = await supabase.rpc('fleet_submit_log', { p_log: log.id })
    setBusy(false)
    if (error) { setMsg({ tone: 'red', text: error.message }); return }
    void supabase.functions.invoke('fleet-notify').catch(() => {})
    nav('/my-logs')
  }
  async function decide(approve: boolean) {
    if (!log) return
    if (!approve && !comment.trim()) { setMsg({ tone: 'amber', text: 'Please give a reason when returning a log.' }); return }
    setBusy(true)
    const { error } = await supabase.rpc('fleet_decide_log', { p_log: log.id, p_approve: approve, p_comment: comment || null })
    setBusy(false)
    if (error) { setMsg({ tone: 'red', text: error.message }); return }
    void supabase.functions.invoke('fleet-notify').catch(() => {})
    nav(readOnly ? '/approvals' : '/my-logs')
  }
  async function reopen() {
    if (!log || !confirm('Re-open this log? Its claim and accrual entry will be removed.')) return
    const { error } = await supabase.rpc('fleet_reopen_log', { p_log: log.id })
    if (error) setMsg({ tone: 'red', text: error.message }); else setLog({ ...log, status: 'draft' })
  }
  async function importWorkbook(f: File) {
    try {
      const p = parseTravelLogWorkbook(await readWorkbook(f))
      if (!p.lines.length) { setMsg({ tone: 'amber', text: 'No trip lines found on the Electronic sheet.' }); return }
      setLines(p.lines.map((l, i) => ({ key: `i${i}`, line_no: i + 1, ...l })))
      setLog((lg) => lg && ({ ...lg, vehicle_reg: p.vehicle_reg || lg.vehicle_reg, opening_odo: p.opening_odo ?? lg.opening_odo, closing_odo: p.closing_odo ?? lg.closing_odo, opening_date: p.opening_date ?? lg.opening_date, closing_date: p.closing_date ?? lg.closing_date }))
      setDirty(true); setShowImport(false)
      setMsg({ tone: 'green', text: `Loaded ${p.lines.length} lines from ${f.name}${p.period && log && p.period !== log.period ? ` — note: the file is for ${periodLabel(p.period)}` : ''}. Remember to save.` })
    } catch (e) { setMsg({ tone: 'red', text: (e as Error).message }) }
  }

  if (!log) return msg ? <Alert tone="red">{msg.text}</Alert> : <Spinner />
  const inp = 'w-full rounded border border-slate-200 px-1 py-0.5 text-sm focus:border-brand-lilac focus:outline-none disabled:border-transparent disabled:bg-transparent'

  return (
    <Page title={`Travel log — ${periodLabel(log.period)}`}
      subtitle={<>{emp?.full_name} ({emp?.emp_no}) · {branch?.name ?? ''} · <Badge tone={statusTone(log.status)}>{log.status}</Badge></>}
      actions={
        <>
          <Button variant="secondary" onClick={() => nav(readOnly ? '/approvals' : '/my-logs')}>Back</Button>
          {editable && <Button variant="secondary" onClick={() => setShowImport((s) => !s)}>Import Excel template</Button>}
          {editable && <Button variant="secondary" disabled={busy || !dirty} onClick={() => void save()}>Save</Button>}
          {editable && <Button disabled={busy} onClick={() => void submit()}>Submit for approval</Button>}
          {isAdmin && !editable && ['approved', 'rejected', 'submitted'].includes(log.status) && !readOnly && <Button variant="danger" onClick={() => void reopen()}>Re-open</Button>}
        </>
      }
    >
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {showImport && <div className="mb-3"><FileDrop onFile={(f) => void importWorkbook(f)} label="Drop your completed 'Travel Log' workbook (.xls/.xlsm) — the Electronic sheet is read" /></div>}

      <div className="mb-4 grid gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Field label="Vehicle registration"><Input disabled={!editable} value={log.vehicle_reg ?? ''} onChange={(e) => { setLog({ ...log, vehicle_reg: e.target.value.toUpperCase() }); setDirty(true) }} className="w-full" /></Field>
        <Field label="Department"><Input disabled={!editable} value={log.department ?? ''} onChange={(e) => { setLog({ ...log, department: e.target.value }); setDirty(true) }} className="w-full" /></Field>
        <Field label="Manager e-mail" hint={emp?.manager_email ? `default: ${emp.manager_email}` : undefined}><Input disabled={!editable} type="email" value={log.manager_email ?? ''} onChange={(e) => { setLog({ ...log, manager_email: e.target.value }); setDirty(true) }} className="w-full" /></Field>
        <Field label="Opening odometer"><Input disabled={!editable} type="number" value={log.opening_odo ?? totals.firstOpen ?? ''} onChange={(e) => { setLog({ ...log, opening_odo: e.target.value === '' ? null : Number(e.target.value) }); setDirty(true) }} className="w-full" /></Field>
        <Field label="Closing odometer"><Input disabled={!editable} type="number" value={log.closing_odo ?? totals.lastClose ?? ''} onChange={(e) => { setLog({ ...log, closing_odo: e.target.value === '' ? null : Number(e.target.value) }); setDirty(true) }} className="w-full" /></Field>
        <div className="rounded-lg border border-brand-hairline bg-brand-card px-3 py-2 text-sm">
          <div className="flex justify-between"><span>Business km</span><b className="tabular-nums">{num(totals.business, 1)}</b></div>
          <div className="flex justify-between"><span>Private km</span><b className="tabular-nums">{num(totals.priv, 1)}</b></div>
          <div className="flex justify-between border-t border-brand-hairline pt-1"><span>Total · % business</span><b className="tabular-nums">{num(totals.total, 1)} · {totals.pct.toFixed(1)}%</b></div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mb-3"><Alert tone="amber"><b>{warnings.length} check{warnings.length > 1 ? 's' : ''}:</b><ul className="ml-4 list-disc">{warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}{warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}</ul></Alert></div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-navy text-left text-xs uppercase tracking-wide text-white">
                <th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5 text-right">Opening km</th><th className="px-2 py-1.5 text-right">Closing km</th>
                <th className="px-2 py-1.5 text-right">Business km</th><th className="px-2 py-1.5 text-right">Private km</th>
                <th className="px-2 py-1.5">Destination</th><th className="px-2 py-1.5">Reason for visit</th>{editable && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {lines.map((l) => {
                const trip = l.opening_km != null && l.closing_km != null ? l.closing_km - l.opening_km : null
                const bad = trip != null && (trip < 0 || Math.abs(trip - (Number(l.business_km) || 0) - (Number(l.private_km) || 0)) > 0.5)
                return (
                  <tr key={l.key} className={bad ? 'bg-red-50' : (Number(l.business_km) || 0) > 0 ? 'bg-emerald-50/40' : ''}>
                    <td className="w-32 px-1 py-0.5"><input type="date" disabled={!editable} value={l.trip_date ?? ''} onChange={(e) => upd(l.key, { trip_date: e.target.value || null })} className={inp} /></td>
                    <td className="w-28 px-1 py-0.5"><input type="number" disabled={!editable} value={l.opening_km ?? ''} onChange={(e) => upd(l.key, { opening_km: e.target.value === '' ? null : Number(e.target.value) })} className={`${inp} text-right`} /></td>
                    <td className="w-28 px-1 py-0.5"><input type="number" disabled={!editable} value={l.closing_km ?? ''} onChange={(e) => upd(l.key, { closing_km: e.target.value === '' ? null : Number(e.target.value) })} className={`${inp} text-right`} /></td>
                    <td className="w-24 px-1 py-0.5"><input type="number" disabled={!editable} value={l.business_km || ''} onChange={(e) => upd(l.key, { business_km: Number(e.target.value) || 0 })} className={`${inp} text-right font-semibold`} /></td>
                    <td className="w-24 px-1 py-0.5"><input type="number" disabled={!editable} value={l.private_km || ''} onChange={(e) => upd(l.key, { private_km: Number(e.target.value) || 0 })} className={`${inp} text-right`} /></td>
                    <td className="px-1 py-0.5"><input disabled={!editable} value={l.destination ?? ''} onChange={(e) => upd(l.key, { destination: e.target.value })} className={inp} placeholder={(Number(l.business_km) || 0) > 0 ? 'Where did you go?' : ''} /></td>
                    <td className="px-1 py-0.5"><input disabled={!editable} value={l.reason ?? ''} onChange={(e) => upd(l.key, { reason: e.target.value })} className={inp} /></td>
                    {editable && <td className="whitespace-nowrap px-1 text-xs"><button title="Add another trip on this day" onClick={() => addRow(l.key)} className="px-1 text-brand-purple hover:underline">+</button><button title="Remove row" onClick={() => delRow(l.key)} className="px-1 text-slate-400 hover:text-red-600">×</button></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {editable && <p className="mt-2 text-xs text-slate-500">Tip: enter opening and closing km and the business km — private km is worked out for you. Use “+” to add a second trip on the same day.</p>}
      </Card>

      {canDecide && (
        <Card title="Manager decision" className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Comment (required when returning)"><Input value={comment} onChange={(e) => setComment(e.target.value)} className="w-96" /></Field>
            <Button disabled={busy} onClick={() => void decide(true)}>Approve</Button>
            <Button disabled={busy} variant="danger" onClick={() => void decide(false)}>Return to driver</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Submitted {fmtDate(log.submitted_at)}. Approval creates the claim: the fuel portion is paid via payroll, the maintenance portion goes to the driver's accrual.</p>
        </Card>
      )}
    </Page>
  )
}

function blankLine(date: string | null): Omit<Line, 'key'> {
  return { line_no: 0, trip_date: date, opening_km: null, closing_km: null, private_km: 0, business_km: 0, destination: '', reason: '' }
}
function blankMonth(period: string): Line[] {
  const n = daysInPeriod(period)
  return Array.from({ length: n }, (_, i) => ({ ...blankLine(`${period}-${String(i + 1).padStart(2, '0')}`), key: `d${i + 1}` }))
}
