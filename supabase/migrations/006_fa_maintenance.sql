-- First Auto managed-maintenance charge-back invoices (consolidated "CI" workbooks, one per division per month).
-- Staff private-vehicle work is utilised against the person's maintenance accrual; company vehicles are expensed.
alter table fleet_imports drop constraint if exists fleet_imports_source_check;
alter table fleet_imports add constraint fleet_imports_source_check check (source in ('first_auto','avis','insurance','tracking','travel_log','accrual_opening','fa_maintenance'));
alter table fleet_journals drop constraint if exists fleet_journals_source_check;
alter table fleet_journals add constraint fleet_journals_source_check check (source in ('first_auto','avis','insurance','tracking','claims','deductions','fa_maintenance'));

create table if not exists fleet_maint_lines (
  id               bigserial primary key,
  import_id        bigint not null references fleet_imports(id) on delete cascade,
  period           text not null,
  invoice_no       text not null,          -- CI00065191
  line_id          text not null unique,   -- OutgoingInvoiceLineID
  order_id         text,
  cost_centre      text,                   -- "2153-SEC-SECUNDA SALES"
  billing_type     text not null,          -- Charge On | Contract Billing | MM Interest | ...
  excl             numeric(14,2) not null default 0,
  vat              numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  order_date       date,
  completion_date  date,
  invoice_date     date,
  supplier         text,
  reg              text,
  driver           text,
  vehicle_desc     text,
  item_desc        text,
  cost_category    text,
  description      text,
  vehicle_id       bigint references fleet_vehicles(id),
  employee_id      bigint references fleet_employees(id),
  card_id          bigint references fleet_cards(id),
  branch_id        bigint references fleet_branches(id),
  category         text check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  accrual_txn_id   bigint references fleet_accrual_txns(id) on delete set null
);
create index if not exists fleet_maint_lines_period on fleet_maint_lines(period);
alter table fleet_maint_lines enable row level security;
create policy maint_select on fleet_maint_lines for select using (fleet_is_admin() or employee_id = fleet_my_employee());
create policy maint_write on fleet_maint_lines for all using (fleet_is_admin()) with check (fleet_is_admin());

-- accrual txns link back to the maintenance line
alter table fleet_accrual_txns add column if not exists maint_line_id bigint;

insert into fleet_gl_map (source, cost_type, category, gl_account, gl_name)
select 'first_auto', 'maint_fees', c, '216' || d || '00', 'M/V Exp - Maintenance - ' || c
from unnest(array['Admin','Ops Cabling','Ops Admin','Sales','Exec']) with ordinality as t(c, i), lateral (select (i-1)::text d) x
on conflict do nothing;
