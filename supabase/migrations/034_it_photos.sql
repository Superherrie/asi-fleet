-- 034: a photo per IT device, in the public bucket 'it-photos' under <asset id>/<timestamp>.jpg (same pattern as copier photos).
alter table fleet_it_assets add column if not exists photo_path text;
alter table fleet_it_assets add column if not exists photo_at timestamptz;
alter table fleet_it_assets add column if not exists photo_by text;

-- the holder, the branch managers or an admin may attach / replace / remove the photo; nothing else on the row changes
create or replace function fleet_it_set_photo(p_asset bigint, p_path text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets;
begin
  select * into a from fleet_it_assets where id = p_asset;
  if a.id is null then raise exception 'Asset not found'; end if;
  if not fleet_it_can_manage(a.holder_id) then raise exception 'You may add photos only to your own devices or those in the branches you manage'; end if;
  update fleet_it_assets set photo_path = nullif(p_path, ''), photo_at = case when nullif(p_path, '') is null then null else now() end,
         photo_by = case when nullif(p_path, '') is null then null else coalesce(fleet_my_name(), '') end, updated_at = now()
   where id = p_asset;
end $$;
grant execute on function fleet_it_set_photo(bigint, text) to authenticated;

drop policy if exists it_photos_read on storage.objects;
create policy it_photos_read on storage.objects for select using (bucket_id = 'it-photos');
drop policy if exists it_photos_write on storage.objects;
create policy it_photos_write on storage.objects for insert with check (bucket_id = 'it-photos' and auth.uid() is not null);
drop policy if exists it_photos_update on storage.objects;
create policy it_photos_update on storage.objects for update using (bucket_id = 'it-photos' and auth.uid() is not null);
drop policy if exists it_photos_delete on storage.objects;
create policy it_photos_delete on storage.objects for delete using (bucket_id = 'it-photos' and (fleet_is_admin() or owner = auth.uid()));
