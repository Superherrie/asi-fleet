import { useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMasters, type Masters } from '../../hooks/useMasters'
import { parseAvis, parseFirstAuto, parseInsurance, parseOpeningBalances, parseTracking, parseTravelLogWorkbook, readWorkbook, type AvisRow, type FaRow, type InsuranceRow, type OpeningRow, type TrackingRow, type TravelLogParse } from '../../lib/parsers'
import { empNoFromDriver, employeeByEmpNo, employeeByName, normKey, normReg, parseFaNameCode, vehicleIndex } from '../../lib/match'
import { currentPeriod, money, num, periodLabel, prevPeriod, round2 } from '../../lib/format'
import { Page, Card, Button, PeriodPicker, FileDrop, Table, Td, Money, Alert, Badge, Input, Field, Select, Spinner } from '../../components/ui'
import type { Category } from '../../lib/types'

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-purple text-white' : 'text-slate-600 hover:bg-brand-card'}`

export default function Imports() {
  const m = useMasters()
  const [period, setPeriod] = useState(prevPeriod(currentPeriod()))
  return (
    <Page title="Imports" subtitle="Load the month's source files. Each import replaces any earlier import of the same source and month." actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-brand-hairline pb-2">
        <NavLink to="first-auto" className={tab}>First Auto</NavLink><NavLink to="avis" className={tab}>Avis</NavLink><NavLink to="insurance" className={tab}>Insurance</NavLink>
        <NavLink to="tracking" className={tab}>Tracking</NavLink><NavLink to="travel-logs" className={tab}>Travel logs (bulk)</NavLink><NavLink to="accrual" className={tab}>Accrual opening balances</NavLink>
      </nav>
      {m.loading ? <Spinner /> : (
        <Routes>
          <Route index element={<Navigate to="first-auto" replace />} />
          <Route path="first-auto" element={<FirstAutoImport m={m} period={period} />} />
          <Route path="avis" element={<AvisImport m={m} period={period} />} />
          <Route path="insurance" element={<InsuranceImport m={m} period={period} />} />
          <Route path="tracking" element={<TrackingImport m={m} period={period} />} />
          <Route path="travel-logs" element={<TravelLogImport m={m} period={period} />} />
          <Route path="accrual" element={<AccrualImport m={m} period={period} />} />
        </Routes>
      )}
    </Page>
  )
}

/** delete an earlier import of the same key, create the new import row, return its id */
async function replaceImport(source: string, period: string, provider: string | null, fileName: string, rowCount: number, total: number) {
  let q = supabase.from('fleet_imports').delete().eq('source', source).eq('period', period)
  q = provider == null ? q.is('provider', null) : q.eq('provider', provider)
  const { error: dErr } = await q; if (dErr) throw dErr
  const user = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase.from('fleet_imports').insert({ source, period, provider, file_name: fileName, row_count: rowCount, total_amount: round2(total), imported_by: user?.id }).select('id').single()
  if (error) throw error
  return data.id as number
}
async function insertChunked(table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 500) { const { error } = await supabase.from(table).insert(rows.slice(i, i + 500)); if (error) throw error }
}
function useStatus() {
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  return { msg, setMsg, busy, setBusy, run: async (fn: () => Promise<string>) => { setBusy(true); setMsg(null); try { setMsg({ tone: 'green', text: await fn() }) } catch (e) { setMsg({ tone: 'red', text: (e as Error).message }) } finally { setBusy(false) } } }
}

// ---------------------------------------------------------------- First Auto
function FirstAutoImport({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<FaRow[] | null>(null); const [file, setFile] = useState(''); const [filePeriod, setFilePeriod] = useState<string | null>(null)
  const st = useStatus()
  const cardKey = useMemo(() => new Map(m.cards.map((c) => [`${c.fa_driver_name.trim().toUpperCase()}|${normReg(c.fa_reg)}`, c])), [m.cards])
  const matched = useMemo(() => (rows ?? []).map((r) => ({ r, card: cardKey.get(`${r.fa_driver_name.toUpperCase()}|${r.fa_reg}`) ?? null })), [rows, cardKey])
  const total = matched.reduce((s, x) => s + x.r.grand_total, 0)
  const newCards = matched.filter((x) => !x.card).length
  const unalloc = matched.filter((x) => x.card?.holder_type === 'unallocated').length

  async function onFile(f: File) {
    st.setMsg(null)
    try { const p = parseFirstAuto(await readWorkbook(f)); setRows(p.rows); setFile(f.name); setFilePeriod(p.period); if (!p.rows.length) st.setMsg({ tone: 'amber', text: 'No statement lines found.' }) }
    catch (e) { st.setMsg({ tone: 'red', text: (e as Error).message }) }
  }
  async function commit() {
    await st.run(async () => {
      // 1. create missing cards (unallocated, but pre-filled from the statement's cost code)
      const vidx = vehicleIndex(m.vehicles); const eidx = employeeByEmpNo(m.employees)
      // rule: reg is a person's private vehicle (card holders' vehicle_reg) → that person's staff card; reg on the fleet master → vehicle card
      // (even when First Auto prints a driver like "1740-STEFANUS KOEN"); else the emp-no prefix → staff card; else unallocated
      const owners = new Map(m.employees.filter((e) => e.vehicle_reg).map((e) => [normReg(e.vehicle_reg), e]))
      const toCreate = matched.filter((x) => !x.card).map(({ r }) => {
        const { category, branchCode } = parseFaNameCode(r.fa_name_code); const branch = branchCode ? m.bm.find(branchCode) : null
        const owner = owners.get(r.fa_reg); const veh = !owner ? vidx.get(r.fa_reg) : null
        const empNo = empNoFromDriver(r.fa_driver_name); const emp = owner ?? (!veh && empNo ? eidx.get(empNo) : null)
        return { fa_driver_name: r.fa_driver_name, fa_reg: r.fa_reg, holder_type: emp ? 'staff' : veh ? 'vehicle' : 'unallocated', employee_id: emp?.id ?? null, vehicle_id: veh?.id ?? null, branch_id: branch?.id ?? emp?.branch_id ?? veh?.branch_id ?? null, category: category ?? emp?.category ?? veh?.category ?? null, notes: `Created from statement ${period}${!emp && !veh ? ` — cost code ${r.fa_name_code}` : ''}` }
      })
      if (toCreate.length) { const { error } = await supabase.from('fleet_cards').upsert(toCreate, { onConflict: 'fa_driver_name,fa_reg' }); if (error) throw error }
      const { data: cards } = await supabase.from('fleet_cards').select('*')
      const ck = new Map((cards ?? []).map((c) => [`${c.fa_driver_name.trim().toUpperCase()}|${normReg(c.fa_reg)}`, c]))
      // 2. import
      const importId = await replaceImport('first_auto', period, null, file, matched.length, total)
      const lines = matched.map(({ r }) => ({ import_id: importId, period, card_id: ck.get(`${r.fa_driver_name.toUpperCase()}|${r.fa_reg}`)?.id ?? null, ...r }))
      await insertChunked('fleet_fa_lines', lines)
      // 3. staff deductions
      // deduction = card usage excluding toll (payroll's convention); directors' cards (deduct = false) stay company cost
      const { data: saved } = await supabase.from('fleet_fa_lines').select('id,card_id,grand_total,toll_excl,toll_vat').eq('import_id', importId)
      const ded = (saved ?? []).map((l) => { const c = (cards ?? []).find((x) => x.id === l.card_id); return c?.holder_type === 'staff' && c.deduct !== false && c.employee_id ? { period, employee_id: c.employee_id, card_id: c.id, fa_line_id: l.id, amount: round2(l.grand_total - l.toll_excl - l.toll_vat) } : null }).filter(Boolean)
      await supabase.from('fleet_deductions').delete().eq('period', period)
      if (ded.length) { const { error } = await supabase.from('fleet_deductions').insert(ded as object[]); if (error) throw error }
      await m.reload(); setRows(null)
      return `Imported ${lines.length} statement lines (R ${money(total)}) for ${periodLabel(period)}; ${ded.length} staff deductions prepared${toCreate.length ? `; ${toCreate.length} new cards added — allocate them under Fleet → Cards` : ''}.`
    })
  }
  return (
    <div className="space-y-3">
      <FileDrop onFile={(f) => void onFile(f)} label="Drop the First Auto monthly statement (.xls/.xlsx)" />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {rows && rows.length > 0 && (
        <Card title={`${file} — ${rows.length} lines · R ${money(total)}`} actions={<Button disabled={st.busy} onClick={() => void commit()}>Import for {periodLabel(period)}</Button>}>
          {filePeriod && filePeriod !== period && <div className="mb-2"><Alert tone="amber">The file says it is for {periodLabel(filePeriod)} but {periodLabel(period)} is selected.</Alert></div>}
          {(newCards > 0 || unalloc > 0) && <div className="mb-2"><Alert tone="amber">{newCards} card{newCards === 1 ? '' : 's'} not seen before will be created; {unalloc} existing card{unalloc === 1 ? '' : 's'} still unallocated. Allocate them under Fleet → Cards before generating the journal.</Alert></div>}
          <Table head={['Cost code', 'Driver / card', 'Reg', 'Holder', 'Fuel', 'Maint.*', 'Toll', 'Fees', 'Grand total', 'km']}>
            {matched.slice(0, 400).map(({ r, card }, i) => (
              <tr key={i} className={!card ? 'bg-amber-50' : card.holder_type === 'unallocated' ? 'bg-red-50' : ''}>
                <Td className="text-xs">{r.fa_name_code}</Td><Td>{r.fa_driver_name}</Td><Td>{r.fa_reg}</Td>
                <Td>{card ? <Badge tone={card.holder_type === 'staff' ? 'purple' : card.holder_type === 'vehicle' ? 'teal' : 'red'}>{card.holder_type}</Badge> : <Badge tone="amber">new</Badge>}</Td>
                <Td num><Money v={r.fuel || null} /></Td><Td num><Money v={r.repairs_excl + r.tyres_excl + r.accident_excl + r.maint_excl + r.overhaul_excl + r.other_excl + r.oil_excl || null} /></Td>
                <Td num><Money v={r.toll_excl || null} /></Td><Td num><Money v={r.fees_excl + r.fees_vat || null} /></Td><Td num className="font-semibold"><Money v={r.grand_total} /></Td><Td num>{num(r.kms)}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-1 text-xs text-slate-400">* Maintenance = oil, repairs, tyres, accident, maintenance, overhaul, other (excl VAT). {matched.length > 400 && `Showing first 400 of ${matched.length}.`}</p>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Avis
function AvisImport({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<AvisRow[] | null>(null); const [file, setFile] = useState('')
  const st = useStatus(); const vidx = useMemo(() => vehicleIndex(m.vehicles), [m.vehicles])
  const matched = (rows ?? []).map((r) => ({ r, v: vidx.get(r.reg) ?? null, b: m.bm.find(r.cost_centre_name) }))
  const total = matched.reduce((s, x) => s + x.r.amount_due, 0)
  const offPeriod = matched.filter((x) => x.r.transaction_date && !x.r.transaction_date.startsWith(period)).length
  async function onFile(f: File) { st.setMsg(null); try { const p = parseAvis(await readWorkbook(f)); setRows(p.rows); setFile(f.name) } catch (e) { st.setMsg({ tone: 'red', text: (e as Error).message }) } }
  async function commit(createMissing: boolean) {
    await st.run(async () => {
      let created = 0
      if (createMissing) {
        const miss = [...new Map(matched.filter((x) => !x.v).map((x) => [x.r.reg, x])).values()]
        if (miss.length) {
          const { error } = await supabase.from('fleet_vehicles').upsert(miss.map(({ r, b }) => { const [make, ...rest] = (r.make_model || '').split('_'); return { registration: r.reg, make, model: rest.join(' '), branch_id: b?.id ?? null, ownership: 'avis', avis_mva: r.mva_number || null, notes: `Created from Avis import ${period}` } }), { onConflict: 'registration' })
          if (error) throw error; created = miss.length; await m.reload()
        }
      }
      const { data: vs } = await supabase.from('fleet_vehicles').select('id,registration,branch_id'); const vi = new Map((vs ?? []).map((v) => [normReg(v.registration), v]))
      const id = await replaceImport('avis', period, null, file, matched.length, total)
      await insertChunked('fleet_avis_lines', matched.map(({ r, b }) => { const v = vi.get(r.reg); return { import_id: id, period, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, ...r } }))
      setRows(null)
      return `Imported ${matched.length} Avis lines (R ${money(total)} due) for ${periodLabel(period)}${created ? `; ${created} vehicles added to the master as Avis` : ''}.`
    })
  }
  const missing = matched.filter((x) => !x.v).length
  return (
    <div className="space-y-3">
      <FileDrop onFile={(f) => void onFile(f)} label="Drop the Avis monthly data (.xls/.xlsx)" />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {rows && rows.length > 0 && (
        <Card title={`${file} — ${rows.length} lines · R ${money(total)} due`} actions={<><Button disabled={st.busy} variant="secondary" onClick={() => void commit(false)}>Import</Button>{missing > 0 && <Button disabled={st.busy} onClick={() => void commit(true)}>Import + add {missing} missing vehicle{missing > 1 ? 's' : ''}</Button>}</>}>
          {offPeriod > 0 && <div className="mb-2"><Alert tone="amber">{offPeriod} line{offPeriod > 1 ? 's have' : ' has'} a transaction date outside {periodLabel(period)} — they are still imported under {periodLabel(period)}.</Alert></div>}
          <Table head={['Reg', 'Vehicle', 'Avis cost centre', 'Branch', 'Type', 'Date', 'Rental excl', 'VAT', 'VAT claimable', 'Expense', 'Amount due']}>
            {matched.slice(0, 400).map(({ r, v, b }, i) => (
              <tr key={i} className={!v ? 'bg-amber-50' : ''}>
                <Td>{r.reg}</Td><Td className="text-xs">{v ? `${v.make ?? ''} ${v.model ?? ''}` : <Badge tone="amber">not on master</Badge>}</Td><Td className="text-xs">{r.cost_centre_name}</Td>
                <Td>{v ? m.bm.code(v.branch_id) : b?.code ?? '?'}</Td><Td className="text-xs">{r.transaction_type}</Td><Td className="text-xs">{r.transaction_date}</Td>
                <Td num><Money v={r.rental_excl} /></Td><Td num><Money v={r.vat} /></Td><Td num><Money v={r.vat_claimable} /></Td><Td num><Money v={r.total} /></Td><Td num className="font-semibold"><Money v={r.amount_due} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Insurance
function InsuranceImport({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<InsuranceRow[] | null>(null); const [file, setFile] = useState('')
  const [inclVat, setInclVat] = useState(true)
  const st = useStatus(); const vidx = useMemo(() => vehicleIndex(m.vehicles), [m.vehicles])
  const matched = (rows ?? []).map((r) => ({ r, v: vidx.get(r.reg) ?? null, b: m.bm.find(r.branch_name) }))
  const split = (incl: number) => { const excl = inclVat ? round2(incl / (1 + m.vatRate / 100)) : incl; return { excl, vat: inclVat ? round2(incl - excl) : round2(incl * m.vatRate / 100) } }
  const total = matched.reduce((s, x) => s + x.r.premium_incl, 0)
  async function onFile(f: File) { st.setMsg(null); try { const p = parseInsurance(await readWorkbook(f)); setRows(p.rows); setFile(f.name) } catch (e) { st.setMsg({ tone: 'red', text: (e as Error).message }) } }
  async function commit() {
    await st.run(async () => {
      const id = await replaceImport('insurance', period, null, file, matched.length, total)
      await insertChunked('fleet_insurance_lines', matched.map(({ r, v, b }) => { const { excl, vat } = split(r.premium_incl); return { import_id: id, period, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, reg: r.reg, year: r.year, make: r.make, model: r.model, branch_name: r.branch_name, tracking_unit: r.tracking_unit, retail_value: r.retail_value, premium: excl, vat, rate: r.rate } }))
      // keep insured values / tracking units on the master fresh
      for (const { r, v } of matched) if (v && (r.retail_value || r.tracking_unit)) await supabase.from('fleet_vehicles').update({ insured_value: r.retail_value ?? v.insured_value, tracking_provider: r.tracking_unit || v.tracking_provider }).eq('id', v.id)
      setRows(null); await m.reload()
      return `Imported ${matched.length} insured vehicles (R ${money(total)} ${inclVat ? 'incl' : 'excl'} VAT) for ${periodLabel(period)}.`
    })
  }
  return (
    <div className="space-y-3">
      <FileDrop onFile={(f) => void onFile(f)} label="Drop the monthly insurance schedule (.xls/.xlsx) — needs Reg no + premium (Average deduction) columns" />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {rows && rows.length > 0 && (
        <Card title={`${file} — ${rows.length} vehicles · R ${money(total)}`} actions={<><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={inclVat} onChange={(e) => setInclVat(e.target.checked)} /> premiums include VAT ({m.vatRate}%)</label><Button disabled={st.busy} onClick={() => void commit()}>Import for {periodLabel(period)}</Button></>}>
          <Table head={['Reg', 'Vehicle', 'Sheet branch', 'Branch used', 'Tracking', 'Insured value', 'Premium', 'Excl', 'VAT']}>
            {matched.map(({ r, v, b }, i) => { const s = split(r.premium_incl); return (
              <tr key={i} className={!v ? 'bg-amber-50' : ''}>
                <Td>{r.reg}</Td><Td className="text-xs">{v ? `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}` : <Badge tone="amber">not on master ({r.year} {r.make} {r.model})</Badge>}</Td>
                <Td className="text-xs">{r.branch_name}</Td><Td>{v ? m.bm.code(v.branch_id) : b?.code ?? '?'}</Td><Td className="text-xs">{r.tracking_unit}</Td>
                <Td num>{num(r.retail_value)}</Td><Td num><Money v={r.premium_incl} /></Td><Td num><Money v={s.excl} /></Td><Td num><Money v={s.vat} /></Td>
              </tr>) })}
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Tracking
function TrackingImport({ m, period }: { m: Masters; period: string }) {
  const [provider, setProvider] = useState('Cartrack'); const [rows, setRows] = useState<TrackingRow[] | null>(null); const [file, setFile] = useState(''); const [assumed, setAssumed] = useState(false)
  const st = useStatus(); const vidx = useMemo(() => vehicleIndex(m.vehicles), [m.vehicles])
  const matched = (rows ?? []).map((r) => ({ r, v: vidx.get(r.reg) ?? null, b: m.bm.find(r.branch_name) }))
  const total = matched.reduce((s, x) => s + x.r.total, 0)
  async function onFile(f: File) { st.setMsg(null); try { const p = parseTracking(await readWorkbook(f), m.vatRate); setRows(p.rows); setFile(f.name); setAssumed(p.assumedVat) } catch (e) { st.setMsg({ tone: 'red', text: (e as Error).message }) } }
  async function commit() {
    await st.run(async () => {
      const id = await replaceImport('tracking', period, provider, file, matched.length, total)
      await insertChunked('fleet_tracking_lines', matched.map(({ r, v, b }) => ({ import_id: id, period, provider, vehicle_id: v?.id ?? null, branch_id: v?.branch_id ?? b?.id ?? null, ...r })))
      setRows(null)
      return `Imported ${matched.length} ${provider} lines (R ${money(total)} incl) for ${periodLabel(period)}.`
    })
  }
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <Field label="Tracking company"><Select value={provider} onChange={(e) => setProvider(e.target.value)}><option>Cartrack</option><option>Tracker</option><option>Netstar</option><option>Other</option></Select></Field>
        {provider === 'Other' && <Field label="Name"><Input onChange={(e) => setProvider(e.target.value || 'Other')} /></Field>}
      </div>
      <FileDrop onFile={(f) => void onFile(f)} label={`Drop the ${provider} monthly invoice detail (.xls/.xlsx/.csv) — needs a registration column plus amount/total`} />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {rows && rows.length > 0 && (
        <Card title={`${file} — ${rows.length} lines · R ${money(total)}`} actions={<Button disabled={st.busy} onClick={() => void commit()}>Import {provider} for {periodLabel(period)}</Button>}>
          {assumed && <div className="mb-2"><Alert tone="blue">No VAT column in this file — amounts are treated as excl VAT and {m.vatRate}% VAT is added.</Alert></div>}
          <Table head={['Invoice', 'Date', 'Reg', 'Vehicle', 'Sheet branch', 'Branch used', 'Description', 'Excl', 'VAT', 'Total']}>
            {matched.slice(0, 400).map(({ r, v, b }, i) => (
              <tr key={i} className={!v ? 'bg-amber-50' : ''}>
                <Td className="text-xs">{r.invoice}</Td><Td className="text-xs">{r.invoice_date}</Td><Td>{r.reg}</Td><Td className="text-xs">{v ? `${v.make ?? ''} ${v.model ?? ''}` : <Badge tone="amber">not on master</Badge>}</Td>
                <Td className="text-xs">{r.branch_name}</Td><Td>{v ? m.bm.code(v.branch_id) : b?.code ?? '?'}</Td><Td className="max-w-md truncate text-xs" title={r.description}>{r.description}</Td>
                <Td num><Money v={r.amount_excl} /></Td><Td num><Money v={r.vat} /></Td><Td num className="font-semibold"><Money v={r.total} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Travel logs (bulk workbook import)
interface Parsed { file: string; p: TravelLogParse; emp: { id: number; full_name: string; category: Category; branch_id: number | null; manager_email: string | null } | null }
function TravelLogImport({ m, period }: { m: Masters; period: string }) {
  const [items, setItems] = useState<Parsed[]>([]); const [approve, setApprove] = useState(true)
  const st = useStatus()
  const byNo = useMemo(() => employeeByEmpNo(m.employees), [m.employees]); const byName = useMemo(() => employeeByName(m.employees), [m.employees])
  async function onFile(f: File) {
    try {
      const p = parseTravelLogWorkbook(await readWorkbook(f))
      const emp = byNo.get(p.emp_no) ?? byName.get(normKey(p.employee_name)) ?? null
      setItems((xs) => [...xs.filter((x) => x.file !== f.name), { file: f.name, p, emp }])
    } catch (e) { st.setMsg({ tone: 'red', text: `${f.name}: ${(e as Error).message}` }) }
  }
  function setEmp(file: string, id: number) { setItems((xs) => xs.map((x) => (x.file === file ? { ...x, emp: m.employees.find((e) => e.id === id) ?? null } : x))) }
  async function commit() {
    await st.run(async () => {
      let n = 0; const user = (await supabase.auth.getUser()).data.user
      for (const it of items) {
        if (!it.emp) continue
        const per = it.p.period ?? period
        await supabase.from('fleet_travel_logs').delete().eq('period', per).eq('employee_id', it.emp.id).in('status', ['draft', 'submitted', 'rejected'])
        const { data: log, error } = await supabase.from('fleet_travel_logs').insert({
          period: per, employee_id: it.emp.id, vehicle_reg: it.p.vehicle_reg || null, branch_id: m.bm.find(it.p.branch)?.id ?? it.emp.branch_id, department: it.p.department || it.emp.category,
          opening_odo: it.p.opening_odo, opening_date: it.p.opening_date, closing_odo: it.p.closing_odo, closing_date: it.p.closing_date,
          business_km: it.p.business_km, private_km: it.p.private_km, status: 'submitted', submitted_at: new Date().toISOString(), manager_email: it.emp.manager_email, source: 'import', source_file: it.file, created_by: user?.id,
        }).select('id').single()
        if (error) throw new Error(`${it.file}: ${error.message}${error.message.includes('duplicate') ? ' (an approved log already exists for that month — re-open it first)' : ''}`)
        if (it.p.lines.length) await insertChunked('fleet_travel_log_lines', it.p.lines.map((l, i) => ({ log_id: log.id, line_no: i + 1, ...l })))
        if (approve) { const { error: dErr } = await supabase.rpc('fleet_decide_log', { p_log: log.id, p_approve: true, p_comment: 'Approved on import (signed paper log)' }); if (dErr) throw new Error(`${it.file}: ${dErr.message}`) }
        n++
      }
      setItems([])
      return `Imported ${n} travel log${n === 1 ? '' : 's'}${approve ? ' as approved — claims created' : ' as submitted'}. Notifications were not sent for imported logs.`
    })
  }
  const ready = items.filter((x) => x.emp).length
  return (
    <div className="space-y-3">
      <Alert tone="blue">Drop completed travel-log workbooks (the standard template, one per person — .xls/.xlsm/.xlsx). PDF logs cannot be read here; capture them via My Travel Logs or ask for the workbook.</Alert>
      <FileDrop onFile={(f) => void onFile(f)} accept=".xls,.xlsx,.xlsm" label="Drop travel log workbooks (one at a time or several)" />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {items.length > 0 && (
        <Card title={`${items.length} file${items.length > 1 ? 's' : ''} parsed`} actions={<><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> import as approved (creates claims)</label><Button disabled={st.busy || !ready} onClick={() => void commit()}>Import {ready} log{ready === 1 ? '' : 's'}</Button></>}>
          <Table head={['File', 'Emp no / name on file', 'Matched employee', 'Month', 'Vehicle', 'Opening', 'Closing', 'Business km', 'Private km', 'Lines']}>
            {items.map((it) => (
              <tr key={it.file} className={!it.emp ? 'bg-amber-50' : ''}>
                <Td className="max-w-xs truncate text-xs" title={it.file}>{it.file}</Td><Td className="text-xs">{it.p.emp_no} {it.p.employee_name}</Td>
                <Td><Select value={it.emp?.id ?? ''} onChange={(e) => setEmp(it.file, Number(e.target.value))}><option value="">— choose —</option>{m.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.emp_no})</option>)}</Select></Td>
                <Td>{it.p.period ? periodLabel(it.p.period) : <Badge tone="amber">{periodLabel(period)}?</Badge>}</Td><Td>{it.p.vehicle_reg}</Td><Td num>{num(it.p.opening_odo)}</Td><Td num>{num(it.p.closing_odo)}</Td>
                <Td num className="font-semibold">{num(it.p.business_km)}</Td><Td num>{num(it.p.private_km)}</Td><Td num>{it.p.lines.length}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Accrual opening balances
function AccrualImport({ m, period }: { m: Masters; period: string }) {
  const [rows, setRows] = useState<OpeningRow[] | null>(null); const [file, setFile] = useState('')
  const st = useStatus(); const byNo = useMemo(() => employeeByEmpNo(m.employees), [m.employees]); const byName = useMemo(() => employeeByName(m.employees), [m.employees])
  const matched = (rows ?? []).map((r) => ({ r, emp: byNo.get(r.emp_no) ?? byName.get(normKey(r.name)) ?? null }))
  const total = matched.reduce((s, x) => s + x.r.balance, 0)
  async function onFile(f: File) { st.setMsg(null); try { setRows(parseOpeningBalances(await readWorkbook(f))); setFile(f.name) } catch (e) { st.setMsg({ tone: 'red', text: (e as Error).message }) } }
  async function commit() {
    await st.run(async () => {
      const ok = matched.filter((x) => x.emp)
      const id = await replaceImport('accrual_opening', period, null, file, ok.length, total)
      await supabase.from('fleet_accrual_txns').delete().eq('kind', 'opening').in('employee_id', ok.map((x) => x.emp!.id))
      const user = (await supabase.auth.getUser()).data.user
      await insertChunked('fleet_accrual_txns', ok.map(({ r, emp }) => ({ employee_id: emp!.id, txn_date: `${period}-01`, period, kind: 'opening', amount: r.balance, description: `Opening maintenance accrual balance (${file})`, import_id: id, created_by: user?.id })))
      setRows(null)
      return `Loaded ${ok.length} opening balances (R ${money(total)}). ${matched.length - ok.length} rows could not be matched to an employee.`
    })
  }
  return (
    <div className="space-y-3">
      <Alert tone="blue">Workbook with columns <b>Emp No</b>, <b>Name</b>, <b>Balance</b> (maintenance accrual owed to each person as at the start of {periodLabel(period)}). Re-importing replaces earlier opening balances for the same people.</Alert>
      <FileDrop onFile={(f) => void onFile(f)} label="Drop the opening balance workbook" />
      {st.msg && <Alert tone={st.msg.tone}>{st.msg.text}</Alert>}
      {rows && rows.length > 0 && (
        <Card title={`${file} — ${rows.length} rows · R ${money(total)}`} actions={<Button disabled={st.busy} onClick={() => void commit()}>Load balances</Button>}>
          <Table head={['Emp no', 'Name on file', 'Matched employee', 'Balance']}>
            {matched.map(({ r, emp }, i) => <tr key={i} className={!emp ? 'bg-amber-50' : ''}><Td>{r.emp_no}</Td><Td>{r.name}</Td><Td>{emp ? `${emp.full_name} (${emp.emp_no})` : <Badge tone="amber">no match</Badge>}</Td><Td num><Money v={r.balance} /></Td></tr>)}
          </Table>
        </Card>
      )}
    </div>
  )
}
