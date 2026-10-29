-- 040: the job title on a held contract follows the holder's payroll position (same rule as branch and category, Herman 29 Oct 2026)
create or replace function fleet_cell_sync_from_staff(p_contract bigint default null) returns int language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  update fleet_cell_contracts c set branch_code = s.branch_code, branch_id = s.branch_id, category = coalesce(s.category, c.category), job_title = coalesce(s.position, c.job_title), updated_at = now()
    from fleet_staff s
   where s.id = c.holder_id and s.kind = 'person' and (p_contract is null or c.id = p_contract)
     and (c.branch_code is distinct from s.branch_code or c.branch_id is distinct from s.branch_id or (s.category is not null and c.category is distinct from s.category) or (s.position is not null and c.job_title is distinct from s.position));
  get diagnostics n = row_count; return n;
end $$;

create or replace function fleet_cell_contract_sync() returns trigger language plpgsql security definer set search_path = public as
$$
declare s fleet_staff;
begin
  if new.holder_id is not null then
    select * into s from fleet_staff where id = new.holder_id;
    if s.kind = 'person' then new.branch_code := s.branch_code; new.branch_id := s.branch_id; new.category := coalesce(s.category, new.category); new.job_title := coalesce(s.position, new.job_title); end if;
  end if;
  return new;
end $$;
drop trigger if exists fleet_cell_contract_sync on fleet_cell_contracts;
create trigger fleet_cell_contract_sync before insert or update of holder_id, branch_code, branch_id, category, job_title on fleet_cell_contracts for each row execute function fleet_cell_contract_sync();
drop trigger if exists fleet_staff_sync_contracts on fleet_staff;
create trigger fleet_staff_sync_contracts after update of branch_code, branch_id, category, position on fleet_staff for each statement execute function fleet_staff_sync_contracts();

select fleet_cell_sync_from_staff(null);
