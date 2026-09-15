import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters } from '../../hooks/useMasters'
import type { Claim, Employee, TravelLog } from '../../lib/types'
import { currentPeriod, fmtDate, money, num, periodLabel, prevPeriod } from '../../lib/format'
import { Page, Card, Button, PeriodPicker, Table, Td, Money, Alert, Badge, statusTone, Input, Select, Spinner, Stat, Empty } from '../../components/ui'

interface Notif { id: number; kind: string; to_email: string; status: string; created_at: string; sent_at: string | null; error: string | null; log_id: number | null }
type LogState = 'not received' | 'draft' | 'submitted' | 'approved' | 'rejected'
interface Row { e: Employee; log: TravelLog | null; state: LogState; claim: Claim | null; mails: Notif[]; managerEmail: string; managerName: string }

/** Every traveller (card holder with a claim rate) and where their travel log / claim stands for the month. */
export default function Travellers() {
  const m = useMasters()
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  const [logs, setLogs] = useState<TravelLog[]>([]); const [claims, setClaims] = useState<Claim[]>([]); const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<number | 'all' | null>(null); const [msg, setMsg] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null)
  const [q, setQ] = useState(''); const [state, setState] = useState<'all' | LogState | 'awaiting'>('all'); const [branch, setBranch] = useState<number | ''>('')

  const load = async () => {
    setLoading(true)
    const [l, c, n] = await Promise.all([
      supabase.from('fleet_travel_logs').select('*').eq('period', period),
      supabase.from('fleet_claims').select('*').eq('period', period),
      supabase.from('fleet_notifications').select('id,kind,to_email,status,created_at,sent_at,error,log_id').order('created_at', { ascending: false }).limit(1000),
    ])
    setLogs((l.data ?? []) as TravelLog[]); setClaims((c.data ?? []) as Claim[]); setNotifs((n.data ?? []) as Notif[]); setLoading(false)
  }
  useEffect(() => { void load() }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(() => {
    const travellers = m.employees.filter((e) => e.active && (e.fuel_rate || e.maint_rate || logs.some((l) => l.employee_id === e.id)))
    return travellers.map((e) => {
      const log = logs.filter((l) => l.employee_id === e.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
      const claim = claims.find((c) => c.employee_id === e.id) ?? null
      const mgr = e.manager_employee_id ? m.employees.find((x) => x.id === e.manager_employee_id) : null
      const managerEmail = (log?.manager_email || e.manager_email || mgr?.email || '')
      const mails = notifs.filter((n) => (log && n.log_id === log.id) || (!log && n.kind === 'log_reminder' && n.to_email === e.email && n.created_at >= `${period}-01`))
      return { e, log, state: (log?.status ?? 'not received') as LogState, claim, mails, managerEmail, managerName: mgr?.full_name ?? (managerEmail ? managerEmail : '') }
    }).sort((a, b) => (a.e.emp_no ?? '').localeCompare(b.e.emp_no ?? ''))
  }, [m.employees, logs, claims, notifs, period])

  const shown = rows.filter((r) => (state === 'all' || (state === 'awaiting' ? r.state === 'submitted' : r.state === state)) && (branch === '' || r.e.branch_id === branch) && (!q || `${r.e.full_name} ${r.e.emp_no} ${r.managerName} ${m.bm.code(r.e.branch_id)}`.toLowerCase().includes(q.toLowerCase())))
  const count = (s: LogState) => rows.filter((r) => r.state === s).length
  const paid = rows.filter((r) => r.claim && r.claim.status !== 'pending').length
  const noManager = rows.filter((r) => !r.managerEmail).length; const noMail = rows.filter((r) => !r.e.email).length
  const stuck = notifs.filter((n) => n.status === 'pending').length; const failed = notifs.filter((n) => n.status === 'failed').length

  async function remind(r: Row) {
    setBusy(r.e.id); setMsg(null)
    const { error } = await supabase.rpc('fleet_remind_log', { p_employee: r.e.id, p_period: period })
    if (error) setMsg({ tone: 'red', text: error.message }); else { await supabase.functions.invoke('fleet-notify').catch(() => {}); setMsg({ tone: 'green', text: `Reminder queued for ${r.e.full_name}.` }); await load() }
    setBusy(null)
  }
  async function remindAll() {
    const targets = shown.filter((r) => r.state === 'not received' && r.e.email); if (!targets.length) return
    if (!confirm(`Send a reminder to ${targets.length} people whose ${periodLabel(period)} log has not been received?`)) return
    setBusy('all'); let n = 0
    for (const r of targets) { const { error } = await supabase.rpc('fleet_remind_log', { p_employee: r.e.id, p_period: period }); if (!error) n++ }
    await supabase.functions.invoke('fleet-notify').catch(() => {}); setMsg({ tone: 'green', text: `${n} reminder${n === 1 ? '' : 's'} queued.` }); await load(); setBusy(null)
  }
  async function resend() { setBusy('all'); const { data, error } = await supabase.functions.invoke('fleet-notify'); setMsg(error ? { tone: 'red', text: error.message } : { tone: (data as { error?: string })?.error ? 'amber' : 'green', text: (data as { error?: string })?.error ?? `Sent ${(data as { sent?: number })?.sent ?? 0} queued mail(s).` }); await load(); setBusy(null) }

  const mailBadge = (r: Row) => {
    const last = r.mails[0]; if (!last) return <span className="text-xs text-slate-400">—</span>
    const label = { log_submitted: 'to manager', log_approved: 'approved mail', log_rejected: 'returned mail', log_reminder: 'reminder' }[last.kind] ?? last.kind
    return <span className="text-xs" title={`${last.to_email} · ${fmtDate(last.created_at)}${last.error ? ' · ' + last.error : ''}`}><Badge tone={last.status === 'sent' ? 'teal' : last.status === 'failed' ? 'red' : 'amber'}>{last.status}</Badge> {label}</span>
  }

  return (
    <Page title="Travellers" subtitle="Everyone who claims travel: where their log and claim stand for the month, who approves it, and whether the e-mails went out." actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      {m.loading || loading ? <Spinner /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Travellers" value={rows.length} sub={`with a claim rate or a ${periodLabel(period)} log`} />
            <Stat label="Not received" value={count('not received')} sub={`${count('draft')} still in draft`} tone="pink" />
            <Stat label="Awaiting approval" value={count('submitted')} sub="submitted, manager to decide" tone="purple" />
            <Stat label="Approved" value={count('approved')} sub={`${count('rejected')} returned to driver`} tone="teal" />
            <Stat label="Claims paid / exported" value={paid} sub={`of ${rows.filter((r) => r.claim).length} claims · R ${money(rows.reduce((s, r) => s + (r.claim?.total_amount ?? 0), 0))}`} />
            <Stat label="E-mails queued" value={stuck} sub={failed ? `${failed} failed` : 'waiting to be sent'} tone={stuck ? 'pink' : undefined} />
          </div>
          {(noManager > 0 || noMail > 0 || stuck > 0) && (
            <div className="mb-3 space-y-2">
              {noManager > 0 && <Alert tone="amber">{noManager} traveller{noManager > 1 ? 's have' : ' has'} no manager on file, so a submitted log has nobody to go to. Set the manager on Fleet → Card holders (the Manager column, or a manager e-mail).</Alert>}
              {noMail > 0 && <Alert tone="amber">{noMail} traveller{noMail > 1 ? 's have' : ' has'} no e-mail address, so they cannot log in or be reminded.</Alert>}
              {stuck > 0 && <Alert tone="amber">{stuck} e-mail{stuck > 1 ? 's are' : ' is'} queued but not sent. Sending needs the mail service key (RESEND_API_KEY) configured on the server. <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void resend()}>Try sending now</Button></Alert>}
            </div>
          )}
          {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input placeholder="Search name, number, manager, branch…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
            <Select value={state} onChange={(e) => setState(e.target.value as typeof state)}><option value="all">All statuses</option><option value="not received">Not received</option><option value="draft">Draft</option><option value="awaiting">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Returned</option></Select>
            <Select value={branch} onChange={(e) => setBranch(e.target.value === '' ? '' : Number(e.target.value))}><option value="">All branches</option>{m.branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} – {b.name}</option>)}</Select>
            <span className="text-sm text-slate-500">{shown.length} of {rows.length}</span>
            <Button variant="secondary" size="sm" disabled={busy !== null || !shown.some((r) => r.state === 'not received' && r.e.email)} onClick={() => void remindAll()} className="ml-auto">Remind all not received{state !== 'all' || branch !== '' || q ? ' (filtered)' : ''}</Button>
          </div>
          <Card>
            {shown.length === 0 ? <Empty>No travellers match.</Empty> : (
              <Table head={['Emp', 'Traveller', 'Branch', 'Manager', 'Log', 'Business km', 'Submitted', 'Decided', 'Claim', 'Claim status', 'Last e-mail', '']}>
                {shown.map((r) => (
                  <tr key={r.e.id} className={r.state === 'not received' ? 'bg-pink-50/40' : r.state === 'submitted' ? 'bg-amber-50/40' : ''}>
                    <Td className="text-xs text-slate-500">{r.e.emp_no}</Td>
                    <Td><div className="font-medium">{r.e.full_name}</div><div className="text-xs text-slate-500">{r.e.email ?? <span className="text-red-600">no e-mail</span>}</div></Td>
                    <Td>{m.bm.code(r.e.branch_id)}</Td>
                    <Td className="text-xs">{r.managerName || <span className="text-red-600">none</span>}</Td>
                    <Td><Badge tone={r.state === 'not received' ? 'red' : statusTone(r.state)}>{r.state}</Badge></Td>
                    <Td num>{r.log ? num(r.log.business_km) : ''}</Td>
                    <Td className="text-xs">{r.log?.submitted_at ? fmtDate(r.log.submitted_at) : ''}</Td>
                    <Td className="text-xs">{r.log?.approved_at ? fmtDate(r.log.approved_at) : ''}{r.log?.manager_comment ? <div className="text-slate-400" title={r.log.manager_comment}>“{r.log.manager_comment.slice(0, 30)}{r.log.manager_comment.length > 30 ? '…' : ''}”</div> : null}</Td>
                    <Td num>{r.claim ? <Money v={r.claim.total_amount} /> : ''}</Td>
                    <Td>{r.claim ? <Badge tone={statusTone(r.claim.status)}>{r.claim.status}</Badge> : ''}</Td>
                    <Td>{mailBadge(r)}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {r.log && <Link to={r.state === 'submitted' ? `/approvals/${r.log.id}` : `/logs/${r.log.id}`} className="text-brand-purple hover:underline">open</Link>}
                      {r.state === 'not received' && r.e.email && <button type="button" className="ml-2 text-brand-purple hover:underline" disabled={busy !== null} onClick={() => void remind(r)}>{busy === r.e.id ? 'sending…' : 'remind'}</button>}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
