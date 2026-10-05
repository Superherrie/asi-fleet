-- 029: Equipment register — are we adequately insured for testers, splicers, toolboxes and the like?
-- One row per item on the insurer's schedule (Business All Risks, specified items) with the quantity and value insured;
-- each branch records how many of that item it actually has. Everyone who uses the app can read the page,
-- fleet admins maintain the item list, and a branch's quantities can only be changed by that branch's managers (or an admin).
create table if not exists fleet_equipment_items (
  id               bigserial primary key,
  section          text not null default 'Business All Risks',  -- section of the insurer's schedule ('Not insured' for items added by us)
  item_no          int,                                          -- item number within that section
  description      text not null,
  category         text not null default 'Other',
  insured_qty      numeric not null default 1,
  unit_value       numeric,                                      -- replacement value per unit used for the comparison
  sum_insured      numeric not null default 0,
  monthly_premium  numeric not null default 0,
  serial_no        text,
  note             text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (section, item_no)
);

create table if not exists fleet_equipment_counts (
  item_id          bigint not null references fleet_equipment_items(id) on delete cascade,
  branch_id        bigint not null references fleet_branches(id),
  qty              numeric not null check (qty >= 0),
  updated_by       uuid default auth.uid(),
  updated_by_name  text not null default '',
  updated_at       timestamptz not null default now(),
  primary key (item_id, branch_id)
);

create or replace function fleet_equipment_count_stamp() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_by_name := coalesce(fleet_my_name(), nullif(new.updated_by_name, ''), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fleet_equipment_count_stamp on fleet_equipment_counts;
create trigger fleet_equipment_count_stamp before insert or update on fleet_equipment_counts for each row execute function fleet_equipment_count_stamp();

alter table fleet_equipment_items enable row level security;
drop policy if exists eqi_select on fleet_equipment_items;
create policy eqi_select on fleet_equipment_items for select using (auth.uid() is not null);
drop policy if exists eqi_write on fleet_equipment_items;
create policy eqi_write on fleet_equipment_items for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_equipment_items to authenticated;
grant usage, select on sequence fleet_equipment_items_id_seq to authenticated;

alter table fleet_equipment_counts enable row level security;
drop policy if exists eqc_select on fleet_equipment_counts;
create policy eqc_select on fleet_equipment_counts for select using (auth.uid() is not null);
-- fleet_my_branches() returns every branch for a fleet admin
drop policy if exists eqc_insert on fleet_equipment_counts;
create policy eqc_insert on fleet_equipment_counts for insert with check (branch_id in (select * from fleet_my_branches()));
drop policy if exists eqc_update on fleet_equipment_counts;
create policy eqc_update on fleet_equipment_counts for update using (branch_id in (select * from fleet_my_branches())) with check (branch_id in (select * from fleet_my_branches()));
drop policy if exists eqc_delete on fleet_equipment_counts;
create policy eqc_delete on fleet_equipment_counts for delete using (branch_id in (select * from fleet_my_branches()));
grant select, insert, update, delete on fleet_equipment_counts to authenticated;
