-- 039: Herman's rules (29 Oct 2026): a person's branch and department come from the monthly payroll load (fleet_staff), and the
--      department drives the GL classification. A contract held by a person therefore always carries that person's payroll
--      branch and category; only pool numbers (no holder) keep their own.
create or replace function fleet_cell_sync_from_staff(p_contract bigint default null) returns int language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  update fleet_cell_contracts c set branch_code = s.branch_code, branch_id = s.branch_id, category = coalesce(s.category, c.category), updated_at = now()
    from fleet_staff s
   where s.id = c.holder_id and s.kind = 'person' and (p_contract is null or c.id = p_contract)
     and (c.branch_code is distinct from s.branch_code or c.branch_id is distinct from s.branch_id or (s.category is not null and c.category is distinct from s.category));
  get diagnostics n = row_count; return n;
end $$;
grant execute on function fleet_cell_sync_from_staff(bigint) to authenticated;

-- keep a contract in step with its holder on every save
create or replace function fleet_cell_contract_sync() returns trigger language plpgsql security definer set search_path = public as
$$
declare s fleet_staff;
begin
  if new.holder_id is not null then
    select * into s from fleet_staff where id = new.holder_id;
    if s.kind = 'person' then new.branch_code := s.branch_code; new.branch_id := s.branch_id; new.category := coalesce(s.category, new.category); end if;
  end if;
  return new;
end $$;
drop trigger if exists fleet_cell_contract_sync on fleet_cell_contracts;
create trigger fleet_cell_contract_sync before insert or update of holder_id, branch_code, branch_id, category on fleet_cell_contracts for each row execute function fleet_cell_contract_sync();

-- and whenever the payroll load changes a person's branch or department
create or replace function fleet_staff_sync_contracts() returns trigger language plpgsql security definer set search_path = public as
$$ begin perform fleet_cell_sync_from_staff(null); return new; end $$;
drop trigger if exists fleet_staff_sync_contracts on fleet_staff;
create trigger fleet_staff_sync_contracts after update of branch_code, branch_id, category on fleet_staff for each statement execute function fleet_staff_sync_contracts();

select fleet_cell_sync_from_staff(null);
