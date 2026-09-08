import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useMasters } from '../../hooks/useMasters'
import type { Import } from '../../lib/types'
import { currentPeriod, fmtDate, money, periodLabel, prevPeriod, round2 } from '../../lib/format'
import { downloadWorkbook } from '../../lib/xlsx'
import { Page, Card, Button, PeriodPicker, Table, Td, Money, Badge, Stat, Spinner, Alert } from '../../components/ui'

interface ReconRow { period: string; key: string; expected: number | null; actual: number | null; actual_date: string | null; note: string | null; checked_at?: string }
interface Line {
  id: string; group: string; label: string; detail: string; expected: number; actual: number | null; date: string | null; note: string | null
  save: (actual: number | null, date: string | null, note: string | null) => Promise<void>
}
const SOURCE_LABEL: Record<string, string> = { first_auto: 'First Auto fuel statement', fa_maintenance: 'First Auto maintenance', avis: 'Avis', insurance: 'Insurance', tracking: 'Tracking' }
const TOL = 0.05
const status = (l: Line) => (l.actual == null ? 'open' : Math.abs(l.actual - l.expected) <= TOL ? 'balanced' : 'variance')

export default function Recon() {
  const m = useMasters()
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  const [imports, setImports] = useState<Import[]>([])
  const [recons, setRecons] = useState<ReconRow[]>([])
  const [figures, setFigures] = useState<{ deductions: number; reimbursement: number; provision: number; late: number; accrual: number; claimsCount: number; dedCount: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [imp, rec, ded, cl, late, acc] = await Promise.all([
      supabase.from('fleet_imports').select('*').eq('period', period).in('source', ['first_auto', 'fa_maintenance', 'avis', 'insurance', 'tracking']).order('source'),
      supabase.from('fleet_recons').select('*').eq('period', period),
      supabase.from('fleet_deductions').select('amount').eq('period', period),
      supabase.from('fleet_claims').select('fuel_amount,maint_amount').eq('period', period),
      supabase.from('fleet_claims').select('fuel_amount,maint_amount').lt('period', period).eq('status', 'pending').gt('total_amount', 0),
      supabase.from('fleet_v_accrual_balances').select('balance'),
    ])
    setImports((imp.data ?? []) as Import[]); setRecons((rec.data ?? []) as ReconRow[])
    setFigures({
      deductions: round2((ded.data ?? []).reduce((s, d) => s + Number(d.amount), 0)), dedCount: (ded.data ?? []).length,
      reimbursement: round2((cl.data ?? []).reduce((s, c) => s + Number(c.fuel_amount), 0)), provision: round2((cl.data ?? []).reduce((s, c) => s + Number(c.maint_amount), 0)), claimsCount: (cl.data ?? []).length,
      late: round2((late.data ?? []).reduce((s, c) => s + Number(c.fuel_amount) + Number(c.maint_amount), 0)),
      accrual: round2((acc.data ?? []).reduce((s, b) => s + Number(b.balance), 0)),
    })
    setLoading(false)
  }, [period])
  useEffect(() => { void load() }, [load])

  const lines = useMemo<Line[]>(() => {
    if (!figures) return []
    const user = () => supabase.auth.getUser().then((r) => r.data.user?.id ?? null)
    const recon = (key: string, group: string, label: string, detail: string, expected: number): Line => {
      const r = recons.find((x) => x.key === key)
      return { id: key, group, label, detail, expected, actual: r?.actual ?? null, date: r?.actual_date ?? null, note: r?.note ?? null,
        save: async (actual, date, note) => { await supabase.from('fleet_recons').upsert({ period, key, expected, actual, actual_date: date, note, checked_by: await user(), checked_at: new Date().toISOString() }, { onConflict: 'period,key' }); await load() } }
    }
    const G = 'Supplier statements — debit orders / payments'
    const out: Line[] = imports.filter((i) => i.source !== 'fa_maintenance').map((i) => ({
      id: `imp-${i.id}`, group: G, label: `${SOURCE_LABEL[i.source] ?? i.source}${i.provider ? ` · ${i.provider}` : ''}`,
      detail: `${i.file_name ?? ''} · ${i.row_count} lines`, expected: Number(i.total_amount), actual: i.control_amount == null ? null : Number(i.control_amount), date: i.control_date, note: i.control_note,
      save: async (actual, date, note) => { await supabase.from('fleet_imports').update({ control_amount: actual, control_date: date, control_note: note }).eq('id', i.id); await load() },
    }))
    // First Auto maintenance: both divisions' invoices are settled with ONE payment → a single combined line
    const maint = imports.filter((i) => i.source === 'fa_maintenance')
    if (maint.length) out.push(recon('fa_maintenance', G, 'First Auto maintenance', `${maint.map((i) => i.provider ?? i.file_name).join(' + ')} · ${maint.reduce((s, i) => s + i.row_count, 0)} lines`, round2(maint.reduce((s, i) => s + Number(i.total_amount), 0))))
    out.push(recon('payroll_deductions', 'Payroll', 'Fleet card deductions', `${figures.dedCount} staff cards · ${periodLabel(period)} usage deducted from ${periodLabel(prevPeriod(period, -1))} salaries`, figures.deductions))
    out.push(recon('payroll_reimbursement', 'Payroll', 'Travel reimbursement paid (Reim-N)', `${figures.claimsCount} claims · fuel portion`, figures.reimbursement))
    out.push(recon('payroll_provision', 'Payroll', 'Maintenance provision (earned & deducted)', 'nets to zero on payslips; accrues per person', figures.provision))
    if (figures.late) out.push(recon('payroll_late', 'Payroll', 'Late claims from earlier months', 'logs received after their own payroll had run', figures.late))
    out.push(recon('accrual_gl', 'Balance sheet', 'Maintenance accrual — app balance vs GL 900500', 'total of all card holders’ balances (opening + accrued − utilised ± adjustments)', figures.accrual))
    return out
  }, [imports, recons, figures, period, load])

  const groups = [...new Set(lines.map((l) => l.group))]
  const counts = { balanced: lines.filter((l) => status(l) === 'balanced').length, variance: lines.filter((l) => status(l) === 'variance').length, open: lines.filter((l) => status(l) === 'open').length }
  const allDone = lines.length > 0 && counts.open === 0 && counts.variance === 0

  function exportRecon() {
    const rows: (string | number | null)[][] = [[`Fleet reconciliation — ${periodLabel(period)}`], [], ['Section', 'Item', 'Detail', 'App figure', 'Actual', 'Date', 'Variance', 'Status', 'Note']]
    for (const l of lines) rows.push([l.group, l.label, l.detail, l.expected, l.actual, l.date, l.actual == null ? null : round2(l.expected - l.actual), status(l), l.note])
    downloadWorkbook([{ name: 'Recon', rows, widths: [34, 40, 50, 14, 14, 12, 12, 10, 40] }], `Fleet recon ${period}.xlsx`)
  }

  return (
    <Page title="Reconciliation" subtitle="Every payment and payroll figure for the month, checked against what was actually paid or processed. Nothing is posted until it balances."
      actions={<><PeriodPicker value={period} onChange={setPeriod} /><Button variant="secondary" size="sm" onClick={exportRecon} disabled={!lines.length}>Export</Button></>}>
      {loading || m.loading ? <Spinner /> : lines.length === 0 ? <Alert tone="blue">Nothing imported or processed for {periodLabel(period)} yet.</Alert> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Month status" value={allDone ? 'Balanced' : counts.variance ? 'Variances' : 'In progress'} tone={allDone ? 'teal' : counts.variance ? 'pink' : 'navy'} sub={`${lines.length} items`} />
            <Stat label="Balanced" value={counts.balanced} tone="teal" />
            <Stat label="Variances" value={counts.variance} tone="pink" />
            <Stat label="Not yet entered" value={counts.open} />
          </div>
          {groups.map((g) => (
            <Card key={g} title={g} className="mb-4">
              <Table head={['Item', 'Detail', 'App figure', 'Actual paid / processed', 'Date', 'Note / reference', 'Variance', 'Status', '']}>
                {lines.filter((l) => l.group === g).map((l) => <ReconLine key={l.id} l={l} />)}
              </Table>
            </Card>
          ))}
          <p className="text-xs text-slate-500">Supplier figures include VAT and should match the bank debit order or payment. Payroll figures should match the totals on the payroll entries sheet once Tracey has processed it. The accrual figure should agree to the 900500 balance on the trial balance after the month's journals are posted.</p>
        </>
      )}
    </Page>
  )
}

function ReconLine({ l }: { l: Line }) {
  const [actual, setActual] = useState(l.actual == null ? '' : String(l.actual))
  const [date, setDate] = useState(l.date ?? '')
  const [note, setNote] = useState(l.note ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setActual(l.actual == null ? '' : String(l.actual)); setDate(l.date ?? ''); setNote(l.note ?? '') }, [l.actual, l.date, l.note])
  const st = status(l); const v = l.actual == null ? null : round2(l.expected - l.actual)
  const dirty = actual !== (l.actual == null ? '' : String(l.actual)) || date !== (l.date ?? '') || note !== (l.note ?? '')
  const inp = 'rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-lilac focus:outline-none'
  return (
    <tr className={st === 'open' ? 'bg-amber-50/60' : st === 'variance' ? 'bg-red-50' : ''}>
      <Td className="font-medium">{l.label}</Td>
      <Td className="max-w-xs text-xs text-slate-500">{l.detail}</Td>
      <Td num className="font-semibold"><Money v={l.expected} /></Td>
      <Td><input type="number" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="enter amount" className={`${inp} w-36 text-right`} /></Td>
      <Td><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></Td>
      <Td><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bank ref / payroll run" className={`${inp} w-44`} /></Td>
      <Td num>{v == null ? '' : <span className={Math.abs(v) > TOL ? 'font-semibold text-red-700' : 'text-slate-400'}>{money(v)}</span>}</Td>
      <Td>{st === 'balanced' ? <Badge tone="green">balanced</Badge> : st === 'variance' ? <Badge tone="red">variance</Badge> : <Badge tone="amber">not entered</Badge>}{l.date && st !== 'open' && <div className="text-[10px] text-slate-400">{fmtDate(l.date)}</div>}</Td>
      <Td><Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={busy || !dirty} onClick={async () => { setBusy(true); await l.save(actual === '' ? null : Number(actual), date || null, note || null); setBusy(false) }}>Save</Button></Td>
    </tr>
  )
}
