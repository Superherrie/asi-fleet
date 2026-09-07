import { Fragment, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters, type Masters } from '../../hooks/useMasters'
import type { AccrualTxn, Card as CardT, Claim, Deduction, FaLine } from '../../lib/types'
import { currentPeriod, fmtDate, money, num, periodLabel, prevPeriod, round2 } from '../../lib/format'
import { downloadWorkbook } from '../../lib/xlsx'
import { downloadPayrollWorkbook, type PayrollRow } from '../../lib/payrollSheet'
import { Page, Card, Button, PeriodPicker, Table, Td, Money, Alert, Badge, statusTone, Empty, Spinner, Select, Input, Field, Stat } from '../../components/ui'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`

export default function Payroll() {
  const m = useMasters()
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  return (
    <Page title="Payroll" subtitle="Salary deductions for staff fleet cards, travel-claim sheets, and the maintenance accrual per person." actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      <nav className="mb-4 flex gap-1 border-b border-brand-hairline pb-2"><NavLink to="/payroll/deductions" className={tab}>Deductions</NavLink><NavLink to="/payroll/claims" className={tab}>Claims</NavLink><NavLink to="/payroll/accrual" className={tab}>Maintenance accrual</NavLink></nav>
      {m.loading ? <Spinner /> : (
        <Routes>
          <Route index element={<Navigate to="deductions" replace />} />
          <Route path="deductions" element={<Deductions m={m} period={period} />} />
          <Route path="claims" element={<Claims m={m} period={period} />} />
          <Route path="accrual" element={<Accrual m={m} period={period} />} />
        </Routes>
      )}
    </Page>
  )
}

const empOf = (m: Masters, id: number) => m.employees.find((e) => e.id === id)

// ---------------------------------------------------------------- Deductions
function Deductions({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<Deduction[]>([]); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const load = () => supabase.from('fleet_deductions').select('*').eq('period', period).then(({ data }) => setRows((data ?? []) as Deduction[]))
  useEffect(() => { void load() }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, r) => s + r.amount, 0)

  async function rebuild() {
    setBusy(true); setMsg(null)
    const { data: lines } = await supabase.from('fleet_fa_lines').select('*').eq('period', period)
    const ded = ((lines ?? []) as FaLine[]).map((l) => { const c = m.cards.find((x) => x.id === l.card_id); return c?.holder_type === 'staff' && c.deduct !== false && c.employee_id ? { period, employee_id: c.employee_id, card_id: c.id, fa_line_id: l.id, amount: round2(l.grand_total - l.toll_excl - l.toll_vat) } : null }).filter(Boolean)
    await supabase.from('fleet_deductions').delete().eq('period', period).eq('status', 'pending')
    if (ded.length) { const { error } = await supabase.from('fleet_deductions').upsert(ded as object[], { onConflict: 'period,employee_id,card_id', ignoreDuplicates: true }); if (error) setMsg(error.message) }
    await load(); setBusy(false); setMsg(`Rebuilt from the First Auto statement: ${ded.length} staff-card lines.`)
  }
  async function exportSheet() {
    setBusy(true)
    const user = (await supabase.auth.getUser()).data.user
    const file = `Fleet card deductions ${period}.xlsx`
    const { data: b } = await supabase.from('fleet_batches').insert({ period, kind: 'deductions', total, line_count: rows.length, file_name: file, exported_by: user?.id }).select('id').single()
    // Deduction template placeholder — replace column layout once payroll's template is provided.
    const out: (string | number | null)[][] = [['Emp No', 'Employee', 'Branch', 'Department', 'Card (driver name)', 'Vehicle reg', 'Period', 'Deduction (incl VAT)']]
    const sorted = [...rows].sort((a, b2) => (empOf(m, a.employee_id)?.full_name ?? '').localeCompare(empOf(m, b2.employee_id)?.full_name ?? ''))
    for (const r of sorted) { const e = empOf(m, r.employee_id); const c = m.cards.find((x) => x.id === r.card_id); out.push([e?.emp_no ?? '', e?.full_name ?? '', m.bm.code(e?.branch_id), e?.category ?? '', c?.fa_driver_name ?? '', c?.fa_reg ?? '', periodLabel(period), r.amount]) }
    out.push(['', '', '', '', '', '', 'TOTAL', total])
    downloadWorkbook([{ name: 'Deductions', rows: out, widths: [8, 28, 8, 12, 26, 12, 10, 16] }], file)
    if (b) { await supabase.from('fleet_deductions').update({ status: 'exported', batch_id: b.id }).eq('period', period).eq('status', 'pending'); await load() }
    setBusy(false)
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3"><Stat label="Staff card holders" value={rows.length} tone="purple" /><Stat label="Total to deduct" value={`R ${money(total)}`} sub={`from ${periodLabel(prevPeriod(period, -1))} salaries`} tone="pink" /><Stat label="Status" value={rows.length ? (rows.every((r) => r.status !== 'pending') ? 'exported' : 'pending') : '–'} /></div>
      {msg && <Alert tone="blue">{msg}</Alert>}
      <Card title={`Deductions for ${periodLabel(period)} fleet-card usage`} actions={<><Button variant="secondary" disabled={busy} onClick={() => void rebuild()}>Rebuild from statement</Button><Button disabled={busy || !rows.length} onClick={() => void exportSheet()}>Export deduction sheet</Button></>}>
        {rows.length === 0 ? <Empty>No staff-card lines for {periodLabel(period)}. Import the First Auto statement first.</Empty> : (
          <Table head={['Emp no', 'Employee', 'Branch', 'Category', 'Card', 'Reg', 'Amount', 'Status']}>
            {rows.map((r) => { const e = empOf(m, r.employee_id); const c = m.cards.find((x) => x.id === r.card_id); return (
              <tr key={r.id}><Td>{e?.emp_no}</Td><Td>{e?.full_name}</Td><Td>{m.bm.code(e?.branch_id)}</Td><Td className="text-xs">{e?.category}</Td><Td className="text-xs">{c?.fa_driver_name}</Td><Td>{c?.fa_reg}</Td><Td num className="font-semibold"><Money v={r.amount} /></Td><Td><Badge tone={statusTone(r.status)}>{r.status}</Badge></Td></tr>) })}
            <tr className="bg-brand-card font-semibold"><Td colSpan={6}>Total</Td><Td num><Money v={total} /></Td><Td /></tr>
          </Table>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Claims
function Claims({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<Claim[]>([]); const [busy, setBusy] = useState(false); const [awaiting, setAwaiting] = useState(0)
  const load = async () => {
    const { data } = await supabase.from('fleet_claims').select('*').eq('period', period); setRows((data ?? []) as Claim[])
    const { count } = await supabase.from('fleet_travel_logs').select('id', { count: 'exact', head: true }).eq('period', period).in('status', ['submitted', 'draft']); setAwaiting(count ?? 0)
  }
  useEffect(() => { void load() }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const fuel = rows.reduce((s, r) => s + r.fuel_amount, 0); const maint = rows.reduce((s, r) => s + r.maint_amount, 0)
  const zeroRate = rows.some((r) => !r.fuel_rate && !r.maint_rate)
  /** Payroll's own layout ("Payroll Entries for <month>"): FA card deduction + reimbursement + maintenance provision per person. */
  async function exportPayrollSheet() {
    setBusy(true)
    const { data: ded } = await supabase.from('fleet_deductions').select('employee_id,amount').eq('period', period)
    const people = new Map<number, { fa: number; c: Claim | null }>()
    for (const d of ded ?? []) { const p = people.get(d.employee_id) ?? { fa: 0, c: null }; p.fa = round2(p.fa + Number(d.amount)); people.set(d.employee_id, p) }
    for (const c of rows) { const p = people.get(c.employee_id) ?? { fa: 0, c: null }; p.c = c; people.set(c.employee_id, p) }
    for (const e of m.employees) if (e.active && (e.fuel_rate || e.maint_rate) && !people.has(e.id)) people.set(e.id, { fa: 0, c: null })
    const toRow = (e: NonNullable<ReturnType<typeof empOf>>, fa: number, c: Claim | null, late = false): PayrollRow => ({
      emp_no: e.emp_no ?? '', name: e.full_name, department: e.category === 'Exec' ? 'Directors' : e.category, branch: m.bm.byId(e.branch_id)?.name ?? '',
      fa_deduction: fa, reimbursement: c?.fuel_amount ?? 0, provision: c?.maint_amount ?? 0, business_km: c?.business_km ?? 0,
      fuel_rate: c?.fuel_rate ?? e.fuel_rate, maint_rate: c?.maint_rate ?? e.maint_rate,
      note: late ? `late claim — ${periodLabel(c!.period)} log` : !c ? 'no travel log received' : !c.fuel_rate && !c.maint_rate ? 'no rate on file — claim not calculated' : '',
    })
    const list = [...people.entries()].map(([id, p]) => ({ e: empOf(m, id), ...p })).filter((x) => x.e).sort((a, b) => (a.e!.emp_no ?? '').localeCompare(b.e!.emp_no ?? ''))
    const { data: late } = await supabase.from('fleet_claims').select('*').lt('period', period).eq('status', 'pending').gt('total_amount', 0)
    await downloadPayrollWorkbook({
      periodLabel: periodLabel(period), payLabel: periodLabel(prevPeriod(period, -1)),
      rows: list.map(({ e, fa, c }) => toRow(e!, fa, c)),
      lateRows: ((late ?? []) as Claim[]).map((c) => { const e = empOf(m, c.employee_id); return e ? toRow(e, 0, c, true) : null }).filter((x): x is PayrollRow => !!x),
    }, `Payroll Entries for ${periodLabel(period)}.xlsx`)
    setBusy(false)
  }
  async function exportSheet() {
    setBusy(true)
    const user = (await supabase.auth.getUser()).data.user
    const file = `Travel claims ${period}.xlsx`
    const { data: b } = await supabase.from('fleet_batches').insert({ period, kind: 'claims', total: fuel, line_count: rows.length, file_name: file, exported_by: user?.id }).select('id').single()
    // Claim sheet placeholder — replace column layout once payroll's template is provided.
    const out: (string | number | null)[][] = [['Emp No', 'Employee', 'Branch', 'Category', 'Period', 'Business km', 'Fuel rate /km', 'Fuel claim (PAY)', 'Maintenance rate /km', 'Maintenance (ACCRUE)', 'Total claim']]
    for (const r of [...rows].sort((a, c) => (empOf(m, a.employee_id)?.full_name ?? '').localeCompare(empOf(m, c.employee_id)?.full_name ?? ''))) { const e = empOf(m, r.employee_id); out.push([e?.emp_no ?? '', e?.full_name ?? '', m.bm.code(e?.branch_id), r.category, periodLabel(period), r.business_km, r.fuel_rate, r.fuel_amount, r.maint_rate, r.maint_amount, r.total_amount]) }
    out.push(['', '', '', '', 'TOTAL', rows.reduce((s, r) => s + r.business_km, 0), '', fuel, '', maint, fuel + maint])
    downloadWorkbook([{ name: 'Claims', rows: out, widths: [8, 28, 8, 12, 10, 12, 12, 16, 14, 18, 14] }], file)
    if (b) { await supabase.from('fleet_claims').update({ status: 'exported', batch_id: b.id }).eq('period', period).eq('status', 'pending'); await load() }
    setBusy(false)
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4"><Stat label="Approved claims" value={rows.length} sub={awaiting ? `${awaiting} log${awaiting > 1 ? 's' : ''} still draft/submitted` : 'all logs decided'} /><Stat label="Fuel — pay out" value={`R ${money(fuel)}`} tone="pink" /><Stat label="Maintenance — accrue" value={`R ${money(maint)}`} tone="teal" /><Stat label="Business km" value={num(rows.reduce((s, r) => s + r.business_km, 0))} tone="purple" /></div>
      {zeroRate && <Alert tone="amber">Some claims were approved while the rate for their category was R 0.00. Set the rates under Admin → Claim rates, then re-open and re-approve those logs.</Alert>}
      <Card title={`Claim sheet for ${periodLabel(period)} (paid end of ${periodLabel(prevPeriod(period, -1))})`} actions={<><Button disabled={busy} onClick={() => void exportPayrollSheet()}>Export payroll entries (Tracey's layout)</Button><Button variant="secondary" disabled={busy || !rows.length} onClick={() => void exportSheet()}>Export claim sheet</Button></>}>
        {rows.length === 0 ? <Empty>No approved claims for {periodLabel(period)} yet.</Empty> : (
          <Table head={['Emp no', 'Employee', 'Branch', 'Category', 'Business km', 'Fuel rate', 'Fuel (pay)', 'Maint rate', 'Maint (accrue)', 'Total', 'Status']}>
            {rows.map((r) => { const e = empOf(m, r.employee_id); return (
              <tr key={r.id}><Td>{e?.emp_no}</Td><Td>{e?.full_name}</Td><Td>{m.bm.code(e?.branch_id)}</Td><Td className="text-xs">{r.category}</Td><Td num>{num(r.business_km, 1)}</Td><Td num>{num(r.fuel_rate, 2)}</Td><Td num className="font-semibold"><Money v={r.fuel_amount} /></Td><Td num>{num(r.maint_rate, 2)}</Td><Td num><Money v={r.maint_amount} /></Td><Td num><Money v={r.total_amount} /></Td><Td><Badge tone={statusTone(r.status)}>{r.status}</Badge></Td></tr>) })}
          </Table>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Accrual
interface Balance { employee_id: number; emp_no: string; full_name: string; branch_id: number | null; category: string; balance: number; opening: number; accrued: number; paid_out: number; adjustments: number; last_txn: string | null }
function Accrual({ m, period }: { m: Masters; period: string }) {
  const [bal, setBal] = useState<Balance[]>([]); const [open, setOpen] = useState<number | null>(null); const [txns, setTxns] = useState<AccrualTxn[]>([])
  const [form, setForm] = useState({ employee_id: '', kind: 'payout', amount: '', description: '', reference: '' }); const [msg, setMsg] = useState<string | null>(null)
  const load = () => supabase.from('fleet_v_accrual_balances').select('*').order('full_name').then(({ data }) => setBal((data ?? []) as Balance[]))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (open != null) supabase.from('fleet_accrual_txns').select('*').eq('employee_id', open).order('txn_date').then(({ data }) => setTxns((data ?? []) as AccrualTxn[])) }, [open])
  async function add() {
    const amt = Number(form.amount); if (!form.employee_id || !amt) { setMsg('Choose an employee and enter an amount.'); return }
    const user = (await supabase.auth.getUser()).data.user
    const signed = form.kind === 'payout' ? -Math.abs(amt) : amt
    const { error } = await supabase.from('fleet_accrual_txns').insert({ employee_id: Number(form.employee_id), txn_date: new Date().toISOString().slice(0, 10), period, kind: form.kind, amount: signed, description: form.description || (form.kind === 'payout' ? 'Maintenance paid out' : 'Adjustment'), reference: form.reference || null, created_by: user?.id })
    if (error) { setMsg(error.message); return }
    setMsg(null); setForm({ ...form, amount: '', description: '', reference: '' }); await load(); if (open === Number(form.employee_id)) setOpen(null)
  }
  const withBal = bal.filter((b) => b.balance || b.opening || b.accrued || b.paid_out || b.adjustments)
  function exportBalances() {
    downloadWorkbook([{ name: 'Accrual', rows: [['Emp No', 'Employee', 'Branch', 'Category', 'Opening balance', 'Accrued', 'Paid out', 'Adjustments', 'Balance'], ...withBal.map((b) => [b.emp_no, b.full_name, m.bm.code(b.branch_id), b.category, b.opening, b.accrued, b.paid_out, b.adjustments, b.balance])], widths: [8, 28, 8, 12, 16, 14, 14, 14, 16] }], `Maintenance accrual balances ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4"><Stat label="Opening balances" value={`R ${money(withBal.reduce((s, b) => s + b.opening, 0))}`} sub="per 900500 recon" /><Stat label="Accrued since" value={`R ${money(withBal.reduce((s, b) => s + b.accrued, 0))}`} tone="teal" /><Stat label="Paid out" value={`R ${money(withBal.reduce((s, b) => s + b.paid_out, 0))}`} tone="pink" /><Stat label="Total accrual owed" value={`R ${money(withBal.reduce((s, b) => s + b.balance, 0))}`} sub={`${withBal.filter((b) => b.balance > 0).length} people`} tone="purple" /></div>
      <Card title="Record a payout or adjustment">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Employee"><Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}><option value="">— choose —</option>{m.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</Select></Field>
          <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="payout">Payout (maintenance done)</option><option value="adjustment">Adjustment (+/-)</option></Select></Field>
          <Field label="Amount"><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-32" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-64" placeholder="e.g. Service at Toyota Secunda" /></Field>
          <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-32" placeholder="invoice no" /></Field>
          <Button onClick={() => void add()}>Add</Button>
        </div>
        {msg && <div className="mt-2"><Alert tone="red">{msg}</Alert></div>}
        <p className="mt-2 text-xs text-slate-500">Payouts reduce the balance and should be added to the next claim sheet manually (or via an adjustment on the payroll side) until the payout journal is added. Opening balances are loaded under Imports → Accrual opening balances.</p>
      </Card>
      <Card title="Balances per person" actions={<Button size="sm" variant="secondary" onClick={exportBalances}>Export</Button>}>
        {withBal.length === 0 ? <Empty>No accrual movements yet. Load opening balances or approve travel logs.</Empty> : (
          <Table head={['Emp no', 'Employee', 'Branch', 'Category', 'Opening balance', 'Accrued', 'Paid out', 'Adjustments', 'Balance', 'Last movement', '']}>
            {withBal.map((b) => (
              <Fragment key={b.employee_id}>
                <tr className="hover:bg-brand-card"><Td>{b.emp_no}</Td><Td>{b.full_name}</Td><Td>{m.bm.code(b.branch_id)}</Td><Td className="text-xs">{b.category}</Td><Td num><Money v={b.opening} /></Td><Td num><Money v={b.accrued} /></Td><Td num><Money v={b.paid_out} /></Td><Td num><Money v={b.adjustments || null} /></Td><Td num className="font-semibold"><Money v={b.balance} /></Td><Td className="text-xs">{fmtDate(b.last_txn)}</Td><Td><Button size="sm" variant="ghost" onClick={() => setOpen(open === b.employee_id ? null : b.employee_id)}>{open === b.employee_id ? 'Hide' : 'Ledger'}</Button></Td></tr>
                {open === b.employee_id && (
                  <tr><Td colSpan={11} className="bg-brand-card">
                    <Table head={['Date', 'Period', 'Type', 'Description', 'Reference', 'Amount']}>
                      {txns.map((t) => <tr key={t.id}><Td>{fmtDate(t.txn_date)}</Td><Td>{t.period ? periodLabel(t.period) : ''}</Td><Td><Badge tone={t.kind === 'payout' ? 'pink' : t.kind === 'opening' ? 'slate' : 'teal'}>{t.kind}</Badge></Td><Td>{t.description}</Td><Td className="text-xs">{t.reference}</Td><Td num><Money v={t.amount} /></Td></tr>)}
                    </Table>
                  </Td></tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
export type { CardT }
