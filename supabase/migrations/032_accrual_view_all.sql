-- Read-only "view all" logins (fleet_profiles.view_all) may read the maintenance-accrual ledger,
-- so the Maintenance accruals page can show each person's balance and movements to them.
-- Writes stay admin-only (accrual_write policy from 001_init.sql).
drop policy if exists view_all_select on fleet_accrual_txns;
create policy view_all_select on fleet_accrual_txns for select using (fleet_can_view_all());
