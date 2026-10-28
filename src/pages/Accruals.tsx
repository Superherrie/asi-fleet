import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMasters } from '../hooks/useMasters'
import type { AccrualTxn } from '../lib/types'
import { fmtDate, money, periodLabel } from '../lib/format'
import { downloadWorkbook } from '../lib/xlsx'
import { Page, Card, Button, Table, Td, Money, Badge, Empty, Spinner, Stat } from '../components/ui'

interface Balance { employee_id: number; emp_no: string; full_name: string; branch_id: number | null; category: string; balance: number; opening: number; accrued: number; paid_out: number; adjustments: number; last_txn: string | null }

/** Read-only maintenance-accrual balances for logins with the all-vehicle view (admins use Payroll → Maintenance accrual, which also records payouts). */
export default function Accruals() {
  const m = useMasters()
  const [bal, setBal] = useState<Balance[] | null>(null); const [open, setOpen] = useState<number | null>(null); const [txns, setTxns] = useState<AccrualTxn[]>([])
  useEffect(() => { void supabase.from('fleet_v_accrual_balances').select('*').order('full_name').then(({ data }) => setBal((data ?? []) as Balance[])) }, [])
  useEffect(() => { if (open != null) void supabase.from('fleet_accrual_txns').select('*').eq('employee_id', open).order('txn_date').then(({ data }) => setTxns((data ?? []) as AccrualTxn[])) }, [open])
  const withBal = (bal ?? []).filter((b) => b.balance || b.opening || b.accrued || b.paid_out || b.adjustments)
  function exportBalances() {
    downloadWorkbook([{ name: 'Accrual', rows: [['Emp No', 'Employee', 'Branch', 'Category', 'Opening balance', 'Accrued', 'Paid out', 'Adjustments', 'Balance'], ...withBal.map((b) => [b.emp_no, b.full_name, m.bm.code(b.branch_id), b.category, b.opening, b.accrued, b.paid_out, b.adjustments, b.balance])], widths: [8, 28, 8, 12, 16, 14, 14, 14, 16] }], `Maintenance accrual balances ${new Date().toISOString().slice(0, 10)}.xlsx`)
  }
  return (
    <Page title="Maintenance accruals" subtitle="What each traveller has built up in the maintenance accrual (GL 900500): the opening balance, the maintenance portion of approved travel claims, and payouts and maintenance set off against it. View only — payouts and adjustments are recorded by fleet administrators under Payroll.">
      {bal === null || m.loading ? <Spinner /> : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4"><Stat label="Opening balances" value={`R ${money(withBal.reduce((s, b) => s + b.opening, 0))}`} sub="per 900500 recon" /><Stat label="Accrued since" value={`R ${money(withBal.reduce((s, b) => s + b.accrued, 0))}`} tone="teal" /><Stat label="Paid out" value={`R ${money(withBal.reduce((s, b) => s + b.paid_out, 0))}`} tone="pink" /><Stat label="Total accrual owed" value={`R ${money(withBal.reduce((s, b) => s + b.balance, 0))}`} sub={`${withBal.filter((b) => b.balance > 0).length} people`} tone="purple" /></div>
          <Card title="Balances per person" actions={<Button size="sm" variant="secondary" onClick={exportBalances}>Export</Button>}>
            {withBal.length === 0 ? <Empty>No accrual movements yet.</Empty> : (
              <Table head={['Emp no', 'Employee', 'Branch', 'Category', 'Opening balance', 'Accrued', 'Paid out', 'Adjustments', 'Balance', 'Last movement', '']}>
                {withBal.map((b) => (
                  <Fragment key={b.employee_id}>
                    <tr className={b.balance < -0.005 ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-brand-card'} title={b.balance < -0.005 ? 'Maintenance utilised exceeds the accrual' : undefined}><Td>{b.emp_no}</Td><Td>{b.full_name}</Td><Td>{m.bm.code(b.branch_id)}</Td><Td className="text-xs">{b.category}</Td><Td num><Money v={b.opening} /></Td><Td num><Money v={b.accrued} /></Td><Td num><Money v={b.paid_out} /></Td><Td num><Money v={b.adjustments || null} /></Td><Td num className="font-semibold"><Money v={b.balance} /></Td><Td className="text-xs">{fmtDate(b.last_txn)}</Td><Td><Button size="sm" variant="ghost" onClick={() => setOpen(open === b.employee_id ? null : b.employee_id)}>{open === b.employee_id ? 'Hide' : 'Ledger'}</Button></Td></tr>
                    {open === b.employee_id && (
                      <tr><Td colSpan={11} className="bg-brand-card">
                        <Table head={['Date', 'Period', 'Type', 'Description', 'Reference', 'Amount']}>
                          {txns.map((t) => { const opened = txns.filter((x) => x.kind === 'opening').map((x) => x.txn_date).sort().pop(); const inside = !!opened && t.txn_date < opened && t.kind !== 'accrual'; return <tr key={t.id} className={inside ? 'text-slate-400 line-through decoration-slate-300' : ''} title={inside ? 'Dated before the opening balance, so it is already included in it and is not counted again' : undefined}><Td>{fmtDate(t.txn_date)}</Td><Td>{t.period ? periodLabel(t.period) : ''}</Td><Td><Badge tone={t.kind === 'payout' ? 'pink' : t.kind === 'opening' ? 'slate' : 'teal'}>{t.kind}</Badge></Td><Td>{t.description}</Td><Td className="text-xs">{t.reference}</Td><Td num><Money v={t.amount} /></Td></tr> })}
                        </Table>
                      </Td></tr>
                    )}
                  </Fragment>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </Page>
  )
}
