-- 023: Copiers / printers — rented multifunction machines, allocated to a branch, with a photo and the same query workflow as vehicles.

create table if not exists fleet_copiers (
  id            bigserial primary key,
  model         text not null,
  serial_no     text not null unique,
  supplier      text not null default 'Interconnect Systems',
  location      text,                      -- physical address as on the supplier's schedule
  branch_id     bigint references fleet_branches(id),
  contract_end  date,                      -- null = month to month
  month_to_month boolean not null default false,
  rental_excl   numeric(12,2) not null default 0,
  avg_black     int,                       -- average monthly copies per the supplier's schedule
  avg_colour    int,
  photo_path    text,                      -- object path in the copier-photos bucket
  photo_at      timestamptz,
  photo_by      text,
  active        boolean not null default true,
  disposal_note text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table fleet_copiers enable row level security;
drop policy if exists copiers_select on fleet_copiers;
create policy copiers_select on fleet_copiers for select using (auth.uid() is not null);
drop policy if exists copiers_write on fleet_copiers;
create policy copiers_write on fleet_copiers for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_copiers to authenticated;
grant usage, select on sequence fleet_copiers_id_seq to authenticated;

-- branch managers (and admins) may attach a photo to a copier in their branches; nothing else on the row changes
create or replace function fleet_copier_set_photo(p_copier bigint, p_path text)
returns void language plpgsql security definer set search_path = public as
$$
declare c fleet_copiers;
begin
  select * into c from fleet_copiers where id = p_copier;
  if c.id is null then raise exception 'Copier not found'; end if;
  if not (fleet_is_admin() or c.branch_id in (select * from fleet_my_branches())) then raise exception 'This copier is not in one of your branches'; end if;
  update fleet_copiers set photo_path = nullif(p_path, ''), photo_at = case when nullif(p_path, '') is null then null else now() end,
         photo_by = case when nullif(p_path, '') is null then null else coalesce(fleet_my_name(), '') end, updated_at = now()
   where id = p_copier;
end $$;
grant execute on function fleet_copier_set_photo(bigint, text) to authenticated;

-- the branch page: copiers in my branches (all for admins / view-all logins)
create or replace function fleet_my_copiers()
returns setof fleet_copiers language sql stable security definer set search_path = public as
$$ select * from fleet_copiers where fleet_can_view_all() or branch_id in (select * from fleet_my_branches()) order by branch_id, model $$;
grant execute on function fleet_my_copiers() to authenticated;

-- ---------------------------------------------------------------- queries: one table for vehicles and copiers
alter table fleet_vehicle_queries alter column vehicle_id drop not null;
alter table fleet_vehicle_queries add column if not exists copier_id bigint references fleet_copiers(id) on delete cascade;
alter table fleet_vehicle_queries drop constraint if exists fleet_vehicle_queries_subject_check;
alter table fleet_vehicle_queries add constraint fleet_vehicle_queries_subject_check check ((vehicle_id is not null)::int + (copier_id is not null)::int = 1);
create index if not exists fleet_vehicle_queries_copier on fleet_vehicle_queries(copier_id);

create or replace function fleet_vehicle_query_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.raised_by := coalesce(new.raised_by, auth.uid());
  new.raised_by_name := coalesce(nullif(new.raised_by_name, ''), fleet_my_name(), '');
  new.branch_id := coalesce(new.branch_id,
    (select branch_id from fleet_vehicles where id = new.vehicle_id),
    (select branch_id from fleet_copiers where id = new.copier_id));
  return new;
end $$;

drop policy if exists vq_insert on fleet_vehicle_queries;
create policy vq_insert on fleet_vehicle_queries for insert with check (
  fleet_is_admin()
  or vehicle_id in (select id from fleet_vehicles where branch_id in (select * from fleet_my_branches()))
  or copier_id  in (select id from fleet_copiers  where branch_id in (select * from fleet_my_branches()))
);

-- ---------------------------------------------------------------- photo storage: anyone signed in may read; uploads by signed-in users into copiers/<id>/...
drop policy if exists copier_photos_read on storage.objects;
create policy copier_photos_read on storage.objects for select using (bucket_id = 'copier-photos');
drop policy if exists copier_photos_write on storage.objects;
create policy copier_photos_write on storage.objects for insert with check (bucket_id = 'copier-photos' and auth.uid() is not null);
drop policy if exists copier_photos_update on storage.objects;
create policy copier_photos_update on storage.objects for update using (bucket_id = 'copier-photos' and auth.uid() is not null);
drop policy if exists copier_photos_delete on storage.objects;
create policy copier_photos_delete on storage.objects for delete using (bucket_id = 'copier-photos' and (fleet_is_admin() or owner = auth.uid()));
