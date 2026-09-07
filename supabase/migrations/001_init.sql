-- ASI Connect Fleet — initial schema. All objects prefixed fleet_ (shared Supabase project).
-- Apply with: node scripts/apply-schema.mjs 001_init.sql

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------
create table if not exists fleet_branches (
  id          bigserial primary key,
  code        text not null unique,          -- GAU, SEC, 000, ZZZ ...
  name        text not null,
  aliases     text[] not null default '{}',  -- names used by First Auto / Avis / insurers / trackers
  active      boolean not null default true
);

create table if not exists fleet_employees (
  id                   bigserial primary key,
  emp_no               text unique,          -- payroll number, e.g. 4373 (also on First Auto driver name)
  full_name            text not null,
  email                text,
  branch_id            bigint references fleet_branches(id),
  category             text not null default 'Sales'
                         check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  manager_employee_id  bigint references fleet_employees(id),
  manager_email        text,
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now()
);

create table if not exists fleet_profiles (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  full_name             text not null default '',
  is_admin              boolean not null default false,
  role                  text not null default 'driver' check (role in ('admin','finance','payroll','manager','driver')),
  employee_id           bigint references fleet_employees(id),
  must_change_password  boolean not null default false,
  created_at            timestamptz not null default now()
);

create table if not exists fleet_vehicles (
  id                bigserial primary key,
  registration      text not null unique,   -- normalised: upper-case, no spaces
  year              int,
  make              text,
  model             text,
  branch_id         bigint references fleet_branches(id),
  category          text not null default 'Ops Cabling'
                      check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  ownership         text not null default 'owned' check (ownership in ('owned','avis','other')),
  avis_mva          text,
  license_expiry    date,
  lease_end         date,
  tracking_provider text,
  insured_value     numeric(14,2),
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now()
);

-- A First Auto card. Vehicle cards ride on a fleet vehicle; staff cards belong to a person
-- (the reg on the statement is then their private vehicle).
create table if not exists fleet_cards (
  id              bigserial primary key,
  fa_driver_name  text not null,             -- exactly as on the statement: "GAU-POOL" / "4373-DON RAMPERSADH"
  fa_reg          text not null,             -- normalised reg as on the statement
  holder_type     text not null default 'unallocated'
                    check (holder_type in ('vehicle','staff','unallocated')),
  vehicle_id      bigint references fleet_vehicles(id),
  employee_id     bigint references fleet_employees(id),
  branch_id       bigint references fleet_branches(id),
  category        text check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (fa_driver_name, fa_reg)
);

-- GL account per source × cost type (× category). category null = applies to every category.
create table if not exists fleet_gl_map (
  id          bigserial primary key,
  source      text not null check (source in ('first_auto','avis','insurance','tracking','claims')),
  cost_type   text not null,
  category    text check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  gl_account  text not null,
  gl_name     text not null default '',
  unique (source, cost_type, category)
);

create table if not exists fleet_settings (
  key         text primary key,
  value       text not null default '',
  description text not null default ''
);

-- Reimbursement rate per category. Fuel portion is paid monthly; maintenance portion accrues.
create table if not exists fleet_claim_rates (
  id              bigserial primary key,
  category        text not null check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  effective_from  date not null,
  fuel_rate       numeric(10,4) not null default 0,   -- R per business km
  maint_rate      numeric(10,4) not null default 0,   -- R per business km
  unique (category, effective_from)
);

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------
create table if not exists fleet_imports (
  id            bigserial primary key,
  source        text not null check (source in ('first_auto','avis','insurance','tracking','travel_log','accrual_opening')),
  period        text not null,               -- 'YYYY-MM'
  provider      text,                        -- tracking company name
  file_name     text,
  row_count     int not null default 0,
  total_amount  numeric(14,2) not null default 0,
  imported_by   uuid references auth.users(id),
  imported_at   timestamptz not null default now(),
  notes         text
);

create table if not exists fleet_fa_lines (
  id                bigserial primary key,
  import_id         bigint not null references fleet_imports(id) on delete cascade,
  period            text not null,
  card_id           bigint references fleet_cards(id),
  fa_name_code      text,                    -- "2151-GAU-GAUTENG OPS CABLING"
  fa_code           text,                    -- COS0089
  fa_driver_name    text,
  fa_reg            text,
  make              text,
  model             text,
  fuel              numeric(14,2) not null default 0,  -- zero-rated
  oil_excl          numeric(14,2) not null default 0, oil_vat       numeric(14,2) not null default 0,
  repairs_excl      numeric(14,2) not null default 0, repairs_vat   numeric(14,2) not null default 0,
  tyres_excl        numeric(14,2) not null default 0, tyres_vat     numeric(14,2) not null default 0,
  accident_excl     numeric(14,2) not null default 0, accident_vat  numeric(14,2) not null default 0,
  maint_excl        numeric(14,2) not null default 0, maint_vat     numeric(14,2) not null default 0,
  overhaul_excl     numeric(14,2) not null default 0, overhaul_vat  numeric(14,2) not null default 0,
  other_excl        numeric(14,2) not null default 0, other_vat     numeric(14,2) not null default 0,
  toll_excl         numeric(14,2) not null default 0, toll_vat      numeric(14,2) not null default 0,
  expenses_excl     numeric(14,2) not null default 0,
  expenses_vat      numeric(14,2) not null default 0,
  fees_excl         numeric(14,2) not null default 0,
  fees_vat          numeric(14,2) not null default 0,
  grand_total       numeric(14,2) not null default 0,
  odo_close         numeric(12,0),
  odo_prev          numeric(12,0),
  kms               numeric(12,0),
  litres            numeric(12,2),
  consumption       numeric(10,2)
);
create index if not exists fleet_fa_lines_period on fleet_fa_lines(period);
create index if not exists fleet_fa_lines_card on fleet_fa_lines(card_id);

create table if not exists fleet_avis_lines (
  id                 bigserial primary key,
  import_id          bigint not null references fleet_imports(id) on delete cascade,
  period             text not null,
  vehicle_id         bigint references fleet_vehicles(id),
  branch_id          bigint references fleet_branches(id),
  driver_name        text,
  reg                text,
  mva_number         text,
  kilometers         numeric(12,0),
  rental_excl        numeric(14,2) not null default 0,
  vat                numeric(14,2) not null default 0,
  amount_due         numeric(14,2) not null default 0,
  vat_claimable      numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,
  cost_centre_name   text,
  vehicle_type       text,
  product            text,
  transaction_type   text,
  make_model         text,
  transaction_date   date,
  document_no        text,
  transaction_number text
);
create index if not exists fleet_avis_lines_period on fleet_avis_lines(period);

create table if not exists fleet_insurance_lines (
  id             bigserial primary key,
  import_id      bigint not null references fleet_imports(id) on delete cascade,
  period         text not null,
  vehicle_id     bigint references fleet_vehicles(id),
  branch_id      bigint references fleet_branches(id),
  reg            text,
  year           int,
  make           text,
  model          text,
  branch_name    text,
  tracking_unit  text,
  retail_value   numeric(14,2),
  premium        numeric(14,2) not null default 0,   -- monthly premium (excl)
  vat            numeric(14,2) not null default 0,
  rate           numeric(10,4)
);
create index if not exists fleet_insurance_lines_period on fleet_insurance_lines(period);

create table if not exists fleet_tracking_lines (
  id            bigserial primary key,
  import_id     bigint not null references fleet_imports(id) on delete cascade,
  period        text not null,
  provider      text not null,
  vehicle_id    bigint references fleet_vehicles(id),
  branch_id     bigint references fleet_branches(id),
  invoice       text,
  invoice_date  date,
  item_code     text,
  reg           text,
  description   text,
  quantity      numeric(10,2),
  amount_excl   numeric(14,2) not null default 0,
  vat           numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  branch_name   text,
  contract_id   text
);
create index if not exists fleet_tracking_lines_period on fleet_tracking_lines(period);

-- ---------------------------------------------------------------------------
-- Travel logs, claims, accrual
-- ---------------------------------------------------------------------------
create table if not exists fleet_travel_logs (
  id              bigserial primary key,
  period          text not null,
  employee_id     bigint not null references fleet_employees(id),
  vehicle_reg     text,
  branch_id       bigint references fleet_branches(id),
  department      text,
  opening_odo     numeric(12,0),
  opening_date    date,
  closing_odo     numeric(12,0),
  closing_date    date,
  business_km     numeric(12,1) not null default 0,
  private_km      numeric(12,1) not null default 0,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected','processed')),
  submitted_at    timestamptz,
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  manager_email   text,
  manager_comment text,
  source          text not null default 'app' check (source in ('app','import')),
  source_file     text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (period, employee_id)
);

create table if not exists fleet_travel_log_lines (
  id           bigserial primary key,
  log_id       bigint not null references fleet_travel_logs(id) on delete cascade,
  line_no      int not null,
  trip_date    date,
  opening_km   numeric(12,0),
  closing_km   numeric(12,0),
  private_km   numeric(12,1) not null default 0,
  business_km  numeric(12,1) not null default 0,
  destination  text,
  reason       text,
  unique (log_id, line_no)
);

create table if not exists fleet_batches (
  id           bigserial primary key,
  period       text not null,
  kind         text not null check (kind in ('claims','deductions')),
  total        numeric(14,2) not null default 0,
  line_count   int not null default 0,
  file_name    text,
  exported_by  uuid references auth.users(id),
  exported_at  timestamptz not null default now()
);

create table if not exists fleet_claims (
  id            bigserial primary key,
  period        text not null,
  employee_id   bigint not null references fleet_employees(id),
  log_id        bigint unique references fleet_travel_logs(id) on delete set null,
  category      text not null,
  business_km   numeric(12,1) not null default 0,
  fuel_rate     numeric(10,4) not null default 0,
  maint_rate    numeric(10,4) not null default 0,
  fuel_amount   numeric(14,2) not null default 0,
  maint_amount  numeric(14,2) not null default 0,
  total_amount  numeric(14,2) not null default 0,
  status        text not null default 'pending' check (status in ('pending','exported','paid')),
  batch_id      bigint references fleet_batches(id),
  created_at    timestamptz not null default now()
);

create table if not exists fleet_accrual_txns (
  id           bigserial primary key,
  employee_id  bigint not null references fleet_employees(id),
  txn_date     date not null default current_date,
  period       text,
  kind         text not null check (kind in ('opening','accrual','payout','adjustment')),
  amount       numeric(14,2) not null,       -- + increases the accrual, - reduces it
  description  text,
  reference    text,
  claim_id     bigint references fleet_claims(id) on delete set null,
  import_id    bigint references fleet_imports(id) on delete cascade,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Salary deductions are derived from staff-card statement lines
create table if not exists fleet_deductions (
  id           bigserial primary key,
  period       text not null,
  employee_id  bigint not null references fleet_employees(id),
  card_id      bigint references fleet_cards(id),
  fa_line_id   bigint references fleet_fa_lines(id) on delete cascade,
  amount       numeric(14,2) not null default 0,
  status       text not null default 'pending' check (status in ('pending','exported','deducted')),
  batch_id     bigint references fleet_batches(id),
  created_at   timestamptz not null default now(),
  unique (period, employee_id, card_id)
);

-- ---------------------------------------------------------------------------
-- Journals
-- ---------------------------------------------------------------------------
create table if not exists fleet_journals (
  id          bigserial primary key,
  source      text not null check (source in ('first_auto','avis','insurance','tracking','claims','deductions')),
  period      text not null,
  provider    text,
  import_id   bigint references fleet_imports(id) on delete cascade,
  status      text not null default 'draft' check (status in ('draft','exported','posted')),
  total_debit numeric(14,2) not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists fleet_journal_lines (
  id           bigserial primary key,
  journal_id   bigint not null references fleet_journals(id) on delete cascade,
  line_no      int not null,
  gl_account   text not null,
  gl_name      text not null default '',
  branch_code  text not null default '',
  category     text,
  description  text not null default '',
  reference    text,
  debit        numeric(14,2) not null default 0,
  credit       numeric(14,2) not null default 0,
  vehicle_id   bigint references fleet_vehicles(id),
  employee_id  bigint references fleet_employees(id),
  card_id      bigint references fleet_cards(id)
);

-- ---------------------------------------------------------------------------
-- Notifications (approval e-mails; sent by the fleet-notify edge function)
-- ---------------------------------------------------------------------------
create table if not exists fleet_notifications (
  id          bigserial primary key,
  kind        text not null check (kind in ('log_submitted','log_approved','log_rejected')),
  to_email    text not null,
  cc_email    text,
  subject     text not null,
  body        text not null,
  log_id      bigint references fleet_travel_logs(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- Helpers (security definer to avoid recursive RLS)
-- ---------------------------------------------------------------------------
create or replace function fleet_is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin or role in ('admin','finance','payroll') from fleet_profiles where user_id = auth.uid()), false) $$;

create or replace function fleet_my_employee()
returns bigint language sql stable security definer set search_path = public as
$$ select employee_id from fleet_profiles where user_id = auth.uid() $$;

create or replace function fleet_my_email()
returns text language sql stable security definer set search_path = public as
$$ select lower(email) from fleet_profiles where user_id = auth.uid() $$;

-- can the caller act as manager for this employee?
create or replace function fleet_manages(emp bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select fleet_is_admin() or exists (
    select 1 from fleet_employees e
    where e.id = emp
      and (e.manager_employee_id = fleet_my_employee()
           or lower(coalesce(e.manager_email,'')) = fleet_my_email())
  )
$$;

create or replace function fleet_log_visible(log bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from fleet_travel_logs l
    where l.id = log
      and (fleet_is_admin() or l.employee_id = fleet_my_employee() or fleet_manages(l.employee_id)
           or lower(coalesce(l.manager_email,'')) = fleet_my_email())
  )
$$;

create or replace function fleet_log_editable(log bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from fleet_travel_logs l
    where l.id = log
      and (fleet_is_admin() or (l.employee_id = fleet_my_employee() and l.status in ('draft','rejected')))
  )
$$;

create or replace function fleet_password_changed()
returns void language sql security definer set search_path = public as
$$ update fleet_profiles set must_change_password = false where user_id = auth.uid() $$;

-- rate in force for a period (first day of the month)
create or replace function fleet_rate_for(p_category text, p_period text)
returns fleet_claim_rates language sql stable security definer set search_path = public as
$$
  select r.* from fleet_claim_rates r
  where r.category = p_category and r.effective_from <= (p_period || '-01')::date
  order by r.effective_from desc limit 1
$$;

-- Driver submits a log: recompute totals, mark submitted, queue the manager e-mail.
create or replace function fleet_submit_log(p_log bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees; mgr text; b numeric; p numeric; app_url text;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if not (fleet_is_admin() or l.employee_id = fleet_my_employee()) then raise exception 'Not your log'; end if;
  if l.status not in ('draft','rejected') then raise exception 'Log already submitted'; end if;
  select coalesce(sum(business_km),0), coalesce(sum(private_km),0) into b, p from fleet_travel_log_lines where log_id = p_log;
  select * into e from fleet_employees where id = l.employee_id;
  mgr := coalesce(nullif(l.manager_email,''), e.manager_email,
                  (select email from fleet_employees where id = e.manager_employee_id));
  update fleet_travel_logs
     set business_km = b, private_km = p, status = 'submitted', submitted_at = now(),
         manager_email = mgr, manager_comment = null, updated_at = now()
   where id = p_log;
  select value into app_url from fleet_settings where key = 'app_url';
  if mgr is not null and mgr <> '' then
    insert into fleet_notifications (kind, to_email, cc_email, subject, body, log_id)
    values ('log_submitted', mgr, e.email,
      format('Travel log for approval: %s — %s', e.full_name, l.period),
      format(E'%s has submitted a travel log for %s.\n\nBusiness km: %s\nPrivate km: %s\nVehicle: %s\n\nPlease review and approve it in the ASI Fleet app:\n%s#/approvals/%s',
             e.full_name, l.period, b, p, coalesce(l.vehicle_reg,''), coalesce(app_url,''), p_log),
      p_log);
  end if;
end $$;

-- Manager / admin decides. Approval creates the claim (fuel paid monthly, maintenance accrued).
create or replace function fleet_decide_log(p_log bigint, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees; r fleet_claim_rates; fuel numeric; maint numeric; cl_id bigint; app_url text;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if not (fleet_manages(l.employee_id) or lower(coalesce(l.manager_email,'')) = fleet_my_email()) then
    raise exception 'You are not the approver for this log';
  end if;
  if l.status <> 'submitted' then raise exception 'Log is not awaiting approval'; end if;
  select * into e from fleet_employees where id = l.employee_id;
  select value into app_url from fleet_settings where key = 'app_url';

  if p_approve then
    update fleet_travel_logs set status = 'approved', approved_by = auth.uid(), approved_at = now(),
           manager_comment = p_comment, updated_at = now() where id = p_log;
    r := fleet_rate_for(e.category, l.period);
    fuel  := round(coalesce(r.fuel_rate,0)  * l.business_km, 2);
    maint := round(coalesce(r.maint_rate,0) * l.business_km, 2);
    insert into fleet_claims (period, employee_id, log_id, category, business_km, fuel_rate, maint_rate, fuel_amount, maint_amount, total_amount)
    values (l.period, l.employee_id, p_log, e.category, l.business_km, coalesce(r.fuel_rate,0), coalesce(r.maint_rate,0), fuel, maint, fuel + maint)
    on conflict (log_id) do update set business_km = excluded.business_km, fuel_rate = excluded.fuel_rate,
      maint_rate = excluded.maint_rate, fuel_amount = excluded.fuel_amount, maint_amount = excluded.maint_amount,
      total_amount = excluded.total_amount
    returning id into cl_id;
    delete from fleet_accrual_txns where claim_id = cl_id and kind = 'accrual';
    if maint <> 0 then
      insert into fleet_accrual_txns (employee_id, txn_date, period, kind, amount, description, claim_id, created_by)
      values (l.employee_id, (l.period || '-01')::date, l.period, 'accrual', maint,
              format('Maintenance accrual %s (%s km @ %s)', l.period, l.business_km, r.maint_rate), cl_id, auth.uid());
    end if;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_approved', e.email, format('Travel log approved — %s', l.period),
        format(E'Your travel log for %s has been approved.\n\nBusiness km: %s\nFuel reimbursement: R %s\nMaintenance accrued: R %s\n%s',
               l.period, l.business_km, fuel, maint, coalesce(p_comment,'')), p_log);
    end if;
  else
    update fleet_travel_logs set status = 'rejected', approved_by = auth.uid(), approved_at = now(),
           manager_comment = p_comment, updated_at = now() where id = p_log;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_rejected', e.email, format('Travel log returned — %s', l.period),
        format(E'Your travel log for %s was returned by your manager.\n\nComment: %s\n\nPlease correct and resubmit it in the ASI Fleet app:\n%s#/my-logs',
               l.period, coalesce(p_comment,'(none)'), coalesce(app_url,'')), p_log);
    end if;
  end if;
end $$;

-- Admin re-opens an approved/processed log (claim + accrual are removed if not yet exported)
create or replace function fleet_reopen_log(p_log bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare cl fleet_claims;
begin
  if not fleet_is_admin() then raise exception 'Admin only'; end if;
  select * into cl from fleet_claims where log_id = p_log;
  if cl.id is not null and cl.status <> 'pending' then raise exception 'Claim already exported — cannot reopen'; end if;
  delete from fleet_accrual_txns where claim_id = cl.id;
  delete from fleet_claims where log_id = p_log;
  update fleet_travel_logs set status = 'draft', approved_by = null, approved_at = null, updated_at = now() where id = p_log;
end $$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
create or replace view fleet_v_accrual_balances as
  select e.id as employee_id, e.emp_no, e.full_name, e.branch_id, e.category,
         coalesce(sum(t.amount),0) as balance,
         coalesce(sum(t.amount) filter (where t.kind = 'accrual'),0) as accrued,
         coalesce(-sum(t.amount) filter (where t.kind = 'payout'),0) as paid_out,
         max(t.txn_date) as last_txn
  from fleet_employees e
  left join fleet_accrual_txns t on t.employee_id = e.id
  group by e.id;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table fleet_branches enable row level security;
alter table fleet_employees enable row level security;
alter table fleet_profiles enable row level security;
alter table fleet_vehicles enable row level security;
alter table fleet_cards enable row level security;
alter table fleet_gl_map enable row level security;
alter table fleet_settings enable row level security;
alter table fleet_claim_rates enable row level security;
alter table fleet_imports enable row level security;
alter table fleet_fa_lines enable row level security;
alter table fleet_avis_lines enable row level security;
alter table fleet_insurance_lines enable row level security;
alter table fleet_tracking_lines enable row level security;
alter table fleet_travel_logs enable row level security;
alter table fleet_travel_log_lines enable row level security;
alter table fleet_batches enable row level security;
alter table fleet_claims enable row level security;
alter table fleet_accrual_txns enable row level security;
alter table fleet_deductions enable row level security;
alter table fleet_journals enable row level security;
alter table fleet_journal_lines enable row level security;
alter table fleet_notifications enable row level security;

-- reference data: everyone signed in reads, admin writes
create policy branches_select on fleet_branches for select using (auth.uid() is not null);
create policy branches_write on fleet_branches for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy employees_select on fleet_employees for select using (auth.uid() is not null);
create policy employees_write on fleet_employees for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy vehicles_select on fleet_vehicles for select using (auth.uid() is not null);
create policy vehicles_write on fleet_vehicles for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy rates_select on fleet_claim_rates for select using (auth.uid() is not null);
create policy rates_write on fleet_claim_rates for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy settings_select on fleet_settings for select using (auth.uid() is not null);
create policy settings_write on fleet_settings for all using (fleet_is_admin()) with check (fleet_is_admin());

create policy profiles_select on fleet_profiles for select using (user_id = auth.uid() or fleet_is_admin());
create policy profiles_write on fleet_profiles for all using (fleet_is_admin()) with check (fleet_is_admin());

-- admin-only tables
create policy cards_all on fleet_cards for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy glmap_all on fleet_gl_map for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy imports_all on fleet_imports for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy avis_all on fleet_avis_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy ins_all on fleet_insurance_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy trk_all on fleet_tracking_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy batches_all on fleet_batches for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy journals_all on fleet_journals for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy jlines_all on fleet_journal_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy notif_all on fleet_notifications for all using (fleet_is_admin()) with check (fleet_is_admin());

-- staff can see their own statement lines / deductions / claims / accrual
create policy fa_select on fleet_fa_lines for select
  using (fleet_is_admin() or exists (select 1 from fleet_cards c where c.id = card_id and c.employee_id = fleet_my_employee()));
create policy fa_write on fleet_fa_lines for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy ded_select on fleet_deductions for select using (fleet_is_admin() or employee_id = fleet_my_employee());
create policy ded_write on fleet_deductions for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy claims_select on fleet_claims for select using (fleet_is_admin() or employee_id = fleet_my_employee() or fleet_manages(employee_id));
create policy claims_write on fleet_claims for all using (fleet_is_admin()) with check (fleet_is_admin());
create policy accrual_select on fleet_accrual_txns for select using (fleet_is_admin() or employee_id = fleet_my_employee());
create policy accrual_write on fleet_accrual_txns for all using (fleet_is_admin()) with check (fleet_is_admin());

-- travel logs: own + managed + admin
create policy logs_select on fleet_travel_logs for select
  using (fleet_is_admin() or employee_id = fleet_my_employee() or fleet_manages(employee_id) or lower(coalesce(manager_email,'')) = fleet_my_email());
create policy logs_insert on fleet_travel_logs for insert
  with check (fleet_is_admin() or employee_id = fleet_my_employee());
create policy logs_update on fleet_travel_logs for update
  using (fleet_is_admin() or (employee_id = fleet_my_employee() and status in ('draft','rejected')));
create policy logs_delete on fleet_travel_logs for delete
  using (fleet_is_admin() or (employee_id = fleet_my_employee() and status = 'draft'));
create policy lines_select on fleet_travel_log_lines for select using (fleet_log_visible(log_id));
create policy lines_write on fleet_travel_log_lines for all using (fleet_log_editable(log_id)) with check (fleet_log_editable(log_id));

grant select on fleet_v_accrual_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: settings + GL map defaults (category digit: Admin 0, Ops Cabling 1, Ops Admin 2, Sales 3, Exec 4)
-- ---------------------------------------------------------------------------
insert into fleet_settings (key, value, description) values
  ('app_url', 'https://superherrie.github.io/asi-fleet/', 'Link used in approval e-mails'),
  ('fa_creditor_account', '', 'GL account credited for First Auto statement totals (supplier)'),
  ('staff_deduction_account', '', 'GL account debited for staff fleet-card usage (salary deduction clearing)'),
  ('vat_input_account', '', 'GL account for VAT input on statements'),
  ('avis_creditor_account', '', 'GL account credited for Avis rentals'),
  ('insurance_creditor_account', '', 'GL account credited for insurance premiums'),
  ('tracking_creditor_account', '', 'GL account credited for tracking invoices'),
  ('claims_payable_account', '', 'GL account credited for travel claims paid via payroll'),
  ('maintenance_accrual_account', '', 'Balance-sheet account credited for the maintenance portion of claims'),
  ('notify_from', 'fleet@asiconnect.co.za', 'Sender address for approval e-mails')
on conflict (key) do nothing;

do $$
declare cat text; d text; cats text[] := array['Admin','Ops Cabling','Ops Admin','Sales','Exec'];
begin
  for i in 1..5 loop
    cat := cats[i]; d := (i-1)::text;
    insert into fleet_gl_map (source, cost_type, category, gl_account, gl_name) values
      ('first_auto','fuel',        cat, '215'||d||'00', 'M/V Exp - Fuel/Oil - '||cat),
      ('first_auto','oil',         cat, '215'||d||'00', 'M/V Exp - Fuel/Oil - '||cat),
      ('first_auto','repairs',     cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','tyres',       cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','accident',    cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','maint',       cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','overhaul',    cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','other',       cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','fees',        cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat),
      ('first_auto','toll',        cat, '219'||d||'00', 'M/V Exp - Toll Fees - '||cat),
      ('avis','lease',             cat, '218'||d||'00', 'M/V Exp - Lease/Rental - '||cat),
      ('tracking','tracking',      cat, '217'||d||'00', 'M/V Exp - Surveillance - '||cat),
      ('insurance','insurance',    cat, '415500',       'Insurance'),
      ('claims','claim_fuel',      cat, '215'||d||'00', 'M/V Exp - Fuel/Oil - '||cat),
      ('claims','claim_maint',     cat, '216'||d||'00', 'M/V Exp - Maintenance - '||cat)
    on conflict do nothing;
  end loop;
end $$;

insert into fleet_claim_rates (category, effective_from, fuel_rate, maint_rate)
select c, '2026-07-01', 0, 0 from unnest(array['Admin','Ops Cabling','Ops Admin','Sales','Exec']) c
on conflict do nothing;
