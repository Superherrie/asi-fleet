// Loads CBS copier tax invoices (PDF) into fleet_copier_invoices, using the same parser as the app.
//   node scripts/import-copier-invoices.mjs "<file.pdf>" ["<file2.pdf>" ...] [--apply]
import fs from 'node:fs'; import path from 'node:path'; import { createClient } from '@supabase/supabase-js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseCopierInvoices, invoiceGap } from '../src/lib/copierPdf.ts';
for (const l of fs.readFileSync('scripts/.env','utf8').split(/\r?\n/)) { const m=l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if(m) process.env[m[1]]??=m[2].trim(); }
const s=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply=process.argv.includes('--apply'); const files=process.argv.slice(2).filter(a=>!a.startsWith('--'));
async function lines(file) { const doc=await pdfjs.getDocument({ data:new Uint8Array(fs.readFileSync(file)), verbosity:0 }).promise; const out=[];
  for (let p=1;p<=doc.numPages;p++) { const tc=await (await doc.getPage(p)).getTextContent(); const rows=new Map();
    for (const it of tc.items) { if(!it.str?.trim()) continue; const y=it.transform[5]; const k=[...rows.keys()].find(v=>Math.abs(v-y)<=3) ?? y; (rows.get(k) ?? rows.set(k,[]).get(k)).push({x:it.transform[4],s:it.str}); }
    for (const k of [...rows.keys()].sort((a,b)=>b-a)) out.push(rows.get(k).sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ')); out.push(''); } return out; }
const { data: cop } = await s.from('fleet_copiers').select('id,serial_no,model,branch_id,location,rental_excl'); const bySerial=new Map(); for (const c of cop) for (const sn of c.serial_no.split('/')) bySerial.set(sn.trim().toUpperCase(), c);
for (const f of files) { const inv=parseCopierInvoices(await lines(f)); console.log(`\n${path.basename(f)}: ${inv.length} invoices`);
  for (const i of inv) { const c=bySerial.get(i.serial_no); const gap=invoiceGap(i);
    console.log(`  ${i.invoice_no} ${i.invoice_date} ${i.kind.padEnd(7)} ${i.serial_no.padEnd(15)} ${c?'copier '+c.id:'NO MATCH'} | rental ${i.rental_excl} fee ${i.admin_fee} | mono ${i.mono?`${i.mono.open}→${i.mono.close} ${i.mono.qty}@${i.mono.rate}=${i.mono.charge}`:'-'} | colour ${i.colour?`${i.colour.open}→${i.colour.close} ${i.colour.qty}@${i.colour.rate}=${i.colour.charge}`:'-'} | scan ${i.scan?`${i.scan.qty}@${i.scan.rate}=${i.scan.charge}`:'-'} | sub ${i.subtotal} vat ${i.vat} total ${i.total}${gap?` | GAP ${gap}`:''} | ${i.site}`);
    if (apply) { const row={ copier_id:c?.id??null, serial_no:i.serial_no, supplier_entity:i.supplier_entity, account_no:i.account_no, customer_name:i.customer_name, invoice_no:i.invoice_no, invoice_date:i.invoice_date, period:i.period, kind:i.kind, contract_no:i.contract_no, model:i.model, site:i.site, rental_excl:i.rental_excl, rental_for:i.rental_for, admin_fee:i.admin_fee,
        mono_open:i.mono?.open??null, mono_close:i.mono?.close??null, mono_qty:i.mono?.qty??null, mono_rate:i.mono?.rate??null, mono_charge:i.mono?.charge??null, mono_read:i.mono?.read_date??null,
        colour_open:i.colour?.open??null, colour_close:i.colour?.close??null, colour_qty:i.colour?.qty??null, colour_rate:i.colour?.rate??null, colour_charge:i.colour?.charge??null,
        scan_qty:i.scan?.qty??null, scan_rate:i.scan?.rate??null, scan_charge:i.scan?.charge??null, subtotal:i.subtotal, vat:i.vat, total:i.total, source_file:path.basename(f) };
      const { error } = await s.from('fleet_copier_invoices').upsert(row, { onConflict:'invoice_no' }); if (error) console.log('    ERR', error.message);
      if (c && i.contract_no) await s.from('fleet_copiers').update(i.kind==='rental' ? { contract_no:i.contract_no } : { service_contract_no:i.contract_no }).eq('id', c.id); } } }
console.log(apply ? '\napplied' : '\ndry run — add --apply to load');
