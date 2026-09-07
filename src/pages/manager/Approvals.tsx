import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Employee, TravelLog } from '../../lib/types'
import { fmtDate, num, periodLabel } from '../../lib/format'
import { Page, Card, Button, Badge, statusTone, Table, Td, Empty, Spinner, Select } from '../../components/ui'

export default function Approvals() {
  const nav = useNavigate()
  const { isAdmin } = useAuth()
  const [logs, setLogs] = useState<TravelLog[]>([])
  const [emps, setEmps] = useState<Record<number, Employee>>({})
  const [filter, setFilter] = useState<'submitted' | 'all'>('submitted')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      let q = supabase.from('fleet_travel_logs').select('*').order('submitted_at', { ascending: false })
      if (filter === 'submitted') q = q.eq('status', 'submitted')
      else q = q.neq('status', 'draft')
      const { data } = await q.limit(300)
      const ls = (data ?? []) as TravelLog[]
      const ids = [...new Set(ls.map((l) => l.employee_id))]
      const { data: es } = ids.length ? await supabase.from('fleet_employees').select('*').in('id', ids) : { data: [] }
      setEmps(Object.fromEntries(((es ?? []) as Employee[]).map((e) => [e.id, e])))
      setLogs(ls); setLoading(false)
    })()
  }, [filter])

  return (
    <Page title="Travel log approvals" subtitle={isAdmin ? 'All submitted logs (admin view).' : 'Logs submitted by the people who report to you.'}
      actions={<Select value={filter} onChange={(e) => setFilter(e.target.value as 'submitted' | 'all')}><option value="submitted">Awaiting approval</option><option value="all">All (incl. decided)</option></Select>}>
      <Card>
        {loading ? <Spinner /> : logs.length === 0 ? <Empty>Nothing waiting for you.</Empty> : (
          <Table head={['Employee', 'Month', 'Vehicle', 'Business km', 'Private km', '% business', 'Submitted', 'Status', '']}>
            {logs.map((l) => {
              const e = emps[l.employee_id]; const tot = l.business_km + l.private_km
              return (
                <tr key={l.id} className="hover:bg-brand-card">
                  <Td><div className="font-medium">{e?.full_name ?? l.employee_id}</div><div className="text-xs text-slate-500">{e?.emp_no} · {e?.category}</div></Td>
                  <Td>{periodLabel(l.period)}</Td><Td>{l.vehicle_reg}</Td>
                  <Td num>{num(l.business_km, 1)}</Td><Td num>{num(l.private_km, 1)}</Td><Td num>{tot ? ((l.business_km / tot) * 100).toFixed(0) : '–'}%</Td>
                  <Td className="text-xs">{fmtDate(l.submitted_at)}</Td>
                  <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td>
                  <Td><Button size="sm" onClick={() => nav(`/approvals/${l.id}`)}>{l.status === 'submitted' ? 'Review' : 'View'}</Button></Td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
    </Page>
  )
}
