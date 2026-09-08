-- Month-end reconciliations: the app's figure vs the amount actually paid / processed, keyed in by the user.
alter table fleet_imports add column if not exists control_date date;   -- when the debit order / payment went through

create table if not exists fleet_recons (
  id          bigserial primary key,
  period      text not null,
  key         text not null,               -- payroll_deductions | payroll_reimbursement | payroll_provision | payroll_late | accrual_gl | ...
  expected    numeric(14,2),               -- snapshot of the app figure when checked
  actual      numeric(14,2),               -- amount per payroll / bank / GL
  actual_date date,
  note        text,
  checked_by  uuid references auth.users(id),
  checked_at  timestamptz not null default now(),
  unique (period, key)
);
alter table fleet_recons enable row level security;
create policy recons_all on fleet_recons for all using (fleet_is_admin()) with check (fleet_is_admin());
