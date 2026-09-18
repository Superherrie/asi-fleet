import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Claim, Employee, TravelLog } from '../../lib/types'
import { currentPeriod, periodLabel, prevPeriod, num, money, fmtDate } from '../../lib/format'
import { loadLogBook, logBookToExcel, logBookToPdf, taxYearLabel, taxYearOf } from '../../lib/logExport'
import { Modal } from '../../components/QueryThread'
import { Page, Card, Button, Badge, statusTone, Table, Td, Money, Select, Empty, Alert, Spinner } from '../../components/ui'

const KIND_LABEL: Record<string, string> = { own: 'own vehicle', second: 'second vehicle', rental: 'rental / replacement' }
const normReg = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export default function MyLogs() {
  const { employee, isAdmin } = useAuth()
  const nav = useNavigate(); const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [logs, setLogs] = useState<TravelLog[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empId, setEmpId] = useState<number | null>(employee?.id ?? null)
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // new-log dialog: which vehicle the log is for (own car, a second car, or a rental while the own car is off the road)
  const [newLog, setNewLog] = useState<{ reg: string; kind: 'own' | 'second' | 'rental'; note: string } | null>(null)
  const [range, setRange] = useState<string>('all'); const [busyExp, setBusyExp] = useState<string | null>(null)

  useEffect(() => { if (employee && empId == null) setEmpId(employee.id) }, [employee, empId])
  useEffect(() => { if (isAdmin) supabase.from('fleet_employees').select('*').eq('active', true).order('full_name').then(({ data }) => setEmployees((data ?? []) as Employee[])) }, [isAdmin])

  async function load() {
    if (empId == null) { setLoading(false); return }
    setLoading(true)
    const [l, c, b] = await Promise.all([
      supabase.from('fleet_travel_logs').select('*').eq('employee_id', empId).order('period', { ascending: false }).order('id'),
      supabase.from('fleet_claims').select('*').eq('employee_id', empId).order('period', { ascending: false }),
      supabase.from('fleet_v_accrual_balances').select('balance').eq('employee_id', empId).maybeSingle(),
    ])
    setLogs((l.data ?? []) as TravelLog[]); setClaims((c.data ?? []) as Claim[]); setBalance(b.data?.balance ?? 0); setLoading(false)
  }
  useEffect(() => { void load() }, [empId]) // eslint-disable-line react-hooks/exhaustive-deps

  const emp = employees.find((e) => e.id === empId) ?? employee
  const ownReg = emp?.vehicle_reg ?? logs.find((l) => (l.vehicle_kind ?? 'own') === 'own')?.vehicle_reg ?? ''
  const monthLogs = logs.filter((l) => l.period === period)

  function startNew() {
    setErr(null)
    const first = monthLogs.length === 0
    setNewLog({ reg: first ? ownReg ?? '' : '', kind: first ? 'own' : 'second', note: '' })
  }
  async function create() {
    if (empId == null || !newLog) return
    const reg = normReg(newLog.reg)
    if (!reg) { setErr('Enter the registration number of the vehicle this log is for.'); return }
    if (monthLogs.some((l) => normReg(l.vehicle_reg ?? '') === reg)) { setErr(`You already have a ${periodLabel(period)} log for ${reg}. Open that one instead.`); return }
    setErr(null)
    // the odometer carries over from the last log of the SAME vehicle
    const prev = logs.find((l) => l.period < period && normReg(l.vehicle_reg ?? '') === reg)
    const { data, error } = await supabase.from('fleet_travel_logs').insert({
      period, employee_id: empId, branch_id: emp?.branch_id ?? null, department: emp?.category ?? null,
      vehicle_reg: reg, vehicle_kind: newLog.kind, vehicle_note: newLog.note.trim() || null,
      opening_odo: prev?.closing_odo ?? null, opening_date: `${period}-01`,
      manager_email: emp?.manager_email ?? null, created_by: (await supabase.auth.getUser()).data.user?.id,
    }).select('id').single()
    if (error) { setErr(error.message.includes('duplicate') ? `A ${periodLabel(period)} log for ${reg} already exists.` : error.message); return }
    setNewLog(null); nav(`/logs/${data.id}`)
  }
  async function withdraw(id: number) {
    if (!confirm('Take this log back? It returns to draft so you can change it, and your manager will no longer see it under Approvals until you submit again.')) return
    setErr(null)
    const { error } = await supabase.rpc('fleet_withdraw_log', { p_log: id })
    if (error) { setErr(error.message); return }
    void load()
  }

  // ---- downloads (SARS logbook): one log, a tax year, or everything
  const taxYears = useMemo(() => [...new Set(logs.map((l) => taxYearOf(l.period)))].sort((a, b) => b - a), [logs])
  async function download(kind: 'xlsx' | 'pdf', ids?: number[], label?: string) {
    if (empId == null) return
    const pick = ids ?? (range === 'all' ? logs : logs.filter((l) => String(taxYearOf(l.period)) === range)).map((l) => l.id)
    if (!pick.length) { setErr('There are no logs in that range to download.'); return }
    setBusyExp(`${kind}${ids ? ids[0] : ''}`); setErr(null)
    try {
      const book = await loadLogBook(empId, pick)
      const lbl = label ?? (range === 'all' ? 'all logs' : taxYearLabel(Number(range)))
      if (kind === 'xlsx') logBookToExcel(book, lbl); else await logBookToPdf(book, lbl)
    } catch (e) { setErr((e as Error).message) }
    setBusyExp(null)
  }

  if (!employee && !isAdmin) return <Alert tone="amber">Your login is not linked to a fleet-card holder. Ask the administrator to link your profile to your employee record.</Alert>

  const periods = [0, 1, 2, 3].map((n) => prevPeriod(currentPeriod(), n - 1))
  const box = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-lilac focus:outline-none'
  return (
    <Page title="My Travel Logs" subtitle="Complete your monthly log, submit it to your manager, and track your claims and maintenance accrual."
      actions={
        <>
          {isAdmin && (
            <Select value={empId ?? ''} onChange={(e) => setEmpId(Number(e.target.value) || null)}>
              <option value="">— select employee —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}
            </Select>
          )}
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</Select>
          <Button onClick={startNew} disabled={empId == null}>{monthLogs.length ? '+ Log for another vehicle' : '+ New log'}</Button>
        </>
      }
    >
      {flash && <div className="mb-3"><Alert tone="green">{flash}</Alert></div>}
      {err && !newLog && <div className="mb-3"><Alert tone="red">{err}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Travel logs" className="lg:col-span-2"
          actions={logs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" value={range} onChange={(e) => setRange(e.target.value)} title="Which logs to download">
                <option value="all">All logs</option>{taxYears.map((y) => <option key={y} value={y}>{taxYearLabel(y)}</option>)}
              </select>
              <Button size="sm" variant="secondary" disabled={!!busyExp} onClick={() => void download('pdf')}>{busyExp === 'pdf' ? 'Building…' : 'Download PDF'}</Button>
              <Button size="sm" variant="secondary" disabled={!!busyExp} onClick={() => void download('xlsx')}>{busyExp === 'xlsx' ? 'Building…' : 'Download Excel'}</Button>
            </div>
          ) : undefined}>
          {loading ? <Spinner /> : logs.length === 0 ? <Empty>No travel logs yet. Click “New log” to start one for {periodLabel(period)}.</Empty> : (
            <>
            <div className="-mx-4 -my-4 divide-y divide-brand-hairline md:hidden">
              {logs.map((l) => (
                <div key={l.id}>
                <button type="button" onClick={() => nav(`/logs/${l.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-card">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-brand-navy">{periodLabel(l.period)}{(l.vehicle_kind ?? 'own') !== 'own' && <span className="ml-2 rounded bg-brand-card px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-purple">{KIND_LABEL[l.vehicle_kind]}</span>}</div>
                    <div className="text-xs text-slate-500">{l.vehicle_reg || 'no vehicle'} · {num(l.business_km)} business km · {num(l.private_km)} private</div>
                    {l.manager_comment && <div className="mt-0.5 text-xs text-amber-700">“{l.manager_comment}”</div>}
                  </div>
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                  <span className="text-sm text-brand-purple">{['draft', 'rejected'].includes(l.status) ? 'Edit' : 'View'} ›</span>
                </button>
                <div className="-mt-2 flex justify-end gap-3 px-4 pb-2 text-xs text-brand-purple">
                  <button type="button" className="underline" disabled={!!busyExp} onClick={() => void download('pdf', [l.id], `${periodLabel(l.period)} ${l.vehicle_reg ?? ''}`)}>PDF</button>
                  <button type="button" className="underline" disabled={!!busyExp} onClick={() => void download('xlsx', [l.id], `${periodLabel(l.period)} ${l.vehicle_reg ?? ''}`)}>Excel</button>
                  {l.status === 'submitted' && <button type="button" className="underline" onClick={() => void withdraw(l.id)}>Withdraw submission</button>}
                </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
            <Table head={['Month', 'Vehicle', 'Business km', 'Private km', 'Status', 'Manager', '']}>
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-brand-card">
                  <Td>{periodLabel(l.period)}</Td>
                  <Td>{l.vehicle_reg}{(l.vehicle_kind ?? 'own') !== 'own' && <div className="text-xs text-brand-purple" title={l.vehicle_note ?? undefined}>{KIND_LABEL[l.vehicle_kind]}</div>}</Td>
                  <Td num>{num(l.business_km)}</Td>
                  <Td num>{num(l.private_km)}</Td>
                  <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge>{l.manager_comment && <div className="text-xs text-slate-500">“{l.manager_comment}”</div>}</Td>
                  <Td className="text-xs text-slate-500">{l.manager_email}{l.approved_at && <div>{fmtDate(l.approved_at)}</div>}</Td>
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="secondary" onClick={() => nav(`/logs/${l.id}`)}>{['draft', 'rejected'].includes(l.status) ? 'Edit' : 'View'}</Button>
                    {l.status === 'submitted' && <Button size="sm" variant="ghost" className="ml-1" onClick={() => void withdraw(l.id)}>Withdraw</Button>}
                    <Button size="sm" variant="ghost" className="ml-1" disabled={!!busyExp} title="Download this log as a PDF" onClick={() => void download('pdf', [l.id], `${periodLabel(l.period)} ${l.vehicle_reg ?? ''}`)}>PDF</Button>
                    <Button size="sm" variant="ghost" disabled={!!busyExp} title="Download this log as an Excel workbook" onClick={() => void download('xlsx', [l.id], `${periodLabel(l.period)} ${l.vehicle_reg ?? ''}`)}>Excel</Button>
                  </Td>
                </tr>
              ))}
            </Table>
            </div>
            </>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Maintenance accrual">
            <div className="font-display text-2xl font-bold text-brand-navy">R {money(balance)}</div>
            <p className="text-xs text-slate-500">The maintenance portion of your claims accumulates here and is paid out against actual maintenance on your vehicle.</p>
          </Card>
          <Card title="Claims">
            {claims.length === 0 ? <Empty>No claims yet.</Empty> : (
              <Table head={['Month', 'km', 'Fuel', 'Maint.', 'Status']}>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <Td>{periodLabel(c.period)}</Td><Td num>{num(c.business_km)}</Td>
                    <Td num><Money v={c.fuel_amount} /></Td><Td num><Money v={c.maint_amount} /></Td>
                    <Td><Badge tone={statusTone(c.status)}>{c.status}</Badge></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </div>

      {newLog && (
        <Modal title={`New travel log — ${periodLabel(period)}`} onClose={() => { setNewLog(null); setErr(null) }}>
          <div className="space-y-3">
            {monthLogs.length > 0 && <p className="text-sm text-slate-600">You already have {monthLogs.length === 1 ? 'a log' : `${monthLogs.length} logs`} for {periodLabel(period)} ({monthLogs.map((l) => l.vehicle_reg).join(', ')}). Each vehicle gets its own log with its own odometer readings, and each is approved and claimed separately.</p>}
            <label className="block text-xs font-medium text-slate-600">Vehicle registration
              <input className={box} placeholder="e.g. KZ18CTGP" value={newLog.reg} onChange={(e) => setNewLog({ ...newLog, reg: e.target.value.toUpperCase() })} autoFocus />
            </label>
            <label className="block text-xs font-medium text-slate-600">This vehicle is
              <select className={box} value={newLog.kind} onChange={(e) => setNewLog({ ...newLog, kind: e.target.value as 'own' | 'second' | 'rental' })}>
                <option value="own">my usual vehicle</option>
                <option value="second">a second vehicle of my own</option>
                <option value="rental">a rental or replacement vehicle (own car in for repairs, accident, etc.)</option>
              </select>
            </label>
            {newLog.kind === 'rental' && <Alert tone="blue">A rental paid for by the company is claimed at the fuel rate only. No maintenance provision is raised on it.</Alert>}
            {newLog.kind !== 'own' && <label className="block text-xs font-medium text-slate-600">Reason / note<input className={box} placeholder="e.g. own car in panel beaters 3–14 Sep" value={newLog.note} onChange={(e) => setNewLog({ ...newLog, note: e.target.value })} /></label>}
            {err && <Alert tone="red">{err}</Alert>}
            <div className="flex items-center gap-2"><Button onClick={() => void create()}>Create log</Button><Button variant="secondary" onClick={() => { setNewLog(null); setErr(null) }}>Cancel</Button></div>
          </div>
        </Modal>
      )}
    </Page>
  )
}
