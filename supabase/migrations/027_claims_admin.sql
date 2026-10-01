-- 027: Claims administrators — logins that may create and manage insurance claims without being fleet admins.
alter table fleet_profiles add column if not exists claims_admin boolean not null default false;

create or replace function fleet_claims_admin() returns boolean language sql stable security definer set search_path = public as
$$ select fleet_is_admin() or coalesce((select claims_admin from fleet_profiles where user_id = auth.uid()), false) $$;
grant execute on function fleet_claims_admin() to authenticated;

create or replace function fleet_can_see_claim(p_claim bigint) returns boolean language sql stable security definer set search_path = public as
$$ select fleet_can_view_all() or fleet_claims_admin() or exists (select 1 from fleet_insurance_claims c where c.id = p_claim and c.branch_id in (select * from fleet_my_branches())) $$;

drop policy if exists icl_select on fleet_insurance_claims;
create policy icl_select on fleet_insurance_claims for select using (fleet_can_view_all() or fleet_claims_admin() or branch_id in (select * from fleet_my_branches()));
drop policy if exists icl_write on fleet_insurance_claims;
create policy icl_write on fleet_insurance_claims for all using (fleet_claims_admin()) with check (fleet_claims_admin());
drop policy if exists ice_insert on fleet_insurance_claim_events;
create policy ice_insert on fleet_insurance_claim_events for insert with check (fleet_claims_admin() or claim_id in (select id from fleet_insurance_claims where branch_id in (select * from fleet_my_branches())));
drop policy if exists ice_admin on fleet_insurance_claim_events;
create policy ice_admin on fleet_insurance_claim_events for all using (fleet_claims_admin()) with check (fleet_claims_admin());

update fleet_profiles set claims_admin = true where lower(email) = 'sega.tiro@asiconnect.co.za';
