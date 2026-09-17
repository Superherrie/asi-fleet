-- 019: The manager e-mail on a travel log always comes from the employee record (manager_email, else the manager employee's e-mail).
-- Drivers can no longer type it; only an admin editing the log may override it.

create or replace function fleet_employee_manager_email(emp bigint) returns text language sql stable security definer set search_path = public as
$$ select lower(coalesce(nullif(e.manager_email, ''), (select m.email from fleet_employees m where m.id = e.manager_employee_id))) from fleet_employees e where e.id = emp $$;
grant execute on function fleet_employee_manager_email(bigint) to authenticated;

create or replace function fleet_travel_log_lock_manager() returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := fleet_employee_manager_email(new.employee_id);
  -- non-admins always get the employee record's manager; admins keep what they typed unless it is blank
  if not fleet_is_admin() or coalesce(new.manager_email, '') = '' then
    new.manager_email := coalesce(v, new.manager_email);
  end if;
  return new;
end $$;
drop trigger if exists fleet_travel_log_lock_manager on fleet_travel_logs;
create trigger fleet_travel_log_lock_manager before insert or update on fleet_travel_logs for each row execute function fleet_travel_log_lock_manager();

-- backfill: every log that is still in play takes the manager from the employee record
update fleet_travel_logs l set manager_email = fleet_employee_manager_email(l.employee_id)
 where l.status in ('draft', 'rejected', 'submitted') and fleet_employee_manager_email(l.employee_id) is not null
   and coalesce(lower(l.manager_email), '') <> fleet_employee_manager_email(l.employee_id);
