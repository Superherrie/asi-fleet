"""Rebuilds First Auto's UsageVAT CSV (the file the Fleet app imports) from the printed AutoOnline statement pack
(the auto_rstm...pdf files WesBank sends when the CSV export is missing).

    py -3 scripts/fa-pack-to-usagevat.py "<folder with the 4 PDFs>" "<output .csv>"

Sources inside the pack, per fleet card:
  TRANSACTION REPORT              cost centre, driver, reg, make/model, seq, every voucher (date, supplier, VAT, category, amount,
                                  litres, odometer), previous-month odometer, fixed fees + interest, consumption medians
  COST CONSOLIDATED STATEMENT     per cost centre: one line per card with its total charge (expenses + fees excl VAT) = the control
  FEE BREAKDOWN REPORT            per cost centre: card admin (CRM), reports (FAR) and transaction (CTM) fees
Fuel is zero-rated; oil / toll / repairs etc. carry 15% VAT inside the voucher amount (the VAT shown on the voucher line).
Fees: card fee 49.38 + reports fee 9.34 per card, 5.94 per transaction, interest per card, anything left in the card's
FIXED figure is treated as invoice-scrutiny fee; VAT at 15% on fees excluding interest (as in First Auto's own CSV).
Every card is checked against the statement's control amount and any difference is reported.
"""
import csv, glob, json, os, re, sys
from collections import defaultdict
import pypdfium2 as pdfium

CARD_FEE, REPORTS_FEE, TXN_FEE, VAT = 49.38, 9.34, 5.94, 0.15
CATS = ['FUEL', 'OIL', 'MAINT', 'REPAIRS', 'TYRES', 'ACCIDENT', 'OTHER', 'OVERHAUL', 'EXCHANGE', 'TOLL', 'HOTEL']
HEADS = {'TRANSACTION REPORT', 'COST AND PERFORMANCE STATISTICS', 'ALLOWANCE OR MONTHLY COST PER UNIT REPORT', 'COST CONSOLIDATED STATEMENT',
         'FUEL USAGE REPORT', 'CONSOLIDATED VAT RECONCILIATION', 'FEE BREAKDOWN REPORT', 'REMITTANCE ADVICE', 'FEE VAT SUMMARY'}
r2 = lambda x: round(x + 1e-9, 2)
num = lambda s: float(str(s).replace(' ', '').replace(',', '.'))


def load_pages(folder):
    pages = []
    for f in sorted(glob.glob(os.path.join(folder, '*.pdf'))):
        d = pdfium.PdfDocument(f)
        for i in range(len(d)):
            t = d[i].get_textpage().get_text_range().replace('￾', ' ')
            pages.append({'file': os.path.basename(f), 'page': i + 1, 'head': t.split('\n')[0].strip(), 'text': t})
    return pages


def parse_cards(pages):
    """One record per TRANSACTION REPORT; pages that follow it without a known heading are continuations."""
    cards, cur = [], None
    for p in pages:
        if p['head'] == 'TRANSACTION REPORT':
            cur = {'text': p['text'], 'pages': [(p['file'], p['page'])]}; cards.append(cur)
        elif cur is not None and p['head'] not in HEADS and not p['head'].startswith('An Authorised') and not p['head'].startswith('First National'):
            cur['text'] += '\n' + p['text']; cur['pages'].append((p['file'], p['page']))
        else:
            cur = None if p['head'] in HEADS and p['head'] != 'TRANSACTION REPORT' else cur
    out = []
    for c in cards:
        t = c['text']; g = lambda rx, d=None: (re.search(rx, t) or [None, d])[1]
        rec = {
            'driver': (g(r'DRIVER: (.+?) EXPIRY DATE') or g(r'\nDRIVER: (.+?)\n') or '').strip(),
            'reg': g(r'REG NO: (\S+)'), 'seq': g(r'SEQ/CDV: (\d\d) (\d)'),
            'make_model': (g(r'MAKE&MODEL:(.+?) TYPE:') or '').strip(),
            'cc_name': (g(r'\n(\S.+?) 33857 MANUFACTURE:') or '').strip(),
            'cc_code': (g(r'\nCOS (\d{5}) METER') or ''),
            'odo_prev': g(r'LAST ODO READING, PREVIOUS MONTH\. (\d+)'),
            'fees_total': g(r'TOTAL FEES ([\d.]+)'), 'fixed': g(r'FIXED ([\d.]+)'), 'interest': g(r'INTEREST ([\d.]+)'),
            'sub_total': g(r'SUB TOTAL ([\d.]+)'), 'total_charge': g(r'TOTAL AMOUNT CHARGE ([\d.]+)'),
            'cons_median': g(r'Consumption median ([\d.]+)'), 'sys_median': g(r'System consumption median ([\d.]+)'),
            'latest_odo': g(r'Latest fuel (\d+)'), 'pages': c['pages'],
            'cat': defaultdict(float), 'cat_vat': defaultdict(float), 'litres': 0.0, 'txns': 0, 'odo_close': None, 'no_charge': 0.0, 'unparsed': [],
        }
        rec['cc_code'] = 'COS' + rec['cc_code'][-4:] if rec['cc_code'] else ''   # First Auto's own CSV writes COS0095, the report prints COS 00095
        for l in t.split('\n'):
            if not re.match(r'^\d{8} ', l) or 'LAST ODO READING' in l: continue
            # supplier names contain category words ("... TOLL PLAZA ... 13.17 TOLL 101.00"); the tail anchored to the line end makes the engine skip them
            m = re.search(r'(?:(\d+\.\d\d))?\s*(' + '|'.join(CATS) + r')\w*\s+(?:[A-Z]+ ){0,2}(\d+\.\d\d)(?:\s+(\d+\.\d\d))?(?:\s+(\d{3,}))?(?:\s+\d+)?(?:\s+\d+\.\d)?(?:\s+\d\d)*\s*$', l)
            if not m: rec['unparsed'].append(l); continue
            vat, cat, amt = float(m.group(1) or 0), m.group(2), float(m.group(3))
            rec['cat'][cat] += amt; rec['cat_vat'][cat] += vat; rec['txns'] += 1
            if cat == 'FUEL':
                rec['litres'] += float(m.group(4) or 0)
                if m.group(5): rec['odo_close'] = int(m.group(5))
            elif m.group(5) and len(m.group(5)) >= 5: rec['odo_close'] = int(m.group(5))
        out.append(rec)
    return out


def parse_controls(pages):
    """Per-card total charge from the cost-centre statements, keyed by (reg, seq)."""
    ctrl = {}
    for p in pages:
        if p['head'] != 'COST CONSOLIDATED STATEMENT' or 'REGISTRATION NO CARD NO DRIVER NAME AMOUNT' not in p['text']: continue
        seen = False
        for l in p['text'].split('\n'):
            if 'REGISTRATION NO CARD NO' in l: seen = True; continue
            if not seen: continue
            if l.startswith('TOTAL'): break
            m = re.match(r'^(\S+) (\S+) (\S+) (\d\d) (\d) (.+?) ([\d\s]+,\d\d)$', l.strip())
            if m: ctrl[(m.group(3), m.group(4))] = num(m.group(7))
    return ctrl


def build_rows(cards, ctrl, month_end):
    rows, problems = [], []
    for c in cards:
        fuel = r2(c['cat']['FUEL']); cat_ex = {}; cat_vat = {}
        for k in CATS[1:]:
            incl = c['cat'][k]; v = c['cat_vat'][k] if c['cat_vat'][k] else r2(incl - incl / (1 + VAT))
            cat_ex[k], cat_vat[k] = r2(incl - v), r2(v)
        exp_vat = r2(sum(cat_vat.values())); exp_excl = r2(fuel + sum(cat_ex.values()))
        # the card's FIXED figure = card fee + reports fee + transaction fees (the number of billable transactions can differ from the
        # vouchers printed, so the transaction fee is taken as the remainder); two cards carry no reports fee
        fixed = float(c['fixed'] or 0); interest = float(c['interest'] or 0)
        card_fee = CARD_FEE if fixed else 0.0
        rem = r2(fixed - card_fee); reports_fee = REPORTS_FEE if fixed and abs((rem - REPORTS_FEE) / TXN_FEE - round((rem - REPORTS_FEE) / TXN_FEE)) < 0.01 else 0.0
        txn_fee = r2(rem - reports_fee) if fixed else 0.0
        # the invoice-scrutiny fee (R67.32 a card this month) is not on the transaction report; the cost-centre card total shows whether it was charged
        control = ctrl.get((c['reg'], c['seq']))
        base_ctrl = r2(exp_excl + exp_vat + card_fee + reports_fee + txn_fee + interest)   # statement card amount excludes VAT on fees
        scrutiny = r2(control - base_ctrl) if control is not None and control - base_ctrl > 0.02 else 0.0
        fees_ex_vat = r2(card_fee + reports_fee + txn_fee + scrutiny); fees_vat = r2(fees_ex_vat * VAT)
        total_fees = r2(fees_ex_vat + interest + fees_vat); grand = r2(exp_excl + exp_vat + total_fees)
        expected_ctrl = r2(base_ctrl + scrutiny)
        if control is None: problems.append(f"{c['reg']} seq {c['seq']} ({c['driver']}): no control amount on the cost-centre statements")
        elif abs(control - expected_ctrl) > 0.02: problems.append(f"{c['reg']} seq {c['seq']} ({c['driver']}): rebuilt {expected_ctrl:.2f} vs statement {control:.2f} (diff {expected_ctrl - control:+.2f}) pages {c['pages']}")
        elif scrutiny and abs(scrutiny - 67.32) > 0.02: problems.append(f"{c['reg']} seq {c['seq']}: unexplained fee remainder {scrutiny:.2f} treated as scrutiny fee")
        if c['unparsed']: problems.append(f"{c['reg']}: unparsed voucher lines: {c['unparsed']}")
        mm = c['make_model'].split(' ', 1); make, model = mm[0], (mm[1] if len(mm) > 1 else '')
        rows.append(['33857', 'INTERCONNECT SYSTEMS (PTY) LTD', month_end, c['cc_name'], c['cc_code'], c['driver'], c['reg'], make, model, c['seq'],
                     fuel, cat_ex['OIL'], cat_vat['OIL'], cat_ex['REPAIRS'], cat_vat['REPAIRS'], cat_ex['TYRES'], cat_vat['TYRES'], cat_ex['ACCIDENT'], cat_vat['ACCIDENT'],
                     cat_ex['MAINT'], cat_vat['MAINT'], cat_ex['OVERHAUL'], cat_vat['OVERHAUL'], cat_ex['OTHER'], cat_vat['OTHER'], cat_ex['TOLL'], cat_vat['TOLL'],
                     exp_vat, exp_excl, card_fee, 0, interest, reports_fee, txn_fee, scrutiny, fees_vat, total_fees, 0, grand,
                     c['odo_close'] or c['latest_odo'] or '', r2(c['litres']), c['odo_prev'] or '', c['cons_median'] or '', c['sys_median'] or '', 30, 30,
                     '', '', '', '', 'COM0001', 'INTERCONNECT SYSTEMS (PTY) LTD', cat_ex['EXCHANGE']])
    return rows, problems


HEADER = ['Clnt code', 'Client Legal Name', 'Monthend Date', 'Name', 'Code', 'Driver Name', 'Reg Num', 'Make', 'Model', 'Seq Num', 'Fuel Mth Sum', 'Oil Excl Vat', 'Oil Vat', 'Repiars Excl Vat', 'Repairs Vat', 'Tyres Excl Vat', 'Tyres Vat', 'Accident Excl Vat', 'Accident Vat', 'Maint Serv Excl Vat', 'Maint Serv Vat', 'Overhaul Excl Vat', 'Overhaul Vat', 'Other Excl Vat', 'Other Vat', 'Toll Excl Vat', 'Toll Vat', 'Total Expenses Vat', 'Total Expenses Excl Vat', 'Fixed Fee', 'Fee Lost Card Sum', 'Fee Interest Sum', 'Fee Magnetic Media Sum', 'Transaction Fee', 'Fee Inv Scrutiny Sum', 'Vat Fees Levied', 'Total Fees', 'Lost Card Journal', 'Grand Total', 'Odo Close This Mth', 'Litre Total Sum', 'Odo Prev Mth Sum', 'Consump Med Mth Sum', 'Consump Sys Med Mth Sum', 'Fuel Consump Over', 'Fuel Consump Under', 'Owning Cost Code', 'Owning Cost Name', 'Second Own Cost Code', 'Second Own Cost Name', 'Third Own Cost Code', 'Third Own Cost Name', 'Exchg Mth Sum']


def main(folder, out):
    pages = load_pages(folder)
    me = re.search(r'MONTH-END: (\d\d)/(\d\d)/(\d{4})', pages[0]['text']); month_end = f'{me.group(3)}-{me.group(2)}-{me.group(1)}'
    cards = parse_cards(pages); ctrl = parse_controls(pages)
    rows, problems = build_rows(cards, ctrl, month_end)
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(HEADER); w.writerows(rows)
    tot = lambda i: r2(sum(float(r[i]) for r in rows))
    print(f'{len(rows)} cards -> {out} (month end {month_end})')
    print(f"fuel {tot(10):,.2f} | expenses excl {tot(28):,.2f} VAT {tot(27):,.2f} | fees {tot(36):,.2f} | grand total {tot(38):,.2f} | statement cards {r2(sum(ctrl.values())):,.2f} ({len(ctrl)} cards)")
    print(f'rebuilt vs statement card totals: {r2(sum(float(r[28]) + float(r[27]) + float(r[29]) + float(r[31]) + float(r[32]) + float(r[33]) + float(r[34]) for r in rows)):,.2f} vs {r2(sum(ctrl.values())):,.2f}')
    print('PROBLEMS:' if problems else 'all cards tie to the statement'); print('\n'.join(problems))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
