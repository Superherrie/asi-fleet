# ASI Connect Fleet

Fleet-cost and travel-claim management for ASI Connect. Vite + React + TypeScript + Tailwind v4, Supabase (shared project, tables prefixed `fleet_`), GitHub Pages.

## What it does

| Area | Where | Notes |
|---|---|---|
| First Auto statement import | Imports → First Auto | Matches every card (driver name + reg on the statement). Staff cards → salary deductions; vehicle cards → cost per vehicle. New cards are created *unallocated* and flagged. |
| Salary deductions | Payroll → Deductions | Per month, per staff card holder, grand total incl VAT. Export to Excel (layout is a placeholder until payroll's template is supplied). |
| Journals | Journals | Per source and month: First Auto, Avis, Insurance, Tracking (per provider), Travel claims. Expense account from the GL map × category × branch; contra accounts from Settings. Warns on unallocated cards, unmapped accounts and unbalanced totals. |
| Travel logs | My Travel Logs | Drivers capture the month (or drop the Excel template), submit; manager gets an e-mail with a link; approve/return under Approvals. Approval creates the claim. |
| Claims | Payroll → Claims | Fuel portion = paid via payroll; maintenance portion = accrued per person. Rates per category under Admin → Claim rates. |
| Maintenance accrual | Payroll → Maintenance accrual | Opening balances via Imports → Accrual opening balances (Emp No / Name / Balance). Record payouts and adjustments; ledger per person. |
| Avis / Insurance / Tracking | Imports | Avis: expense = TOTAL (rental + non-claimable VAT), VAT input = VAT CLAIMABLE. Insurance: premium column "Average deduction", VAT backed out. Tracking: choose the provider; VAT added if the file has no VAT column. |
| Dashboard | Dashboard | Cost of ownership per vehicle / branch / month, cost per km, staff-card spend, claims. |
| Branch allocation | Fleet → Vehicles / Fleet cards / Card holders | Every card, vehicle and person carries a branch + category; these drive the journal. |

## Setup on a new machine

```bash
npm install
cp .env.example .env.local      # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5181
```

Scripts (need `scripts/.env` with SUPABASE_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD — git-ignored):

| Script | Purpose |
|---|---|
| `node scripts/apply-schema.mjs 001_init.sql` | apply a migration via the Management API |
| `node scripts/create-admin.mjs` | bootstrap / reset the admin login |
| `node scripts/seed.mjs "<YTD fleet.xls>" "<Fleet Card Names.xlsx>" --apply` | branches, vehicles, card holders, cards |
| `node scripts/backfill-ytd.mjs "<YTD fleet.xls>" --apply` | Avis / Cartrack / insurance history from the YTD workbook |
| `node scripts/import-aug-logs.mjs "<folder>" --apply` | one-off August 2026 travel logs (xls + text PDFs; scanned PDFs via `scripts/aug-overrides.json`) |
| `node scripts/deploy-functions.mjs fleet-notify fleet-admin-users` | deploy edge functions |

E-mail: set the `RESEND_API_KEY` secret on the Supabase project (Edge Functions → Secrets) and verify the sending domain at resend.com. Until then notifications queue under Admin → E-mail queue.

## Conventions

- Periods are `YYYY-MM` = the month the cost/travel relates to. Deductions and claims for month M are processed with month M+1's payroll.
- Category digit in GL accounts: 0 Admin, 1 Ops Cabling, 2 Ops Admin, 3 Sales, 4 Exec (215x00 fuel, 216x00 maintenance, 217x00 surveillance, 218x00 lease, 219x00 toll).
- Re-importing a source for the same month replaces the earlier import (and its journal drafts must be regenerated).
