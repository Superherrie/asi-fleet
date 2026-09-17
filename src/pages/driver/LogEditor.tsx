import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null)
  const [comment, setComment] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [openingHint, setOpeningHint] = useState<string | null>(null)
  const [mailOn, setMailOn] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // phone view: blank days stay collapsed until tapped
  const toggleDay = (k: string) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  useEffect(() => { void supabase.from('fleet_settings').select('value').eq('key', 'notifications_enabled').maybeSingle().then(({ data }) => setMailOn(data?.value === 'true')) }, [])

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
      let rows: Line[] = fillMonth(existing, l.period)   // every day of the month is shown; saved trips slot into their days
      let opening: number | null = l.opening_odo ?? null
      if (opening == null) {
        // carry the closing odometer of this person's previous log (latest month before this one)
        const { data: prev } = await supabase.from('fleet_travel_logs').select('period,closing_odo').eq('employee_id', l.employee_id).lt('period', l.period).not('closing_odo', 'is', null).order('period', { ascending: false }).limit(1).maybeSingle()
        if (prev?.closing_odo != null) { opening = Number(prev.closing_odo); setOpeningHint(`carried from your ${periodLabel(prev.period)} log`); l.opening_odo = opening; setLog({ ...(l as TravelLog) }); setDirty(true) }
      }
      if (opening != null && rows.length && rows[0].opening_km == null) { rows = rows.map((r, i) => (i === 0 ? { ...r, opening_km: opening } : r)); setDirty(true) }
      setLines(rows)
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

  /** private km = odometer difference − business km (unless private was the field edited) */
  const derivePrivate = (n: Line, patch: Partial<Line>) => {
    if (!('private_km' in patch) && n.opening_km != null && n.closing_km != null) {
      const trip = n.closing_km - n.opening_km
      if (trip >= 0) n.private_km = round2(Math.max(0, trip - (Number(n.business_km) || 0)))
    }
    return n
  }
  function upd(key: string, patch: Partial<Line>) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key); if (i < 0) return ls
      const old = ls[i]; const n = derivePrivate({ ...old, ...patch }, patch)
      const out = ls.map((l, j) => (j === i ? n : l))
      // every day's opening km follows the previous day's closing km — overwrite the next row's opening when it is blank or was carried from the old closing
      if ('closing_km' in patch && n.closing_km != null && i + 1 < out.length) {
        const nx = out[i + 1]
        if (nx.opening_km == null || nx.opening_km === old.closing_km) out[i + 1] = derivePrivate({ ...nx, opening_km: n.closing_km }, {})
      }
      return out
    })
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
  const saveRef = useRef(save); saveRef.current = save
  useEffect(() => {
    if (!dirty || !editable || !log || busy) return
    const t = setTimeout(() => { void saveRef.current(true).then((ok) => { if (ok) setSavedAt(new Date()) }) }, 1500)
    return () => clearTimeout(t)
  }, [dirty, lines, log, editable, busy])
  // best effort when the tab is closed / phone locked while a change is still pending
  useEffect(() => {
    const flush = () => { if (dirty && editable && !busy) void saveRef.current(true) }
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush) }
  }, [dirty, editable, busy])

  async function submit() {
    if (!log) return
    if (!log.manager_email?.trim() && !emp?.manager_email && !emp?.manager_employee_id) { setMsg({ tone: 'amber', text: 'Enter your manager’s e-mail address before submitting.' }); return }
    if (warnings.length && !confirm(`There are ${warnings.length} warning(s) on this log. Submit anyway?`)) return
    if (!(await save(true))) return
    setBusy(true)
    const { error } = await supabase.rpc('fleet_submit_log', { p_log: log.id })
    setBusy(false)
    if (error) { setMsg({ tone: 'red', text: error.message }); return }
    if (mailOn) void supabase.functions.invoke('fleet-notify').catch(() => {})
    nav('/my-logs', { state: { flash: mailOn ? 'Submitted — your manager has been e-mailed.' : `Submitted. ${log.manager_email ? log.manager_email.split('@')[0].replace('.', ' ') : 'Your manager'} will see it under Approvals the next time they sign in; e-mail notifications are switched off for now.` } })
  }
  async function decide(approve: boolean) {
    if (!log) return
    if (!approve && !comment.trim()) { setMsg({ tone: 'amber', text: 'Please give a reason when returning a log.' }); return }
    setBusy(true)
    const { error } = await supabase.rpc('fleet_decide_log', { p_log: log.id, p_approve: approve, p_comment: comment || null })
    setBusy(false)
    if (error) { setMsg({ tone: 'red', text: error.message }); return }
    if (mailOn) void supabase.functions.invoke('fleet-notify').catch(() => {})
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
  const minp = 'mt-0.5 w-full rounded-md border border-slate-300 px-2 py-2 text-base focus:border-brand-lilac focus:outline-none disabled:border-slate-100 disabled:bg-slate-50'
  const hasContent = (l: Line) => l.opening_km != null || l.closing_km != null || !!l.business_km || !!l.private_km || !!l.destination?.trim() || !!l.reason?.trim()
  const dayMonth = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : 'no date')
  const saveStatus = dirty ? (busy ? 'Saving…' : 'Unsaved changes') : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Changes save automatically'

  return (
    <Page title={`Travel log — ${periodLabel(log.period)}`}
      subtitle={<>{emp?.full_name} ({emp?.emp_no}) · {branch?.name ?? ''} · <Badge tone={statusTone(log.status)}>{log.status}</Badge></>}
      actions={
        <>
          <Button variant="secondary" onClick={() => { void (async () => { if (editable && dirty) await save(true); nav(readOnly ? '/approvals' : '/my-logs') })() }}>Back</Button>
          {editable && <Button variant="secondary" className="hidden md:inline-block" onClick={() => setShowImport((s) => !s)}>Import Excel template</Button>}
          {editable && (dirty ? <Button variant="secondary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save now'}</Button> : <span className="self-center text-xs text-slate-500">{savedAt ? `All changes saved ${savedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Changes save automatically'}</span>)}
          {editable && <Button disabled={busy} className="hidden md:inline-block" onClick={() => void submit()}>Submit for approval</Button>}
          {isAdmin && !editable && ['approved', 'rejected', 'submitted'].includes(log.status) && !readOnly && <Button variant="danger" onClick={() => void reopen()}>Re-open</Button>}
        </>
      }
    >
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {showImport && <div className="mb-3"><FileDrop onFile={(f) => void importWorkbook(f)} label="Drop your completed 'Travel Log' workbook (.xls/.xlsm) — the Electronic sheet is read" /></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Field label="Vehicle registration"><Input disabled={!editable} value={log.vehicle_reg ?? ''} onChange={(e) => { setLog({ ...log, vehicle_reg: e.target.value.toUpperCase() }); setDirty(true) }} className="w-full" /></Field>
        <Field label="Department"><Input disabled={!editable} value={log.department ?? ''} onChange={(e) => { setLog({ ...log, department: e.target.value }); setDirty(true) }} className="w-full" /></Field>
        <div className="col-span-2 md:col-span-1"><Field label="Manager e-mail" hint={emp?.manager_email ? `default: ${emp.manager_email}` : undefined}><Input disabled={!editable} type="email" value={log.manager_email ?? ''} onChange={(e) => { setLog({ ...log, manager_email: e.target.value }); setDirty(true) }} className="w-full" /></Field></div>
        <Field label="Opening odometer" hint={openingHint ?? undefined}><Input disabled={!editable} type="number" value={log.opening_odo ?? totals.firstOpen ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); const oldV = log.opening_odo; setLog({ ...log, opening_odo: v }); setOpeningHint(null); setLines((ls) => (ls.length && (ls[0].opening_km == null || ls[0].opening_km === oldV) ? ls.map((l, i) => (i === 0 ? derivePrivate({ ...l, opening_km: v }, {}) : l)) : ls)); setDirty(true) }} className="w-full" /></Field>
        <Field label="Closing odometer"><Input disabled={!editable} type="number" value={log.closing_odo ?? totals.lastClose ?? ''} onChange={(e) => { setLog({ ...log, closing_odo: e.target.value === '' ? null : Number(e.target.value) }); setDirty(true) }} className="w-full" /></Field>
        <div className="col-span-2 rounded-lg border border-brand-hairline bg-brand-card px-3 py-2 text-sm md:col-span-1">
          <div className="flex justify-between"><span>Business km</span><b className="tabular-nums">{num(totals.business, 1)}</b></div>
          <div className="flex justify-between"><span>Private km</span><b className="tabular-nums">{num(totals.priv, 1)}</b></div>
          <div className="flex justify-between border-t border-brand-hairline pt-1"><span>Total · % business</span><b className="tabular-nums">{num(totals.total, 1)} · {totals.pct.toFixed(1)}%</b></div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mb-3"><Alert tone="amber"><b>{warnings.length} check{warnings.length > 1 ? 's' : ''}:</b><ul className="ml-4 list-disc">{warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}{warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}</ul></Alert></div>
      )}

      <Card className={editable ? 'mb-16 md:mb-0' : ''}>
        {/* phone: one card per day; blank days collapse to a single line until tapped */}
        <div className="-mx-4 -my-4 divide-y divide-brand-hairline md:hidden">
          {lines.map((l) => {
            const trip = l.opening_km != null && l.closing_km != null ? l.closing_km - l.opening_km : null
            const bad = trip != null && (trip < 0 || Math.abs(trip - (Number(l.business_km) || 0) - (Number(l.private_km) || 0)) > 0.5)
            const day = dayInfo(l.trip_date); const has = hasContent(l); const open = has || expanded.has(l.key)
            const tone = bad ? 'bg-red-50' : (Number(l.business_km) || 0) > 0 ? 'bg-emerald-50/40' : day.weekend ? 'bg-slate-100/80' : day.holiday ? 'bg-amber-50/70' : ''
            return (
              <div key={l.key} className={`px-3 py-2 ${tone}`}>
                <div className="flex items-center gap-2">
                  <button type="button" className="flex min-h-9 flex-1 items-center gap-2 text-left" onClick={() => { if (!has) toggleDay(l.key) }}>
                    <span className={`w-8 text-xs font-semibold ${day.weekend ? 'text-slate-500' : day.holiday ? 'text-amber-700' : 'text-slate-600'}`}>{day.label}</span>
                    <span className="font-medium">{dayMonth(l.trip_date)}</span>
                    {day.holiday && <span className="truncate text-xs text-amber-700">{day.holiday}</span>}
                    {!open && editable && <span className="ml-auto text-xs text-brand-purple">add trip</span>}
                    {open && has && trip != null && <span className={`ml-auto text-xs tabular-nums ${bad ? 'text-red-600' : 'text-slate-500'}`}>{num(trip)} km</span>}
                  </button>
                  {editable && open && <button type="button" title="Add another trip on this day" onClick={() => addRow(l.key)} className="rounded-md border border-brand-purple/40 px-2 py-1 text-sm text-brand-purple">+</button>}
                  {editable && open && <button type="button" title={has ? 'Clear this day' : 'Collapse'} onClick={() => { if (has) { if (l.key.startsWith('d')) upd(l.key, { opening_km: null, closing_km: null, business_km: 0, private_km: 0, destination: '', reason: '' }); else delRow(l.key) } else toggleDay(l.key) }} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500">×</button>}
                </div>
                {open && (
                  <div className="mt-1 grid grid-cols-2 gap-2 pb-1">
                    <label className="text-xs text-slate-500">Opening km<input type="number" inputMode="decimal" disabled={!editable} value={l.opening_km ?? ''} onChange={(e) => upd(l.key, { opening_km: e.target.value === '' ? null : Number(e.target.value) })} className={`${minp} text-right`} /></label>
                    <label className="text-xs text-slate-500">Closing km<input type="number" inputMode="decimal" disabled={!editable} value={l.closing_km ?? ''} onChange={(e) => upd(l.key, { closing_km: e.target.value === '' ? null : Number(e.target.value) })} className={`${minp} text-right`} /></label>
                    <label className="text-xs text-slate-500">Business km<input type="number" inputMode="decimal" disabled={!editable} value={l.business_km || ''} onChange={(e) => upd(l.key, { business_km: Number(e.target.value) || 0 })} className={`${minp} text-right font-semibold`} /></label>
                    <label className="text-xs text-slate-500">Private km<input type="number" inputMode="decimal" disabled={!editable} value={l.private_km || ''} onChange={(e) => upd(l.key, { private_km: Number(e.target.value) || 0 })} className={`${minp} text-right`} /></label>
                    <label className="col-span-2 text-xs text-slate-500">Destination<input disabled={!editable} value={l.destination ?? ''} onChange={(e) => upd(l.key, { destination: e.target.value })} className={minp} placeholder={(Number(l.business_km) || 0) > 0 ? 'Where did you go?' : ''} /></label>
                    <label className="col-span-2 text-xs text-slate-500">Reason for visit<input disabled={!editable} value={l.reason ?? ''} onChange={(e) => upd(l.key, { reason: e.target.value })} className={minp} /></label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-navy text-left text-xs uppercase tracking-wide text-white">
                <th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Day</th><th className="px-2 py-1.5 text-right">Opening km</th><th className="px-2 py-1.5 text-right">Closing km</th>
                <th className="px-2 py-1.5 text-right">Business km</th><th className="px-2 py-1.5 text-right">Private km</th>
                <th className="px-2 py-1.5">Destination</th><th className="px-2 py-1.5">Reason for visit</th>{editable && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {lines.map((l) => {
                const trip = l.opening_km != null && l.closing_km != null ? l.closing_km - l.opening_km : null
                const bad = trip != null && (trip < 0 || Math.abs(trip - (Number(l.business_km) || 0) - (Number(l.private_km) || 0)) > 0.5)
                const day = dayInfo(l.trip_date)
                const rowClass = bad ? 'bg-red-50' : (Number(l.business_km) || 0) > 0 ? 'bg-emerald-50/40' : day.weekend ? 'bg-slate-100/80' : day.holiday ? 'bg-amber-50/70' : ''
                return (
                  <tr key={l.key} className={rowClass}>
                    <td className="w-32 px-1 py-0.5"><input type="date" disabled={!editable} value={l.trip_date ?? ''} onChange={(e) => upd(l.key, { trip_date: e.target.value || null })} className={inp} /></td>
                    <td className={`w-16 whitespace-nowrap px-2 py-0.5 text-xs ${day.weekend ? 'font-semibold text-slate-500' : day.holiday ? 'font-semibold text-amber-700' : 'text-slate-600'}`} title={day.holiday ?? undefined}>{day.label}{day.holiday ? ' ✦' : ''}</td>
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
        {editable && <p className="mt-2 hidden text-xs text-slate-500 md:block">Tip: enter opening and closing km and the business km — private km is worked out for you. Use “+” to add a second trip on the same day.</p>}
      </Card>
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-brand-hairline bg-white/95 px-4 py-2 backdrop-blur md:hidden">
          <span className="flex-1 truncate text-xs text-slate-500">{saveStatus}</span>
          {dirty && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>Save</Button>}
          <Button disabled={busy} onClick={() => void submit()}>Submit</Button>
        </div>
      )}

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
/** Every calendar day of the month in order, with the saved trip lines slotted into their days (several trips on one day stay together);
 *  saving only stores lines with content, so the blank days are re-created here each time the log opens. */
function fillMonth(existing: Line[], period: string): Line[] {
  const byDay = new Map<string, Line[]>(); const undated: Line[] = []
  for (const l of existing) { if (l.trip_date && l.trip_date.startsWith(period)) byDay.set(l.trip_date, [...(byDay.get(l.trip_date) ?? []), l]); else undated.push(l) }
  const out: Line[] = []
  for (const b of blankMonth(period)) out.push(...(byDay.get(b.trip_date!) ?? [b]))
  return [...out, ...undated]
}
function blankMonth(period: string): Line[] {
  const n = daysInPeriod(period)
  return Array.from({ length: n }, (_, i) => ({ ...blankLine(`${period}-${String(i + 1).padStart(2, '0')}`), key: `d${i + 1}` }))
}

/** Weekday label, weekend flag and South African public holiday name for a trip date. */
function dayInfo(d: string | null): { label: string; weekend: boolean; holiday: string | null } {
  if (!d) return { label: '', weekend: false, holiday: null }
  const dt = new Date(d + 'T00:00:00'); if (isNaN(dt.getTime())) return { label: '', weekend: false, holiday: null }
  const dow = dt.getDay()
  return { label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow], weekend: dow === 0 || dow === 6, holiday: saHoliday(dt) }
}
/** Fixed-date SA public holidays (+ Sunday → Monday rule) and the Easter-based ones. */
function saHoliday(dt: Date): string | null {
  const y = dt.getFullYear(); const key = (m: number, d: number) => `${m}-${d}`; const k = key(dt.getMonth() + 1, dt.getDate())
  const fixed: Record<string, string> = { '1-1': "New Year's Day", '3-21': 'Human Rights Day', '4-27': 'Freedom Day', '5-1': "Workers' Day", '6-16': 'Youth Day', '8-9': "National Women's Day", '9-24': 'Heritage Day', '12-16': 'Day of Reconciliation', '12-25': 'Christmas Day', '12-26': 'Day of Goodwill' }
  if (fixed[k]) return fixed[k]
  // holiday on a Sunday → the Monday is a public holiday
  if (dt.getDay() === 1) { const prev = new Date(dt); prev.setDate(prev.getDate() - 1); const pk = key(prev.getMonth() + 1, prev.getDate()); if (fixed[pk]) return `${fixed[pk]} (observed)` }
  // Easter (Anonymous Gregorian algorithm): Good Friday = Easter − 2, Family Day = Easter + 1
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), j = c % 4, l = (32 + 2 * e + 2 * i - h - j) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  const easter = new Date(y, month - 1, day); const diff = Math.round((dt.getTime() - easter.getTime()) / 86400000)
  if (diff === -2) return 'Good Friday'; if (diff === 1) return 'Family Day'
  return null
}
