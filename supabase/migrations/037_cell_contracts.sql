-- 037: Vodacom cellphone contracts (the "Vodacom Master Data" workbook), one row per MSISDN, linked to the person who holds the
--      number so the IT equipment register shows the contract next to the devices, and carrying the branch + category that the
--      monthly Vodacom journal will post each number's charge to.

alter table fleet_staff add column if not exists category text check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec'));

create table if not exists fleet_cell_contracts (
  id               bigserial primary key,
  msisdn           text not null unique,            -- Vodacom MSISDN as billed, e.g. 832939580000
  cell_no          text,                            -- 0832939580
  holder_id        bigint references fleet_staff(id),
  subscriber_name  text,                            -- name on the Vodacom account / master
  invoice_name     text,
  branch_id        bigint references fleet_branches(id),
  branch_code      text,
  category         text check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),   -- GL category for the journal
  job_title        text,
  device_category  text,                            -- standard device for the role (Redmi 15, iPhone / Samsung)
  package_range    text,
  contract_type    text,                            -- package / plan
  device           text,
  previous_device  text,
  sim_number       text,
  activation_date  date,
  term_date        date,
  upgrade_due      date,
  last_upgrade     date,
  avg_spend        numeric(12,2),
  status           text not null default 'active' check (status in ('active','unclaimed','to_cancel','cancelled','unassigned')),
  it_device_form   boolean,
  asset_id         bigint references fleet_it_assets(id) on delete set null,   -- the handset on the IT register, where known
  note             text,
  source           text not null default 'master',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists fleet_cell_contracts_holder on fleet_cell_contracts(holder_id);

alter table fleet_cell_contracts enable row level security;
drop policy if exists cc_select on fleet_cell_contracts;
create policy cc_select on fleet_cell_contracts for select using (fleet_it_admin() or holder_id = fleet_my_staff());
drop policy if exists cc_write on fleet_cell_contracts;
create policy cc_write on fleet_cell_contracts for all using (fleet_it_admin()) with check (fleet_it_admin());
grant select, insert, update, delete on fleet_cell_contracts to authenticated; grant usage, select on sequence fleet_cell_contracts_id_seq to authenticated;

-- the monthly Vodacom journal will map each billed MSISDN through this table; its GL accounts live in fleet_gl_map under source 'cellphone'
alter table fleet_gl_map drop constraint if exists fleet_gl_map_source_check;
alter table fleet_gl_map add constraint fleet_gl_map_source_check check (source in ('first_auto','avis','insurance','tracking','claims','copiers','cellphone'));
