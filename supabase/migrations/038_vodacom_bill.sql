-- 038: the monthly Vodacom bill and its journal. Finance's "Master billing VODACOM" sheet is replaced by the contracts in the
--      app (fleet_cell_contracts, kept by the IT equipment administrators) plus this import of Vodacom's monthly billing file.
alter table fleet_cell_contracts add column if not exists line_type text not null default 'voice' check (line_type in ('voice','data'));   -- data SIMs (tablets, printers, office data) post to 404600

alter table fleet_imports drop constraint if exists fleet_imports_source_check;
alter table fleet_imports add constraint fleet_imports_source_check check (source in ('first_auto','avis','insurance','tracking','travel_log','accrual_opening','fa_maintenance','vodacom'));
alter table fleet_journals drop constraint if exists fleet_journals_source_check;
alter table fleet_journals add constraint fleet_journals_source_check check (source in ('first_auto','avis','insurance','tracking','claims','deductions','fa_maintenance','accrual_provision','accrual_utilisation','cellphone'));

create table if not exists fleet_cell_bill_lines (
  id            bigserial primary key,
  import_id     bigint not null references fleet_imports(id) on delete cascade,
  period        text not null,
  msisdn        text not null,                 -- 9 digits as on the bill, e.g. 832939580
  cell_no       text,
  contract_id   bigint references fleet_cell_contracts(id) on delete set null,
  user_name     text,
  tariff        text,
  invoice       text,
  status        text,
  term_date     date,
  subscription  numeric(14,2) not null default 0,   -- subscription less discount
  calls         numeric(14,2) not null default 0,   -- calls, data, messaging, bundles, provisioning, entertainment
  other         numeric(14,2) not null default 0,   -- CLIP, insurance, equipment, fees
  amount_excl   numeric(14,2) not null default 0,   -- Vodacom "Total"
  vat           numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0    -- "Grand Total"
);
create index if not exists fleet_cell_bill_lines_period on fleet_cell_bill_lines(period);
alter table fleet_cell_bill_lines enable row level security;
drop policy if exists cbl_all on fleet_cell_bill_lines; create policy cbl_all on fleet_cell_bill_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
drop policy if exists cbl_select on fleet_cell_bill_lines; create policy cbl_select on fleet_cell_bill_lines for select using (fleet_it_admin() or fleet_can_view_all());
grant select, insert, update, delete on fleet_cell_bill_lines to authenticated; grant usage, select on sequence fleet_cell_bill_lines_id_seq to authenticated;

-- GL accounts as finance posts them: airtime by category, data SIMs to 404600
insert into fleet_gl_map (source, cost_type, category, gl_account, gl_name) values
  ('cellphone', 'airtime', 'Admin',       '210000', 'Cellphone - Admin'),
  ('cellphone', 'airtime', 'Ops Cabling', '210100', 'Cellphone - Ops Cabling'),
  ('cellphone', 'airtime', 'Ops Admin',   '210200', 'Cellphone - Ops Admin'),
  ('cellphone', 'airtime', 'Sales',       '210300', 'Cellphone - Sales'),
  ('cellphone', 'airtime', 'Exec',        '210400', 'Cellphone - Exec'),
  ('cellphone', 'data',    null,          '404600', 'Data SIMs')
on conflict (source, cost_type, category) do nothing;
insert into fleet_settings (key, value, description) values ('vodacom_creditor_account', '906000', 'GL account credited for the Vodacom invoice (accrual)') on conflict (key) do nothing;
insert into fleet_settings (key, value, description) values ('vat_input_account', '904000', 'GL account for VAT input on statements') on conflict (key) do update set value = case when fleet_settings.value = '' then excluded.value else fleet_settings.value end;
