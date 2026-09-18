import { supabase } from './supabase'
import type { Employee, TravelLog, TravelLogLine } from './types'
import { periodLabel } from './format'
import { downloadWorkbook } from './xlsx'

/** Everything needed to print one person's logbook: the person, their logs (oldest first) and each log's trip lines. */
export interface LogBook { employee: Employee | null; branchName: string; logs: { log: TravelLog; lines: TravelLogLine[] }[] }

export async function loadLogBook(employeeId: number, logIds?: number[]): Promise<LogBook> {
  let q = supabase.from('fleet_travel_logs').select('*').eq('employee_id', employeeId).order('period').order('vehicle_reg')
  if (logIds?.length) q = q.in('id', logIds)
  const [{ data: logs }, { data: emp }] = await Promise.all([q, supabase.from('fleet_employees').select('*').eq('id', employeeId).maybeSingle()])
  const list = (logs ?? []) as TravelLog[]
  const { data: lines } = list.length ? await supabase.from('fleet_travel_log_lines').select('*').in('log_id', list.map((l) => l.id)).order('log_id').order('line_no') : { data: [] }
  const { data: br } = emp?.branch_id ? await supabase.from('fleet_branches').select('name').eq('id', emp.branch_id).maybeSingle() : { data: null }
  return { employee: (emp as Employee) ?? null, branchName: br?.name ?? '', logs: list.map((log) => ({ log, lines: ((lines ?? []) as TravelLogLine[]).filter((x) => x.log_id === log.id) })) }
}

/** SARS tax year label for a period: the year of assessment runs 1 March – end of February and is named after the year it ends in. */
export const taxYearOf = (period: string) => { const [y, m] = period.split('-').map(Number); return m >= 3 ? y + 1 : y }
export const taxYearLabel = (ty: number) => `${ty} tax year (Mar ${ty - 1} – Feb ${ty})`

const KIND: Record<string, string> = { own: 'Own vehicle', second: 'Second vehicle', rental: 'Rental / replacement vehicle' }
const HEAD = ['Date', 'Day', 'Opening km', 'Closing km', 'Total km', 'Business km', 'Private km', 'Destination', 'Reason for visit']
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayOf = (d: string | null) => (d ? DAY[new Date(d + 'T00:00:00').getDay()] ?? '' : '')
const tripRow = (l: TravelLogLine): (string | number | null)[] => [l.trip_date, dayOf(l.trip_date), l.opening_km, l.closing_km, l.opening_km != null && l.closing_km != null ? l.closing_km - l.opening_km : null, l.business_km || null, l.private_km || null, l.destination ?? '', l.reason ?? '']
const approval = (log: TravelLog) => log.status === 'approved' || log.status === 'processed' ? `Approved ${log.approved_at ? log.approved_at.slice(0, 10) : ''} by ${log.manager_email ?? 'manager'}` : `Status: ${log.status}`
const fileStem = (b: LogBook, label: string) => `Travel logbook ${b.employee?.full_name ?? ''} ${label}`.replace(/[\\/:*?"<>|]/g, '').trim()

export function logBookToExcel(b: LogBook, label: string) {
  const summary: (string | number | null)[][] = [
    [`Travel logbook — ${b.employee?.full_name ?? ''}`], [`Employee no: ${b.employee?.emp_no ?? ''}   Branch: ${b.branchName}   Period covered: ${label}`], [],
    ['Month', 'Vehicle', 'Vehicle type', 'Opening odometer', 'Closing odometer', 'Total km', 'Business km', 'Private km', '% business', 'Status', 'Approved', 'Approver'],
  ]
  for (const { log } of b.logs) { const tot = log.business_km + log.private_km; summary.push([periodLabel(log.period), log.vehicle_reg, KIND[log.vehicle_kind ?? 'own'], log.opening_odo, log.closing_odo, tot, log.business_km, log.private_km, tot ? Math.round((log.business_km / tot) * 1000) / 10 : null, log.status, log.approved_at?.slice(0, 10) ?? '', log.manager_email ?? '']) }
  const tb = b.logs.reduce((s, x) => s + x.log.business_km, 0), tp = b.logs.reduce((s, x) => s + x.log.private_km, 0)
  summary.push([], ['Total', null, null, null, null, tb + tp, tb, tp, tb + tp ? Math.round((tb / (tb + tp)) * 1000) / 10 : null])
  const used = new Set<string>()
  const sheets = b.logs.map(({ log, lines }) => {
    let name = `${log.period} ${log.vehicle_reg ?? ''}`.trim().slice(0, 31); while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`; used.add(name)
    return { name, widths: [12, 6, 12, 12, 10, 12, 11, 34, 40], rows: [
      [`Travel log — ${periodLabel(log.period)}`], [`${b.employee?.full_name ?? ''} (${b.employee?.emp_no ?? ''}) · ${b.branchName}`],
      [`Vehicle: ${log.vehicle_reg ?? ''} · ${KIND[log.vehicle_kind ?? 'own']}${log.vehicle_note ? ' · ' + log.vehicle_note : ''}`],
      [`Opening odometer: ${log.opening_odo ?? ''}   Closing odometer: ${log.closing_odo ?? ''}   ${approval(log)}`], [],
      HEAD, ...lines.map(tripRow), [], ['Total', null, null, null, log.business_km + log.private_km, log.business_km, log.private_km],
    ] as (string | number | null)[][] }
  })
  downloadWorkbook([{ name: 'Summary', rows: summary, widths: [12, 12, 24, 16, 16, 10, 12, 11, 11, 11, 12, 34] }, ...sheets], `${fileStem(b, label)}.xlsx`)
}

/** PDF logbook: a summary page, then one section per log. jsPDF is loaded on demand so it stays out of the main bundle. */
export async function logBookToPdf(b: LogBook, label: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const navy: [number, number, number] = [14, 11, 46]; const W = doc.internal.pageSize.getWidth()
  const n = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('en-ZA'))
  const title = (t: string, sub: string[]) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...navy); doc.text(t, 14, 16); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70); sub.forEach((s, i) => doc.text(s, 14, 22 + i * 4.5)); return 22 + sub.length * 4.5 }
  let y = title(`Travel logbook — ${b.employee?.full_name ?? ''}`, [`Employee no ${b.employee?.emp_no ?? ''} · ${b.branchName} · ${label}`, 'ASI Connect ICS · generated from the Fleet & Asset Management app'])
  const tb = b.logs.reduce((s, x) => s + x.log.business_km, 0), tp = b.logs.reduce((s, x) => s + x.log.private_km, 0)
  autoTable(doc, { startY: y + 2, styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: navy }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    head: [['Month', 'Vehicle', 'Type', 'Opening odo', 'Closing odo', 'Total km', 'Business km', 'Private km', '% business', 'Status', 'Approved', 'Approver']],
    body: b.logs.map(({ log }) => { const t = log.business_km + log.private_km; return [periodLabel(log.period), log.vehicle_reg ?? '', KIND[log.vehicle_kind ?? 'own'], n(log.opening_odo), n(log.closing_odo), n(t), n(log.business_km), n(log.private_km), t ? ((log.business_km / t) * 100).toFixed(1) + '%' : '', log.status, log.approved_at?.slice(0, 10) ?? '', log.manager_email ?? ''] }),
    foot: [['Total', '', '', '', '', n(tb + tp), n(tb), n(tp), tb + tp ? ((tb / (tb + tp)) * 100).toFixed(1) + '%' : '', '', '', '']], footStyles: { fillColor: [245, 244, 248], textColor: 20, fontStyle: 'bold' } })
  for (const { log, lines } of b.logs) {
    doc.addPage()
    y = title(`Travel log — ${periodLabel(log.period)}`, [`${b.employee?.full_name ?? ''} (${b.employee?.emp_no ?? ''}) · ${b.branchName}`, `Vehicle ${log.vehicle_reg ?? ''} · ${KIND[log.vehicle_kind ?? 'own']}${log.vehicle_note ? ' · ' + log.vehicle_note : ''}`, `Opening odometer ${n(log.opening_odo)} · Closing odometer ${n(log.closing_odo)} · ${approval(log)}`])
    autoTable(doc, { startY: y + 2, styles: { fontSize: 8, cellPadding: 1.3, overflow: 'linebreak' }, headStyles: { fillColor: navy }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { cellWidth: 60 }, 8: { cellWidth: 75 } },
      head: [HEAD], body: lines.map((l) => tripRow(l).map((c) => (typeof c === 'number' ? n(c) : c ?? ''))),
      foot: [['Total', '', '', '', n(log.business_km + log.private_km), n(log.business_km), n(log.private_km), '', '']], footStyles: { fillColor: [245, 244, 248], textColor: 20, fontStyle: 'bold' } })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(`${b.employee?.full_name ?? ''} · travel logbook · page ${i} of ${pages}`, W - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' }) }
  doc.save(`${fileStem(b, label)}.pdf`)
}
