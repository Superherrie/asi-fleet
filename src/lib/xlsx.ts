import * as XLSX from 'xlsx'

export function downloadWorkbook(sheets: { name: string; rows: (string | number | null)[][]; widths?: number[] }[], fileName: string) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.widths) ws['!cols'] = s.widths.map((w) => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}

export function downloadCsv(rows: (string | number | null)[][], fileName: string) {
  const esc = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); URL.revokeObjectURL(a.href)
}
