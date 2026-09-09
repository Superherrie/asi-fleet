-- 011: Effective-dated branch / category allocations for vehicles and staff.
-- Every cost (fuel, maintenance, Avis, tracking, insurance, claims) is placed by the allocation in force for the
-- month of the cost, so moving a vehicle or person to another branch from month X keeps earlier months on the old branch.
-- fleet_vehicles.branch_id / category and fleet_employees.branch_id / category hold the CURRENT allocation (kept in sync by trigger).

create table if not exists fleet_allocations (
  id             bigserial primary key,
  vehicle_id     bigint references fleet_vehicles(id) on delete cascade,
  employee_id    bigint references fleet_employees(id) on delete cascade,
  branch_id      bigint references fleet_branches(id),
  category       text not null check (category in ('Admin','Ops Cabling','Ops Admin','Sales','Exec')),
  effective_from text not null check (effective_from ~ '^\d{4}-\d{2}$'),   -- usage month 'YYYY-MM'
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  check ((vehicle_id is null) <> (employee_id is null))
);
create unique index if not exists fleet_allocations_vehicle_period on fleet_allocations (vehicle_id, effective_from) where vehicle_id is not null;
create unique index if not exists fleet_allocations_employee_period on fleet_allocations (employee_id, effective_from) where employee_id is not null;

alter table fleet_allocations enable row level security;
drop policy if exists allocations_select on fleet_allocations;
create policy allocations_select on fleet_allocations for select using (auth.role() = 'authenticated');
drop policy if exists allocations_write on fleet_allocations;
create policy allocations_write on fleet_allocations for all using (fleet_is_admin()) with check (fleet_is_admin());

-- keep the masters' current branch / category equal to the latest allocation
create or replace function fleet_sync_allocation() returns trigger language plpgsql security definer set search_path = public as $$
declare vid bigint; eid bigint; r record;
begin
  vid := coalesce(new.vehicle_id, old.vehicle_id); eid := coalesce(new.employee_id, old.employee_id);
  if vid is not null then
    select branch_id, category into r from fleet_allocations where vehicle_id = vid order by effective_from desc limit 1;
    if found then update fleet_vehicles set branch_id = r.branch_id, category = r.category where id = vid; end if;
  end if;
  if eid is not null then
    select branch_id, category into r from fleet_allocations where employee_id = eid order by effective_from desc limit 1;
    if found then update fleet_employees set branch_id = r.branch_id, category = r.category where id = eid; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists fleet_allocations_sync on fleet_allocations;
create trigger fleet_allocations_sync after insert or update or delete on fleet_allocations for each row execute function fleet_sync_allocation();

-- Opening allocations at the start of FY2027 (July 2026): the fleet master, corrected to the Budget app's allocations.
insert into fleet_allocations (vehicle_id, branch_id, category, effective_from, note)
select v.id, v.branch_id, v.category, '2026-07', 'Opening allocation'
from fleet_vehicles v where not exists (select 1 from fleet_allocations a where a.vehicle_id = v.id);
insert into fleet_allocations (employee_id, branch_id, category, effective_from, note)
select e.id, e.branch_id, e.category, '2026-07', 'Opening allocation'
from fleet_employees e where not exists (select 1 from fleet_allocations a where a.employee_id = e.id);

-- Budget app differences (checked 2026-09-09)
update fleet_allocations a set category = 'Ops Admin', note = 'Opening allocation (Budget app)'
from fleet_vehicles v where a.vehicle_id = v.id and a.effective_from = '2026-07' and v.registration = 'XZJ192GP';
update fleet_allocations a set branch_id = b.id, note = 'Opening allocation (Budget app)'
from fleet_employees e, fleet_branches b
where a.employee_id = e.id and a.effective_from = '2026-07' and (
     (e.full_name ilike 'Christal Jansen%' and b.code = '000')
  or (e.full_name = 'James Wilson'      and b.code = 'CPT')
  or (e.full_name = 'Natalie Simmonds'  and b.code = 'DCS')
  or (e.full_name = 'Harry Meintjes'    and b.code = 'GAU')
  or (e.full_name = 'Ryno Fourie'       and b.code = 'SEC')
  or (e.full_name = 'George Pienaar'    and b.code = 'SEC'));
