-- 021: (a) more than one travel log per person per month — one per vehicle (second car, rental while own car is in for repairs)
--      (b) "view all" logins: read-only access to the fleet dashboard for regional managers
--      (c) allocated driver per vehicle, with history; branch managers may reassign vehicles in their branches from their Budget staff list

-- ---------------------------------------------------------------- (a) one log per person per month PER VEHICLE
alter table fleet_travel_logs drop constraint if exists fleet_travel_logs_period_employee_id_key;
alter table fleet_travel_logs add column if not exists vehicle_kind text not null default 'own';
alter table fleet_travel_logs drop constraint if exists fleet_travel_logs_vehicle_kind_check;
alter table fleet_travel_logs add constraint fleet_travel_logs_vehicle_kind_check check (vehicle_kind in ('own', 'second', 'rental'));
alter table fleet_travel_logs add column if not exists vehicle_note text;
create unique index if not exists fleet_travel_logs_period_emp_vehicle on fleet_travel_logs (period, employee_id, upper(coalesce(vehicle_reg, '')));

-- approval: a rental paid for by the company earns the fuel rate only — no maintenance provision on a car the traveller does not maintain
create or replace function fleet_decide_log_core(p_log bigint, p_approve boolean, p_comment text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees; fr numeric; mr numeric; fuel numeric; maint numeric; cl_id bigint; app_url text;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if l.status <> 'submitted' then raise exception 'Log is not awaiting approval'; end if;
  select * into e from fleet_employees where id = l.employee_id;
  select value into app_url from fleet_settings where key = 'app_url';

  if p_approve then
    update fleet_travel_logs set status = 'approved', approved_by = p_actor, approved_at = now(),
           manager_comment = p_comment, approval_token = null, updated_at = now() where id = p_log;
    select * into fr, mr from fleet_rate_for_employee(e.id, l.period);
    if l.vehicle_kind = 'rental' then mr := 0; end if;
    fuel  := round(coalesce(fr,0) * l.business_km, 2);
    maint := round(coalesce(mr,0) * l.business_km, 2);
    insert into fleet_claims (period, employee_id, log_id, category, business_km, fuel_rate, maint_rate, fuel_amount, maint_amount, total_amount)
    values (l.period, l.employee_id, p_log, e.category, l.business_km, coalesce(fr,0), coalesce(mr,0), fuel, maint, fuel + maint)
    on conflict (log_id) do update set business_km = excluded.business_km, fuel_rate = excluded.fuel_rate,
      maint_rate = excluded.maint_rate, fuel_amount = excluded.fuel_amount, maint_amount = excluded.maint_amount,
      total_amount = excluded.total_amount
    returning id into cl_id;
    delete from fleet_accrual_txns where claim_id = cl_id and kind = 'accrual';
    if maint <> 0 then
      insert into fleet_accrual_txns (employee_id, txn_date, period, kind, amount, description, claim_id, created_by)
      values (l.employee_id, (l.period || '-01')::date, l.period, 'accrual', maint,
              format('Maintenance provision %s %s (%s km @ %s)', l.period, coalesce(l.vehicle_reg, ''), l.business_km, mr), cl_id, p_actor);
    end if;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_approved', e.email, format('Travel log approved — %s', l.period),
        format(E'Your travel log for %s (%s) has been approved.\n\nBusiness km: %s\nFuel reimbursement: R %s\nMaintenance provision: R %s\n%s',
               l.period, coalesce(l.vehicle_reg, 'vehicle'), l.business_km, fuel, maint, coalesce(p_comment,'')), p_log);
    end if;
  else
    update fleet_travel_logs set status = 'rejected', approved_by = p_actor, approved_at = now(),
           manager_comment = p_comment, approval_token = null, updated_at = now() where id = p_log;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_rejected', e.email, format('Travel log returned — %s', l.period),
        format(E'Your travel log for %s was returned by your manager.\n\nComment: %s\n\nPlease correct and resubmit it in the ASI Fleet app:\n%s#/my-logs',
               l.period, coalesce(p_comment,'(none)'), coalesce(app_url,'')), p_log);
    end if;
  end if;
end $$;
revoke all on function fleet_decide_log_core(bigint, boolean, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- (b) read-only "view all" logins
alter table fleet_profiles add column if not exists view_all boolean not null default false;
create or replace function fleet_can_view_all() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin or view_all or role in ('admin','finance','payroll') from fleet_profiles where user_id = auth.uid()), false) $$;
grant execute on function fleet_can_view_all() to authenticated;

do $$ declare t text; begin
  foreach t in array array['fleet_fa_lines','fleet_avis_lines','fleet_tracking_lines','fleet_insurance_lines','fleet_maint_lines','fleet_cards','fleet_claims','fleet_imports'] loop
    execute format('drop policy if exists view_all_select on %I', t);
    execute format('create policy view_all_select on %I for select using (fleet_can_view_all())', t);
  end loop;
end $$;

update fleet_profiles set view_all = true
 where lower(email) in ('eugene.lamb@asiconnect.co.za', 'pierre.vanaswegen@asiconnect.co.za', 'gerrit.barnard@asiconnect.co.za');

-- ---------------------------------------------------------------- (c) allocated driver per vehicle
alter table fleet_vehicles add column if not exists driver_name text;
alter table fleet_vehicles add column if not exists driver_since date;

create table if not exists fleet_vehicle_drivers (
  id               bigserial primary key,
  vehicle_id       bigint not null references fleet_vehicles(id) on delete cascade,
  driver_name      text,                       -- null = unassigned / pool
  effective_from   date not null default current_date,
  note             text,
  assigned_by      uuid default auth.uid(),
  assigned_by_name text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists fleet_vehicle_drivers_vehicle on fleet_vehicle_drivers(vehicle_id, effective_from desc);
alter table fleet_vehicle_drivers enable row level security;
drop policy if exists vd_select on fleet_vehicle_drivers;
create policy vd_select on fleet_vehicle_drivers for select using (auth.uid() is not null);
drop policy if exists vd_write on fleet_vehicle_drivers;
create policy vd_write on fleet_vehicle_drivers for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select on fleet_vehicle_drivers to authenticated;

-- admins: any vehicle; branch managers: vehicles allocated to the branches they hold in the Budget app
create or replace function fleet_assign_driver(p_vehicle bigint, p_driver text, p_note text default null, p_from date default current_date)
returns void language plpgsql security definer set search_path = public as
$$
declare v fleet_vehicles; d text;
begin
  select * into v from fleet_vehicles where id = p_vehicle;
  if v.id is null then raise exception 'Vehicle not found'; end if;
  if not (fleet_is_admin() or v.branch_id in (select * from fleet_my_branches())) then raise exception 'This vehicle is not in one of your branches'; end if;
  d := nullif(trim(coalesce(p_driver, '')), '');
  insert into fleet_vehicle_drivers (vehicle_id, driver_name, effective_from, note, assigned_by, assigned_by_name)
  values (p_vehicle, d, coalesce(p_from, current_date), nullif(trim(coalesce(p_note, '')), ''), auth.uid(), coalesce(fleet_my_name(), ''));
  update fleet_vehicles set driver_name = d, driver_since = coalesce(p_from, current_date) where id = p_vehicle;
end $$;
grant execute on function fleet_assign_driver(bigint, text, text, date) to authenticated;

-- staff the caller may assign: the Budget app's employee list (open cycle) for their cost centres; admins get every cost centre
create or replace function fleet_branch_staff()
returns table (branch_code text, name text, title text) language sql stable security definer set search_path = public as
$$
  select c.code, initcap(lower(e.name)), e.title
    from budget_employees e
    join budget_cost_centres c on c.id = e.cost_centre_id
    join budget_cycles y on y.id = e.cycle_id
   where e.active
     and y.id = (select id from budget_cycles order by (status = 'open') desc, fy_year desc limit 1)
     and (fleet_is_admin() or c.code in (select b.code from fleet_branches b where b.id in (select * from fleet_my_branches())))
   order by c.code, e.name
$$;
grant execute on function fleet_branch_staff() to authenticated;

-- opening position: a vehicle whose fleet card is held by a named person takes that person as its driver (pool cards stay unassigned)
with holder as (
  select distinct on (c.vehicle_id) c.vehicle_id, e.full_name
    from fleet_cards c join fleet_employees e on e.id = c.employee_id
   where c.active and c.vehicle_id is not null and e.active
   order by c.vehicle_id, c.id
)
update fleet_vehicles v set driver_name = h.full_name, driver_since = coalesce(v.driver_since, current_date)
  from holder h where h.vehicle_id = v.id and v.driver_name is null;
insert into fleet_vehicle_drivers (vehicle_id, driver_name, effective_from, note, assigned_by_name)
select v.id, v.driver_name, coalesce(v.driver_since, current_date), 'Opening position from fleet-card holder', 'system'
  from fleet_vehicles v where v.driver_name is not null and not exists (select 1 from fleet_vehicle_drivers d where d.vehicle_id = v.id);

-- branch vehicle list now carries the driver
drop function if exists fleet_branch_vehicles(text, text);
create or replace function fleet_branch_vehicles(p_from text, p_to text)
returns table (
  vehicle_id bigint, registration text, year int, make text, model text, ownership text, category text,
  branch_id bigint, branch_code text, branch_name text, holders text, tracking_provider text, insured_value numeric,
  active boolean, disposal_type text, disposal_date date, driver_name text, driver_since date,
  fuel numeric, toll numeric, card_fees numeric, maintenance numeric, avis numeric, tracking numeric, insurance numeric, fines numeric, km numeric
) language sql stable security definer set search_path = public as
$$
  with mine as (select * from fleet_my_branches() as id),
  v as (
    select v.*, b.code as bcode, b.name as bname from fleet_vehicles v join fleet_branches b on b.id = v.branch_id
    where v.branch_id in (select id from mine)
  ),
  cards as (
    select c.vehicle_id, string_agg(distinct coalesce(e.full_name, c.fa_driver_name), ', ') as holders
    from fleet_cards c left join fleet_employees e on e.id = c.employee_id
    where c.active and c.vehicle_id is not null group by c.vehicle_id
  ),
  fa as (
    select c.vehicle_id, sum(l.fuel + l.oil_excl) as fuel, sum(l.toll_excl) as toll, sum(l.fees_excl) as fees,
           sum(l.repairs_excl + l.tyres_excl + l.accident_excl + l.maint_excl + l.overhaul_excl + l.other_excl) as card_maint, sum(coalesce(l.kms, 0)) as km
    from fleet_fa_lines l join fleet_cards c on c.id = l.card_id
    where l.period between p_from and p_to and c.vehicle_id is not null group by c.vehicle_id
  ),
  mt as (select vehicle_id, sum(excl) as excl from fleet_maint_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  av as (select vehicle_id, sum(case when transaction_type ilike '%FINE%' then 0 else total end) as total, sum(case when transaction_type ilike '%FINE%' then total else 0 end) as fines
         from fleet_avis_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  tr as (select vehicle_id, sum(amount_excl) as excl from fleet_tracking_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  ins as (select vehicle_id, sum(premium) as premium from fleet_insurance_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id)
  select v.id, v.registration, v.year, v.make, v.model, v.ownership, v.category, v.branch_id, v.bcode, v.bname, cards.holders, v.tracking_provider, v.insured_value,
         v.active, v.disposal_type, v.disposal_date, v.driver_name, v.driver_since,
         coalesce(fa.fuel, 0), coalesce(fa.toll, 0), coalesce(fa.fees, 0), coalesce(mt.excl, 0) + coalesce(fa.card_maint, 0), coalesce(av.total, 0), coalesce(tr.excl, 0), coalesce(ins.premium, 0), coalesce(av.fines, 0), coalesce(fa.km, 0)
  from v left join cards on cards.vehicle_id = v.id left join fa on fa.vehicle_id = v.id left join mt on mt.vehicle_id = v.id
         left join av on av.vehicle_id = v.id left join tr on tr.vehicle_id = v.id left join ins on ins.vehicle_id = v.id
  order by v.bcode, v.registration
$$;
grant execute on function fleet_branch_vehicles(text, text) to authenticated;
