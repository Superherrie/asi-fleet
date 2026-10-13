-- 031: Branch managers can leave a comment with the quantity they capture for an equipment item.
alter table fleet_equipment_counts add column if not exists note text;
comment on column fleet_equipment_counts.note is 'Free-text comment from the branch with its count (serials, condition, location)';
notify pgrst, 'reload schema';
