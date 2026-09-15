import fs from 'node:fs'; import XLSX from 'xlsx'; XLSX.set_fs(fs);
const wb = XLSX.read(fs.readFileSync('C:/Users/User1/Downloads/Customer Monthly Report ASI CONNECT SEPT 2026.xlsx'), { type: 'buffer', cellDates: true });
console.log('sheets:', wb.SheetNames.join(' | '));
for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }); console.log(`\n== ${n}: ${rows.length} rows x ${Math.max(...rows.map((r) => r.length))} cols`); rows.slice(0, 6).forEach((r, i) => console.log(i, r.map((c) => c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).join(' | ').slice(0, 400))); }
