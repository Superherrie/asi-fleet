-- 020: A driver can take back a log they submitted by mistake, as long as the manager has not yet decided on it.
create or replace function fleet_withdraw_log(p_log bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if not (fleet_is_admin() or l.employee_id = fleet_my_employee()) then raise exception 'Not your log'; end if;
  if l.status <> 'submitted' then raise exception 'Only a submitted log can be withdrawn (this one is %)', l.status; end if;
  update fleet_travel_logs
     set status = 'draft', submitted_at = null, approval_token = null, updated_at = now()
   where id = p_log;
  -- the approval request is no longer valid: drop it if it has not gone out yet
  delete from fleet_notifications where log_id = p_log and kind = 'log_submitted' and status = 'pending';
end $$;
grant execute on function fleet_withdraw_log(bigint) to authenticated;
