-- 036: a second ("back") photo per IT device, stored like the first.
alter table fleet_it_assets add column if not exists photo2_path text;
alter table fleet_it_assets add column if not exists photo2_at timestamptz;
alter table fleet_it_assets add column if not exists photo2_by text;

create or replace function fleet_it_set_photo2(p_asset bigint, p_path text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets;
begin
  select * into a from fleet_it_assets where id = p_asset;
  if a.id is null then raise exception 'Asset not found'; end if;
  if not fleet_it_can_manage(a.holder_id) then raise exception 'You may add photos only to your own devices or those in the branches you manage'; end if;
  update fleet_it_assets set photo2_path = nullif(p_path, ''), photo2_at = case when nullif(p_path, '') is null then null else now() end,
         photo2_by = case when nullif(p_path, '') is null then null else coalesce(fleet_my_name(), '') end, updated_at = now()
   where id = p_asset;
end $$;
grant execute on function fleet_it_set_photo2(bigint, text) to authenticated;
