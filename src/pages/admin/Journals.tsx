import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useMasters } from '../../hooks/useMasters'
import type { AvisLine, Claim, Deduction, FaLine, Import, InsuranceLine, Journal, JournalLine, MaintLine, TrackingLine } from '../../lib/types'
import { avisJournal, claimsJournal, firstAutoJournal, insuranceJournal, maintenanceJournal, trackingJournal, type JournalResult, deductionsJournal, provisionJournal } from '../../lib/journal'
import { currentPeriod, money, periodLabel, prevPeriod } from '../../lib/format'
import { downloadWorkbook } from '../../lib/xlsx'
import { acumaticaRows, periodId } from '../../lib/acumatica'
import { Page, Card, Button, PeriodPicker, Table, Td, Money, Alert, Spinner, Empty, Badge, statusTone } from '../../components/ui'

const SOURCES = [
  { key: 'first_auto', label: 'First Auto' }, { key: 'fa_maintenance', label: 'FA Maintenance' }, { key: 'avis', label: 'Avis' }, { key: 'insurance', label: 'Insurance' },
  { key: 'tracking', label: 'Tracking' }, { key: 'claims', label: 'Travel claims' }, { key: 'accrual', label: 'Maintenance accrual' }, { key: 'deductions', label: 'Salary recoveries' },
] as const
type SourceKey = (typeof SOURCES)[number]['key']

export default function Journals() {
  const m = useMasters()
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  const [source, setSource] = useState<SourceKey>('first_auto')
  const [provider, setProvider] = useState('')
  const [imports, setImports] = useState<Import[]>([])
  const [journals, setJournals] = useState<Journal[]>([])
  const [result, setResult] = useState<JournalResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('fleet_imports').select('*').eq('period', period).then(({ data }) => setImports((data ?? []) as Import[]))
    supabase.from('fleet_journals').select('*').eq('period', period).order('created_at', { ascending: false }).then(({ data }) => setJournals((data ?? []) as Journal[]))
    setResult(null)
  }, [period])

  const providers = useMemo(() => [...new Set(imports.filter((i) => i.source === 'tracking').map((i) => i.provider ?? ''))], [imports])
  useEffect(() => { if (source === 'tracking' && !provider && providers[0]) setProvider(providers[0]) }, [source, providers, provider])

  async function generate() {
    setBusy(true); setMsg(null)
    const ctx = { branches: m.branches, vehicles: m.vehicles, employees: m.employees, cards: m.cards, glmap: m.glmap, settings: m.settings, allocations: m.allocations }
    let r: JournalResult | null = null
    if (source === 'first_auto') { const { data } = await supabase.from('fleet_fa_lines').select('*').eq('period', period); r = firstAutoJournal(ctx, period, (data ?? []) as FaLine[]) }
    if (source === 'fa_maintenance') { const { data } = await supabase.from('fleet_maint_lines').select('*').eq('period', period); r = maintenanceJournal(ctx, period, (data ?? []) as MaintLine[]) }
    if (source === 'avis') { const { data } = await supabase.from('fleet_avis_lines').select('*').eq('period', period); r = avisJournal(ctx, period, (data ?? []) as AvisLine[]) }
    if (source === 'insurance') { const { data } = await supabase.from('fleet_insurance_lines').select('*').eq('period', period); r = insuranceJournal(ctx, period, (data ?? []) as InsuranceLine[]) }
    if (source === 'tracking') { const { data } = await supabase.from('fleet_tracking_lines').select('*').eq('period', period).eq('provider', provider); r = trackingJournal(ctx, period, provider, (data ?? []) as TrackingLine[]) }
    // payroll pays this month's claims plus late claims from earlier months that are still pending — both journals balance to that sheet
    const payrollClaims = async () => { const [{ data: cur }, { data: late }] = await Promise.all([supabase.from('fleet_claims').select('*').eq('period', period), supabase.from('fleet_claims').select('*').lt('period', period).eq('status', 'pending').gt('total_amount', 0)]); return [...(cur ?? []), ...(late ?? [])] as Claim[] }
    if (source === 'claims') r = claimsJournal(ctx, period, await payrollClaims())
    if (source === 'accrual') r = provisionJournal(ctx, period, await payrollClaims())
    if (source === 'deductions') { const { data } = await supabase.from('fleet_deductions').select('*').eq('period', period); r = deductionsJournal(ctx, period, (data ?? []) as Deduction[]) }
    if (r && r.lines.length === 0) setMsg(`No ${SOURCES.find((s) => s.key === source)?.label} data for ${periodLabel(period)} — import it first.`)
    setResult(r); setBusy(false)
  }

  async function saveAndExport() {
    if (!result) return
    setBusy(true)
    const dbSource = source === 'accrual' ? 'accrual_provision' : source
    const imp = imports.find((i) => i.source === source && (source !== 'tracking' || i.provider === provider))
    const user = (await supabase.auth.getUser()).data.user
    // replace any earlier draft for the same source/period/provider
    let q = supabase.from('fleet_journals').delete().eq('period', period).eq('source', dbSource).eq('status', 'draft'); if (source === 'tracking') q = q.eq('provider', provider)
    await q
    const { data: j, error } = await supabase.from('fleet_journals').insert({ source: dbSource, period, provider: source === 'tracking' ? provider : null, import_id: imp?.id ?? null, status: 'exported', total_debit: result.totalDebit, created_by: user?.id }).select('*').single()
    if (error) { setMsg(error.message); setBusy(false); return }
    const { error: lErr } = await supabase.from('fleet_journal_lines').insert(result.lines.map((l) => ({ ...l, journal_id: j.id })))
    if (lErr) { setMsg(lErr.message); setBusy(false); return }
    exportLines(result.lines, `${periodId(period)} - ${source === 'accrual' ? 'Maint. Accrual Jnl' : SOURCES.find((s) => s.key === source)?.label}${source === 'tracking' ? ' ' + provider : ''} ${periodLabel(period)} Jnl.xlsx`)
    setJournals([j as Journal, ...journals]); setBusy(false)
  }
  /** Acumatica import layout (Branch · Transaction Date · Period ID · Account · Subaccount · Ref … ), plus a readable sheet with account names and totals */
  /** One sheet named "journal" in the Acumatica import layout — the same shape as the accountant's posted journals */
  function exportLines(lines: JournalLine[], file: string) {
    const acu = acumaticaRows(period, lines, { branch: m.setting('journal_branch') || 'ICS', ref: m.setting('journal_ref') || 'HDV' })
    downloadWorkbook([{ name: 'journal', rows: acu, widths: [8, 14, 10, 10, 12, 14, 10, 10, 10, 8, 6, 14, 14, 60] }], file)
  }
  async function reExport(j: Journal) {
    const { data } = await supabase.from('fleet_journal_lines').select('*').eq('journal_id', j.id).order('line_no')
    exportLines((data ?? []) as JournalLine[], `${periodId(j.period)} - ${j.source === 'accrual_provision' ? 'Maint. Accrual Jnl' : j.source}${j.provider ? ' ' + j.provider : ''} ${periodLabel(j.period)} Jnl.xlsx`)
  }
  async function markPosted(j: Journal) {
    await supabase.from('fleet_journals').update({ status: 'posted' }).eq('id', j.id)
    setJournals(journals.map((x) => (x.id === j.id ? { ...x, status: 'posted' } : x)))
  }

  return (
    <Page title="Journals" subtitle="Generate the month's journal per source for the management accountant. Accounts and branches come from the GL map and the card / vehicle allocations."
      actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      <div className="mb-3 rounded-md border border-brand-hairline bg-white p-2 text-xs text-slate-600">
        Imported for {periodLabel(period)}: {imports.length === 0 ? 'nothing yet' : imports.map((i) => {
          const v = i.control_amount == null ? null : Math.abs(Number(i.total_amount) - Number(i.control_amount))
          return <span key={i.id} className="mr-3 inline-block">{i.source}{i.provider ? ` (${i.provider})` : ''} {i.row_count} rows · R {money(Number(i.total_amount))} {i.source === 'fa_maintenance' ? <Badge tone="slate">see Recon</Badge> : v == null ? <Badge tone="amber">debit order not entered</Badge> : v > 0.05 ? <Badge tone="red">out by R {money(v)}</Badge> : <Badge tone="green">balances</Badge>}</span>
        })}
      </div>
      {imports.some((i) => ['first_auto', 'avis', 'insurance', 'tracking'].includes(i.source) && (i.control_amount == null || Math.abs(Number(i.total_amount) - Number(i.control_amount)) > 0.05)) && (
        <div className="mb-3"><Alert tone="amber">Some imports have no debit-order amount entered, or do not balance to it. Complete the Reconciliation tab before posting journals.</Alert></div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => <Button key={s.key} variant={source === s.key ? 'primary' : 'secondary'} onClick={() => { setSource(s.key); setResult(null) }}>{s.label}</Button>)}
        {source === 'tracking' && (
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {providers.length === 0 && <option value="">— no tracking imports —</option>}
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <Button variant="secondary" disabled={busy || m.loading} onClick={() => void generate()}>Generate preview</Button>
        {result && result.lines.length > 0 && <Button disabled={busy} onClick={() => void saveAndExport()}>Save & export to Excel</Button>}
      </div>
      {msg && <div className="mb-3"><Alert tone="amber">{msg}</Alert></div>}
      {busy && <Spinner label="Working…" />}
      {result && result.warnings.length > 0 && (
        <div className="mb-3"><Alert tone="amber"><b>Check before posting:</b><ul className="ml-4 list-disc">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Alert></div>
      )}
      {result && result.lines.length > 0 && (
        <Card title={`Preview — Dr R ${money(result.totalDebit)} / Cr R ${money(result.totalCredit)}`} className="mb-4">
          <Table head={['#', 'Account', 'Name', 'Branch', 'Category', 'Description', 'Reference', 'Debit', 'Credit']}>
            {result.lines.map((l) => (
              <tr key={l.line_no} className={l.branch_code === 'ZZZ' || l.gl_account === 'UNMAPPED' || /_ACCOUNT$/.test(l.gl_account) ? 'bg-amber-50' : ''}>
                <Td className="text-slate-400">{l.line_no}</Td><Td className="font-mono">{l.gl_account}</Td><Td>{l.gl_name}</Td><Td>{l.branch_code}</Td><Td className="text-xs">{l.category}</Td>
                <Td>{l.description}</Td><Td className="text-xs">{l.reference}</Td><Td num><Money v={l.debit || null} /></Td><Td num><Money v={l.credit || null} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title={`Journals created for ${periodLabel(period)}`}>
        {journals.length === 0 ? <Empty>None yet.</Empty> : (
          <Table head={['Created', 'Source', 'Provider', 'Total', 'Status', '']}>
            {journals.map((j) => (
              <tr key={j.id}>
                <Td>{new Date(j.created_at).toLocaleString('en-ZA')}</Td><Td>{j.source}</Td><Td>{j.provider}</Td><Td num><Money v={j.total_debit} /></Td>
                <Td><Badge tone={statusTone(j.status)}>{j.status}</Badge></Td>
                <Td className="space-x-2"><Button size="sm" variant="secondary" onClick={() => void reExport(j)}>Download</Button>{j.status !== 'posted' && <Button size="sm" variant="ghost" onClick={() => void markPosted(j)}>Mark posted</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  )
}
