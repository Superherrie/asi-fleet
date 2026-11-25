-- 048: "My equipment" finds a person's devices through the e-mail on their staff record (fleet_my_staff). The payroll load
-- only fills that e-mail for people who already had a login on the day it ran, so somebody given a login later (Cornel
-- Ahmad, 24 Nov 2026) saw an empty "My equipment" although devices were allocated to her.
-- A login now links itself: when a fleet profile is created or its e-mail / name changes, the active staff record with
-- exactly that name and no e-mail yet gets the login's e-mail. Nothing is touched when the name is not unique or the
-- e-mail is already on another staff record.
create or replace function fleet_link_profile_to_staff() returns trigger language plpgsql security definer set search_path = public as $$
declare nm text := lower(regexp_replace(trim(coalesce(new.full_name, '')), '\s+', ' ', 'g'));
begin
  if nm = '' or coalesce(new.email, '') = '' then return new; end if;
  if exists (select 1 from fleet_staff where kind = 'person' and lower(email) = lower(new.email)) then return new; end if;
  if (select count(*) from fleet_staff where kind = 'person' and status = 'active' and lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = nm) <> 1 then return new; end if;
  update fleet_staff set email = lower(new.email), updated_at = now()
   where kind = 'person' and status = 'active' and email is null and lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = nm;
  return new;
end $$;
drop trigger if exists fleet_profiles_link_staff on fleet_profiles;
create trigger fleet_profiles_link_staff after insert or update of email, full_name on fleet_profiles for each row execute function fleet_link_profile_to_staff();

-- the logins that exist today and are not linked yet (fires the trigger for each)
update fleet_profiles p set full_name = p.full_name
 where not exists (select 1 from fleet_staff s where s.kind = 'person' and lower(s.email) = lower(p.email));
