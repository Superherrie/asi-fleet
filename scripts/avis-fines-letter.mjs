// Builds the Avis fines query letter on the ASI Connect ICS letterhead (template body swapped, header/footer kept) with
// Addendum A (per registration) and Addendum B (each fine with Avis invoice number). Output → Fleet\Output.
import fs from 'node:fs'; import JSZip from 'jszip'; import { createClient } from '@supabase/supabase-js';
for (const l of fs.readFileSync('scripts/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const [{ data: lines }, { data: veh }, { data: emps }, { data: cards }, { data: br }] = await Promise.all([
  sb.from('fleet_avis_lines').select('period,reg,driver_name,cost_centre_name,amount_due,transaction_date,vehicle_id,branch_id,document_no,transaction_number,mva_number').eq('transaction_type', 'FINESINV').eq('period', '2026-08'),
  sb.from('fleet_vehicles').select('id,registration,make,model,branch_id,ownership'), sb.from('fleet_employees').select('id,full_name,vehicle_reg'), sb.from('fleet_cards').select('fa_driver_name,fa_reg,vehicle_id,employee_id,active'), sb.from('fleet_branches').select('id,code,name')]);
const B = (id) => br.find((b) => b.id === id)?.name ?? '';
const per = new Map();
for (const l of lines) {
  const reg = norm(l.reg); const v = veh.find((x) => x.id === l.vehicle_id) ?? veh.find((x) => norm(x.registration) === reg);
  const owner = emps.find((e) => norm(e.vehicle_reg) === reg); const card = cards.find((c) => c.active && ((c.vehicle_id && c.vehicle_id === v?.id) || norm(c.fa_reg) === reg)); const cardEmp = card?.employee_id ? emps.find((e) => e.id === card.employee_id) : null;
  const driver = l.driver_name || owner?.full_name || cardEmp?.full_name || card?.fa_driver_name || '';
  const r = per.get(reg) ?? { reg: l.reg, driver, vehicle: v ? `${v.make ?? ''} ${v.model ?? ''}`.trim() : '', onFleet: !!v, avis: v?.ownership === 'avis', branch: v ? B(v.branch_id) : '', cc: l.cost_centre_name ?? '', n: 0, amt: 0, first: null, last: null };
  r.n++; r.amt += Number(l.amount_due); if (!r.driver && driver) r.driver = driver;
  if (l.transaction_date) { r.first = r.first && r.first < l.transaction_date ? r.first : l.transaction_date; r.last = r.last && r.last > l.transaction_date ? r.last : l.transaction_date }
  per.set(reg, r);
}
const regs = [...per.values()].sort((a, b) => b.n - a.n || a.reg.localeCompare(b.reg));
const total = regs.reduce((s, r) => s + r.n, 0); const totalR = regs.reduce((s, r) => s + r.amt, 0);
const notFleet = regs.filter((r) => !r.onFleet); const notAvis = regs.filter((r) => r.onFleet && !r.avis);
const dates = lines.map((l) => l.transaction_date).filter(Boolean).sort(); const fmtD = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const R = (n) => 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ').replace(/\./, ',');

// ---------------- WordprocessingML helpers
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (t, o = {}) => `<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const p = (t, o = {}) => `<w:p><w:pPr><w:pStyle w:val="${o.style ?? 'Body'}"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ''}${o.keep ? '<w:keepNext/>' : ''}${o.after != null ? `<w:spacing w:after="${o.after}"/>` : ''}${o.pageBreak ? '<w:pageBreakBefore/>' : ''}</w:pPr>${Array.isArray(t) ? t.map((x) => (typeof x === 'string' ? run(x, o) : run(x.t, { ...o, ...x }))).join('') : run(t, o)}</w:p>`;
const num = (items) => items.map((t, i) => `<w:p><w:pPr><w:pStyle w:val="Body"/><w:ind w:left="567" w:hanging="425"/><w:spacing w:after="100"/></w:pPr>${run(`${i + 1}.`, { bold: true })}<w:r><w:tab/></w:r>${typeof t === 'string' ? run(t) : t}</w:p>`).join('');
const cell = (t, w, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}<w:tcMar><w:top w:w="28" w:type="dxa"/><w:bottom w:w="28" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>${run(t, { size: o.size ?? 16, bold: o.bold, color: o.color })}</w:p></w:tc>`;
const table = (head, rows, widths, opts = {}) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
  `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${head.map((h, i) => cell(h, widths[i], { shade: '1B1B3A', color: 'FFFFFF', bold: true, size: opts.size ?? 16 })).join('')}</w:tr>` +
  rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, widths[i], { size: opts.size ?? 16, align: opts.right?.includes(i) ? 'right' : undefined, shade: opts.flag?.(ri) ? 'FFF3CD' : undefined })).join('')}</w:tr>`).join('') + `</w:tbl>${p('', { after: 0 })}`;

const today = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const body = [
  p(today, { align: 'right' }),
  p('Avis Fleet (a division of Zeda Limited)', { bold: true, after: 0 }), p('Customer Account Management', { after: 0 }), p('Customer account CI0009663 — ASI Connect ICS', { after: 0 }), p('By e-mail', { after: 240 }),
  p('Attention: Account Manager, ASI Connect ICS', { after: 240 }),
  p(`Traffic fine administration fees — statement 202607 dated 3 August 2026 — ${total} fees, ${R(totalR)}`, { bold: true, after: 240 }),
  p('Dear Sir / Madam'),
  p(`Your statement for account CI0009663 dated 3 August 2026 (billing period 202607) carries ${total} separate fine administration fees (document type FINESINV) of R57,50 each, a total of ${R(totalR)} including VAT, processed between ${fmtD(dates[0])} and ${fmtD(dates[dates.length - 1])}. The fees were collected with the statement by debit order.`),
  p(`This volume makes no sense to us. It represents ${total} traffic fines redirected in roughly two weeks across ${regs.length} registrations, where our history on this account runs at six to twelve fines a month. Individual vehicles are charged for as many as ${regs[0].n} fines in that period (${regs[0].reg}). We have had no corresponding volume of infringement notices reach our drivers, and no fines report from Avis Fleet that would support these charges.`),
  p(`In addition, ${notFleet.length} of the registrations charged are not vehicles on our fleet at all (for example ${notFleet.slice(0, 4).map((r) => r.reg).join(', ')}), and a further ${notAvis.length} are our own vehicles that are not Avis Fleet rentals. We do not understand on what basis fines on these registrations are being administered against our account.`),
  p('We therefore request the following, per fine, for every one of the fees listed in Addendum B:', { keep: true }),
  num([
    'The infringement notice number, the issuing authority, the offence date, time and location, the offence description and the fine amount.',
    'The date the notice was received by Avis Fleet and the date the redirection (nomination of driver) was submitted.',
    'The name and identity of the person or entity nominated as driver, and the source of that nomination.',
    'A copy of the infringement notice and a copy of the redirection / nomination document submitted to the authority, together with the authority’s acknowledgement, as proof that the redirection was actually processed.',
    'The contractual basis for the R50,00 administration fee per fine, and confirmation of whether the fee is charged where a redirection is rejected, duplicated, cancelled or not processed.',
    'An explanation of why registrations that are not on our Avis Fleet contract, or not our vehicles at all (Addendum A, marked), have been charged to account CI0009663, and on whose instruction.',
    'Confirmation that no fine has been charged more than once, given that single registrations attract up to 25 fees in the period.',
  ]),
  p(`Pending your reply and the supporting documents, we dispute the full amount of ${R(totalR)} and request that it be credited to the account. Where a redirection is shown to have been validly processed for a vehicle on our contract, we will accept the fee for that fine. We reserve our rights in respect of any amounts already debited.`),
  p('Going forward, please provide a monthly fines report with the statement listing, per registration, each notice number, offence, nominated driver and status, so that the fees can be verified before they are debited.'),
  p('We would appreciate your response within ten working days. Please direct it to the undersigned.', { after: 360 }),
  p('Yours faithfully', { after: 600 }),
  p('Herman de Vries', { bold: true, after: 0 }), p('Chief Executive Officer', { after: 0 }), p('ASI Connect ICS', { after: 0 }), p('herman.devries@asiconnect.co.za', { after: 240 }),
  p('Addenda: A — fees per registration; B — each fee with your invoice number.', { italic: true, size: 18 }),

  // Addendum A
  p('Addendum A — Fine administration fees per registration, statement 202607 (3 August 2026)', { style: 'Header2', pageBreak: true, keep: true }),
  p(`${regs.length} registrations · ${total} fees · ${R(totalR)} incl VAT. Rows shaded amber are registrations that are not on our fleet; “Own vehicle” means an ASI vehicle that is not an Avis Fleet rental.`, { size: 18 }),
  table(['Registration', 'Driver / holder', 'Vehicle', 'Our branch', 'Avis cost centre', 'Status', 'Fees', 'Amount', 'Dates'],
    regs.map((r) => [r.reg, r.driver, r.vehicle, r.branch, r.cc, !r.onFleet ? 'NOT OUR VEHICLE' : r.avis ? 'Avis rental' : 'Own vehicle', String(r.n), R(r.amt), r.first === r.last ? (r.first ?? '') : `${r.first} – ${r.last}`]),
    [1150, 1700, 1500, 950, 1150, 1100, 500, 900, 1150], { size: 14, right: [6, 7], flag: (i) => !regs[i].onFleet }),
  p(['Total', { t: `   ${total} fees   ${R(totalR)}`, bold: true }], { bold: true }),

  // Addendum B
  p('Addendum B — Each fine administration fee as billed, with Avis Fleet invoice number', { style: 'Header2', pageBreak: true, keep: true }),
  p('Please supply the items requested in the letter against each invoice number below.', { size: 18 }),
  table(['#', 'Transaction date', 'Avis invoice no.', 'Avis reference', 'MVA', 'Registration', 'Avis cost centre', 'Fee incl VAT'],
    [...lines].sort((a, b) => (a.transaction_date ?? '').localeCompare(b.transaction_date ?? '') || String(a.document_no).localeCompare(String(b.document_no))).map((l, i) => [String(i + 1), l.transaction_date ?? '', l.document_no ?? '', l.transaction_number ?? '', l.mva_number ?? '', l.reg ?? '', l.cost_centre_name ?? '', R(Number(l.amount_due))]),
    [500, 1250, 1900, 1400, 1000, 1300, 1700, 1050], { size: 14, right: [7] }),
  p(['Total', { t: `   ${total} fees   ${R(totalR)}`, bold: true }], { bold: true }),
].join('');

const tpl = 'C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/AutoSign/_config/letterhead_asi_connect.docx';
const z = await JSZip.loadAsync(fs.readFileSync(tpl));
let doc = await z.file('word/document.xml').async('string');
const sect = doc.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)[0];
doc = doc.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${body}${sect}</w:body>`);
z.file('word/document.xml', doc);
const out = 'C:/Users/User1/OneDrive - interconnect.co.za/Desktop/Claude/Fleet/Output/Avis fines query - statement 202607 - ASI Connect ICS.docx';
fs.writeFileSync(out, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`wrote ${out}\n${total} fees R ${totalR.toFixed(2)} on ${regs.length} regs; not on fleet ${notFleet.length}; own (non-Avis) ${notAvis.length}; dates ${dates[0]} → ${dates[dates.length - 1]}`);
