import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Claim, Employee, TravelLog } from '../../lib/types'
import { currentPeriod, periodLabel, prevPeriod, num, money, fmtDate } from '../../lib/format'
import { Page, Card, Button, Badge, statusTone, Table, Td, Money, Select, Empty, Alert, Spinner } from '../../components/ui'

export default function MyLogs() {
  const { employee, isAdmin } = useAuth()
  const nav = useNavigate()
  const [logs, setLogs] = useState<TravelLog[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [empId, setEmpId] = useState<number | null>(employee?.id ?? null)
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (employee && empId == null) setEmpId(employee.id) }, [employee, empId])
  useEffect(() => { if (isAdmin) supabase.from('fleet_employees').select('*').eq('active', true).order('full_name').then(({ data }) => setEmployees((data ?? []) as Employee[])) }, [isAdmin])

  async function load() {
    if (empId == null) { setLoading(false); return }
    setLoading(true)
    const [l, c, b] = await Promise.all([
      supabase.from('fleet_travel_logs').select('*').eq('employee_id', empId).order('period', { ascending: false }),
      supabase.from('fleet_claims').select('*').eq('employee_id', empId).order('period', { ascending: false }),
      supabase.from('fleet_v_accrual_balances').select('balance').eq('employee_id', empId).maybeSingle(),
    ])
    setLogs((l.data ?? []) as TravelLog[]); setClaims((c.data ?? []) as Claim[]); setBalance(b.data?.balance ?? 0); setLoading(false)
  }
  useEffect(() => { void load() }, [empId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (empId == null) return
    setErr(null)
    const emp = employees.find((e) => e.id === empId) ?? employee
    const prev = logs.find((l) => l.period < period)
    const { data, error } = await supabase.from('fleet_travel_logs').insert({
      period, employee_id: empId, branch_id: emp?.branch_id ?? null, department: emp?.category ?? null,
      vehicle_reg: prev?.vehicle_reg ?? null, opening_odo: prev?.closing_odo ?? null, opening_date: `${period}-01`,
      manager_email: emp?.manager_email ?? null, created_by: (await supabase.auth.getUser()).data.user?.id,
    }).select('id').single()
    if (error) { setErr(error.message.includes('duplicate') ? `A log for ${periodLabel(period)} already exists.` : error.message); return }
    nav(`/logs/${data.id}`)
  }

  if (!employee && !isAdmin) return <Alert tone="amber">Your login is not linked to a fleet-card holder. Ask the administrator to link your profile to your employee record.</Alert>

  const periods = [0, 1, 2, 3].map((n) => prevPeriod(currentPeriod(), n - 1))
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
          <Button onClick={() => void create()} disabled={empId == null}>+ New log</Button>
        </>
      }
    >
      {err && <div className="mb-3"><Alert tone="red">{err}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Travel logs" className="lg:col-span-2">
          {loading ? <Spinner /> : logs.length === 0 ? <Empty>No travel logs yet. Click “New log” to start one for {periodLabel(period)}.</Empty> : (
            <Table head={['Month', 'Vehicle', 'Business km', 'Private km', 'Status', 'Manager', '']}>
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-brand-card">
                  <Td>{periodLabel(l.period)}</Td>
                  <Td>{l.vehicle_reg}</Td>
                  <Td num>{num(l.business_km)}</Td>
                  <Td num>{num(l.private_km)}</Td>
                  <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge>{l.manager_comment && <div className="text-xs text-slate-500">“{l.manager_comment}”</div>}</Td>
                  <Td className="text-xs text-slate-500">{l.manager_email}{l.approved_at && <div>{fmtDate(l.approved_at)}</div>}</Td>
                  <Td><Button size="sm" variant="secondary" onClick={() => nav(`/logs/${l.id}`)}>{['draft', 'rejected'].includes(l.status) ? 'Edit' : 'View'}</Button></Td>
                </tr>
              ))}
            </Table>
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
    </Page>
  )
}
