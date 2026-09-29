-- 025: Copier invoices — monthly rental and service (click-charge) invoices per machine, from the CBS tax invoices.
create table if not exists fleet_copier_invoices (
  id              bigserial primary key,
  copier_id       bigint references fleet_copiers(id) on delete set null,
  serial_no       text not null,
  supplier_entity text not null,
  account_no      text,
  customer_name   text,                 -- name the supplier invoices (should be the company's legal name)
  invoice_no      text not null unique,
  invoice_date    date,
  period          text,                 -- YYYY-MM of the invoice date
  kind            text not null check (kind in ('rental','service')),
  contract_no     text,
  model           text,
  site            text,                 -- location / shipping address as printed on the invoice
  rental_excl     numeric(12,2) not null default 0,
  rental_for      text,
  admin_fee       numeric(12,2) not null default 0,
  mono_open int, mono_close int, mono_qty int, mono_rate numeric(10,4), mono_charge numeric(12,2), mono_read date,
  colour_open int, colour_close int, colour_qty int, colour_rate numeric(10,4), colour_charge numeric(12,2),
  scan_qty int, scan_rate numeric(10,4), scan_charge numeric(12,2),
  subtotal        numeric(12,2) not null default 0,
  vat             numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  source_file     text,
  created_at      timestamptz not null default now()
);
create index if not exists fleet_copier_invoices_copier on fleet_copier_invoices(copier_id, period);
alter table fleet_copier_invoices enable row level security;
drop policy if exists ci_select on fleet_copier_invoices;
create policy ci_select on fleet_copier_invoices for select using (
  fleet_can_view_all() or copier_id in (select id from fleet_copiers where branch_id in (select * from fleet_my_branches())));
drop policy if exists ci_write on fleet_copier_invoices;
create policy ci_write on fleet_copier_invoices for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_copier_invoices to authenticated;
grant usage, select on sequence fleet_copier_invoices_id_seq to authenticated;
alter table fleet_copiers add column if not exists contract_no text;
alter table fleet_copiers add column if not exists service_contract_no text;
