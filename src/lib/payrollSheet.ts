// Styled "Payroll Entries" workbook (Tracey's layout) built with exceljs.
// Also imported directly by scripts/aug-payroll-pack.mjs (Node strips the types).
import ExcelJS from 'exceljs'

export interface PayrollRow {
  emp_no: string; name: string; department: string; branch: string
  fa_deduction: number; reimbursement: number; provision: number; business_km: number
  fuel_rate: number | null; maint_rate: number | null; note: string
}
export interface PayrollSheetInput {
  periodLabel: string; payLabel: string; rows: PayrollRow[]; lateRows: PayrollRow[]; generatedBy?: string
}

const NAVY = 'FF0E0B2E', PINK = 'FFE91E63', CARD = 'FFF5F4F8', HAIR = 'FFE6E3EC', AMBER = 'FFFFF4D6', AMBER_INK = 'FF7A4B00'
const COLS = [
  { key: 'emp_no', header: 'Emp No', width: 9 }, { key: 'name', header: 'Name', width: 30 }, { key: 'department', header: 'Department', width: 13 },
  { key: 'branch', header: 'Branch', width: 16 }, { key: 'fa_deduction', header: 'Deduction\nFA Card', width: 14, fmt: '#,##0.00' },
  { key: 'reimbursement', header: 'Earnings\nReim-N', width: 14, fmt: '#,##0.00' }, { key: 'provision', header: 'Earning\nMaint Provision', width: 15, fmt: '#,##0.00' },
  { key: 'provision_ded', header: 'Deduction\nMaint Provision', width: 15, fmt: '#,##0.00' }, { key: 'earning_total', header: 'Earning\nTotal', width: 14, fmt: '#,##0.00' },
  { key: 'business_km', header: 'Business Km\nfor the Month', width: 13, fmt: '#,##0' }, { key: 'fuel_rate', header: 'Fuel Rate\nR / km', width: 10, fmt: '0.00' },
  { key: 'maint_rate', header: 'Maint. Rate\nR / km', width: 10, fmt: '0.00' }, { key: 'note', header: 'Note', width: 44 },
] as const
const MONEY = new Set(['fa_deduction', 'reimbursement', 'provision', 'provision_ded', 'earning_total'])

export function buildPayrollWorkbook(input: PayrollSheetInput) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ASI Fleet'; wb.created = new Date()
  const ws = wb.addWorksheet(input.periodLabel, { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = COLS.map((c) => ({ key: c.key, width: c.width }))

  // title band
  ws.mergeCells(1, 1, 1, COLS.length)
  const t = ws.getCell(1, 1); t.value = `Payroll Entries for ${input.periodLabel} — to be paid with ${input.payLabel} payroll`
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; t.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, COLS.length)
  const s = ws.getCell(2, 1); s.value = `Generated ${new Date().toLocaleDateString('en-ZA')} by ASI Fleet · ${input.rows.length} card holders · FA card deduction = First Auto usage excl. toll · Reim-N = business km × fuel rate (paid) · Maint Provision = business km × maintenance rate (earned and deducted, accrues per person)`
  s.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B6B80' } }; s.alignment = { vertical: 'middle', indent: 1, wrapText: true }
  ws.getRow(2).height = 28
  ws.getRow(3).height = 4; ws.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } }; ws.mergeCells(3, 1, 3, COLS.length)

  const header = ws.getRow(4)
  COLS.forEach((c, i) => {
    const cell = header.getCell(i + 1); cell.value = c.header
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: 'fmt' in c ? 'right' : 'left', wrapText: true }; cell.border = { bottom: { style: 'medium', color: { argb: PINK } } }
  })
  header.height = 32
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLS.length } }

  const totals = { fa: 0, reim: 0, prov: 0, km: 0 }
  const addRow = (r: PayrollRow, zebra: boolean) => {
    const row = ws.addRow({ ...r, provision_ded: r.provision, earning_total: Math.round((r.reimbursement + r.provision) * 100) / 100 })
    row.height = 16
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1); cell.font = { name: 'Calibri', size: 10 }
      if ('fmt' in c) cell.numFmt = c.fmt; cell.alignment = { vertical: 'middle', horizontal: 'fmt' in c ? 'right' : 'left' }
      cell.border = { bottom: { style: 'hair', color: { argb: HAIR } } }
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD } }
      if (MONEY.has(c.key) && !(cell.value as number)) cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFB0B0BC' } }
    })
    if (r.note) { const n = row.getCell(COLS.length); n.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }; n.font = { name: 'Calibri', size: 9, italic: true, color: { argb: AMBER_INK } } }
    totals.fa += r.fa_deduction; totals.reim += r.reimbursement; totals.prov += r.provision; totals.km += r.business_km
    return row
  }
  input.rows.forEach((r, i) => addRow(r, i % 2 === 1))
  const main = { ...totals } // snapshot before late claims are appended

  const totalRow = ws.addRow({ emp_no: 'Grand Total', fa_deduction: r2(totals.fa), reimbursement: r2(totals.reim), provision: r2(totals.prov), provision_ded: r2(totals.prov), earning_total: r2(totals.reim + totals.prov), business_km: totals.km })
  ws.mergeCells(totalRow.number, 1, totalRow.number, 4); totalRow.height = 20
  COLS.forEach((c, i) => { const cell = totalRow.getCell(i + 1); cell.font = { name: 'Calibri', size: 10, bold: true }; if ('fmt' in c) { cell.numFmt = c.fmt; cell.alignment = { horizontal: 'right' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARD } }; cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'double', color: { argb: NAVY } } } })

  if (input.lateRows.length) {
    ws.addRow([]); const lt = ws.addRow(['Late claims — logs for earlier months received after that month\'s payroll ran. Add to this run.'])
    ws.mergeCells(lt.number, 1, lt.number, COLS.length); lt.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; lt.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } }; lt.height = 18
    const late = { reim: 0, prov: 0 }
    input.lateRows.forEach((r, i) => { addRow(r, i % 2 === 1); late.reim += r.reimbursement; late.prov += r.provision })
    const lr = ws.addRow({ emp_no: 'Late claims total', reimbursement: r2(late.reim), provision: r2(late.prov), provision_ded: r2(late.prov), earning_total: r2(late.reim + late.prov) })
    ws.mergeCells(lr.number, 1, lr.number, 4)
    COLS.forEach((c, i) => { const cell = lr.getCell(i + 1); cell.font = { name: 'Calibri', size: 10, bold: true }; if ('fmt' in c) { cell.numFmt = c.fmt; cell.alignment = { horizontal: 'right' } }; cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'double', color: { argb: NAVY } } } })
  }

  // summary sheet
  const sum = wb.addWorksheet('Summary'); sum.columns = [{ width: 44 }, { width: 18 }]
  const put = (label: string, value: number | string, bold = false, fmt?: string) => { const row = sum.addRow([label, value]); row.getCell(1).font = { name: 'Calibri', size: 11, bold }; row.getCell(2).font = { name: 'Calibri', size: 11, bold }; if (fmt) row.getCell(2).numFmt = fmt; row.getCell(2).alignment = { horizontal: 'right' } }
  const h = sum.addRow([`Payroll Entries for ${input.periodLabel}`]); sum.mergeCells(1, 1, 1, 2); h.getCell(1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; h.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; h.height = 24
  sum.addRow([])
  put('Card holders on sheet', input.rows.length)
  put('Travel logs received (claims)', input.rows.filter((r) => r.business_km > 0).length)
  put('Travel logs outstanding', input.rows.filter((r) => r.business_km === 0).length)
  sum.addRow([])
  put('Deduction — FA card (recovered from salary)', r2(main.fa), true, '#,##0.00')
  put('Earnings — Reim-N (fuel portion, paid out)', r2(main.reim), true, '#,##0.00')
  put('Maintenance provision (earned & deducted → accrual)', r2(main.prov), true, '#,##0.00')
  put('Business km claimed', main.km, false, '#,##0')
  if (input.lateRows.length) { sum.addRow([]); put('Late claims — Reim-N', r2(input.lateRows.reduce((a, r) => a + r.reimbursement, 0)), true, '#,##0.00'); put('Late claims — Maint provision', r2(input.lateRows.reduce((a, r) => a + r.provision, 0)), true, '#,##0.00') }
  return wb
}
const r2 = (n: number) => Math.round(n * 100) / 100

export async function downloadPayrollWorkbook(input: PayrollSheetInput, fileName: string) {
  const buf = await buildPayrollWorkbook(input).xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); URL.revokeObjectURL(a.href)
}
