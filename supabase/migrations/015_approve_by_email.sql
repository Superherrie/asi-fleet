-- 015: Travel-log e-mail workflow.
--  * submit → one-time approval token on the log; the manager's e-mail carries Approve / Return links that work without an app login
--  * fleet_decide_log_core does the approval work once (claim, accrual, notifications); the signed-in RPC and the token RPC both call it
--  * reminder notifications (kind 'log_reminder') that admins can queue from the Travellers dashboard

alter table fleet_travel_logs add column if not exists approval_token uuid;
create index if not exists fleet_travel_logs_token on fleet_travel_logs (approval_token) where approval_token is not null;

alter table fleet_notifications drop constraint if exists fleet_notifications_kind_check;
alter table fleet_notifications add constraint fleet_notifications_kind_check check (kind in ('log_submitted','log_approved','log_rejected','log_reminder'));

-- ---------------------------------------------------------------- the approval work, actor-agnostic
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
              format('Maintenance provision %s (%s km @ %s)', l.period, l.business_km, mr), cl_id, p_actor);
    end if;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_approved', e.email, format('Travel log approved — %s', l.period),
        format(E'Your travel log for %s has been approved.\n\nBusiness km: %s\nFuel reimbursement: R %s\nMaintenance provision: R %s\n%s',
               l.period, l.business_km, fuel, maint, coalesce(p_comment,'')), p_log);
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

-- signed-in manager / admin (unchanged behaviour, now delegating)
create or replace function fleet_decide_log(p_log bigint, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if not (fleet_manages(l.employee_id) or lower(coalesce(l.manager_email,'')) = fleet_my_email()) then
    raise exception 'You are not the approver for this log';
  end if;
  perform fleet_decide_log_core(p_log, p_approve, p_comment, auth.uid());
end $$;

-- from the e-mail link (service role only): the token identifies the log and proves the link came from the manager's mail
create or replace function fleet_decide_log_by_token(p_token uuid, p_approve boolean, p_comment text default null)
returns table (log_id bigint, employee_name text, period text, business_km numeric) language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees;
begin
  select * into l from fleet_travel_logs where approval_token = p_token;
  if l.id is null then raise exception 'This approval link has already been used or is no longer valid'; end if;
  if l.status <> 'submitted' then raise exception 'Log is not awaiting approval'; end if;
  select * into e from fleet_employees where id = l.employee_id;
  perform fleet_decide_log_core(l.id, p_approve, p_comment, null);
  return query select l.id, e.full_name, l.period, l.business_km;
end $$;
revoke all on function fleet_decide_log_by_token(uuid, boolean, text) from public, anon, authenticated;

create or replace function fleet_log_by_token(p_token uuid)
returns table (log_id bigint, employee_name text, period text, business_km numeric, private_km numeric, vehicle_reg text, status text, manager_email text) language sql stable security definer set search_path = public as
$$ select l.id, e.full_name, l.period, l.business_km, l.private_km, l.vehicle_reg, l.status, l.manager_email
   from fleet_travel_logs l join fleet_employees e on e.id = l.employee_id where l.approval_token = p_token $$;
revoke all on function fleet_log_by_token(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- submit: token + links in the manager's mail
create or replace function fleet_submit_log(p_log bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees; mgr text; b numeric; p numeric; app_url text; fn_url text; tok uuid;
begin
  select * into l from fleet_travel_logs where id = p_log;
  if l.id is null then raise exception 'Log not found'; end if;
  if not (fleet_is_admin() or l.employee_id = fleet_my_employee()) then raise exception 'Not your log'; end if;
  if l.status not in ('draft','rejected') then raise exception 'Log already submitted'; end if;
  select coalesce(sum(business_km),0), coalesce(sum(private_km),0) into b, p from fleet_travel_log_lines where log_id = p_log;
  select * into e from fleet_employees where id = l.employee_id;
  mgr := coalesce(nullif(l.manager_email,''), e.manager_email, (select email from fleet_employees where id = e.manager_employee_id));
  tok := gen_random_uuid();
  update fleet_travel_logs
     set business_km = b, private_km = p, status = 'submitted', submitted_at = now(),
         manager_email = mgr, manager_comment = null, approval_token = tok, updated_at = now()
   where id = p_log;
  select value into app_url from fleet_settings where key = 'app_url';
  select value into fn_url from fleet_settings where key = 'approve_url';
  if mgr is not null and mgr <> '' then
    insert into fleet_notifications (kind, to_email, cc_email, subject, body, log_id)
    values ('log_submitted', mgr, e.email,
      format('Travel log for approval: %s — %s', e.full_name, l.period),
      format(E'%s has submitted a travel log for %s.\n\nBusiness km: %s\nPrivate km: %s\nVehicle: %s\n\nAPPROVE:  %s?t=%s&a=approve\nRETURN:   %s?t=%s&a=return\n\n(The links work without logging in. To see the day-by-day detail first, open the log in the app: %s#/approvals/%s)',
             e.full_name, l.period, b, p, coalesce(l.vehicle_reg,''), coalesce(fn_url,''), tok, coalesce(fn_url,''), tok, coalesce(app_url,''), p_log),
      p_log);
  end if;
end $$;

-- ---------------------------------------------------------------- reminders (admin): "your travel log for <month> has not been received"
create or replace function fleet_remind_log(p_employee bigint, p_period text)
returns void language plpgsql security definer set search_path = public as
$$
declare e fleet_employees; app_url text;
begin
  if not fleet_is_admin() then raise exception 'Admins only'; end if;
  select * into e from fleet_employees where id = p_employee;
  if e.email is null or e.email = '' then raise exception 'No e-mail address on file for %', e.full_name; end if;
  select value into app_url from fleet_settings where key = 'app_url';
  insert into fleet_notifications (kind, to_email, subject, body)
  values ('log_reminder', e.email, format('Travel log outstanding — %s', p_period),
    format(E'Hi %s\n\nYour travel log for %s has not been received. Please complete and submit it for approval in the ASI Fleet app:\n%s#/my-logs\n\nClaims are paid with the next payroll only once the log is approved.', e.full_name, p_period, coalesce(app_url,'')));
end $$;

insert into fleet_settings (key, value, description) values ('approve_url', 'https://pniqwvyscmxfxbhtsace.supabase.co/functions/v1/fleet-approve', 'Approve / return link in the manager e-mail (fleet-approve edge function)')
on conflict (key) do update set value = excluded.value;
