-- Per-person reimbursement rates (payroll's July 2026 sheet has rates per employee, not only per category)
alter table fleet_employees add column if not exists fuel_rate numeric(10,4);
alter table fleet_employees add column if not exists maint_rate numeric(10,4);
alter table fleet_employees add column if not exists vehicle_reg text;   -- private vehicle used for claims

-- rate resolution: employee override first, then category rate in force for the period
create or replace function fleet_rate_for_employee(p_employee bigint, p_period text)
returns table (fuel_rate numeric, maint_rate numeric) language sql stable security definer set search_path = public as
$$
  select coalesce(e.fuel_rate, r.fuel_rate, 0), coalesce(e.maint_rate, r.maint_rate, 0)
  from fleet_employees e
  left join lateral (select * from fleet_rate_for(e.category, p_period)) r on true
  where e.id = p_employee
$$;

create or replace function fleet_decide_log(p_log bigint, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare l fleet_travel_logs; e fleet_employees; fr numeric; mr numeric; fuel numeric; maint numeric; cl_id bigint; app_url text;
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
              format('Maintenance provision %s (%s km @ %s)', l.period, l.business_km, mr), cl_id, auth.uid());
    end if;
    if e.email is not null then
      insert into fleet_notifications (kind, to_email, subject, body, log_id)
      values ('log_approved', e.email, format('Travel log approved — %s', l.period),
        format(E'Your travel log for %s has been approved.\n\nBusiness km: %s\nFuel reimbursement: R %s\nMaintenance provision: R %s\n%s',
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

-- Randburg cost code seen on the 2026 statements belongs to Gauteng
update fleet_branches set aliases = array_append(aliases, 'RB1') where code = 'GAU' and not ('RB1' = any(aliases));
update fleet_branches set aliases = array_append(aliases, 'RANDBURG') where code = 'GAU' and not ('RANDBURG' = any(aliases));
