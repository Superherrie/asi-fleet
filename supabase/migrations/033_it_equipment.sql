-- 033: IT equipment (laptops, cellphones, screens ...) allocated to people, replacing the Jotform register.
--   fleet_staff      every person on the payroll master (all group companies), kept current from the payroll app;
--                    plus one "Equipment in stock" holder per branch (kind = 'stock').
--   fleet_it_assets  one row per device; holder = a fleet_staff row (person or branch stock); scrapped keeps the row.
--   fleet_it_moves   audit trail of every add / move / scrap / edit.
--   fleet_v_it_leavers  assets still held by people who have left the payroll.

create table if not exists fleet_staff (
  id            bigserial primary key,
  kind          text not null default 'person' check (kind in ('person','stock')),
  company       text,                              -- payroll company, e.g. 'ASI Connect ICS'
  emp_no        text,                              -- payroll number
  full_name     text not null,
  position      text,
  branch_code   text,                              -- payroll branch code (000, GAU, ...)
  branch_id     bigint references fleet_branches(id),
  email         text,
  status        text not null default 'active' check (status in ('active','left')),
  left_period   text,                              -- last payroll period the person appeared in (YYYY-MM) when status = 'left'
  date_term     date,
  date_emp      date,
  source        text not null default 'payroll',   -- payroll | manual | jotform
  note          text,
  loaded_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists fleet_staff_company_emp on fleet_staff(company, emp_no) where emp_no is not null;
create unique index if not exists fleet_staff_stock_branch on fleet_staff(branch_id) where kind = 'stock';
create index if not exists fleet_staff_email on fleet_staff(lower(email));

create table if not exists fleet_it_assets (
  id             bigserial primary key,
  asset_tag      text,
  category       text not null default 'Other',   -- Laptop, Desktop, Screen, Cellphone, Tablet, Router / dongle, SIM card, Printer, Accessory, Other
  description    text not null,                    -- make and model as captured
  serial_no      text,
  condition      text,
  issued_on      date,
  holder_id      bigint not null references fleet_staff(id),
  status         text not null default 'allocated' check (status in ('allocated','in_stock','scrapped')),
  scrapped_at    timestamptz,
  scrapped_by    text,
  scrap_reason   text,
  site           text,                             -- branch / site as captured on the Jotform (kept when it does not map to a fleet branch)
  source         text not null default 'app',      -- app | jotform
  source_ref     text,                             -- Jotform submitter and date
  note           text,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fleet_it_assets_holder on fleet_it_assets(holder_id);
create index if not exists fleet_it_assets_serial on fleet_it_assets(lower(serial_no));

create table if not exists fleet_it_moves (
  id          bigserial primary key,
  asset_id    bigint not null references fleet_it_assets(id) on delete cascade,
  action      text not null check (action in ('added','moved','scrapped','restored','edited')),
  from_holder bigint references fleet_staff(id),
  to_holder   bigint references fleet_staff(id),
  note        text,
  by_user     uuid,
  by_name     text,
  at          timestamptz not null default now()
);
create index if not exists fleet_it_moves_asset on fleet_it_moves(asset_id);

-- ---------------------------------------------------------------- who am I on the staff list
create or replace function fleet_my_staff() returns bigint language sql stable security definer set search_path = public as
$$
  select s.id from fleet_staff s
  where s.kind = 'person' and (
        lower(s.email) = fleet_my_email()
     or (s.company = 'ASI Connect ICS' and s.emp_no = (select e.emp_no from fleet_employees e where e.id = fleet_my_employee())))
  order by (s.status = 'active') desc, s.id limit 1
$$;
grant execute on function fleet_my_staff() to authenticated;

-- may this login manage (move / scrap / edit) an asset held by p_holder?  admins: all; branch managers: their branches; people: their own
create or replace function fleet_it_can_manage(p_holder bigint) returns boolean language sql stable security definer set search_path = public as
$$
  select fleet_is_admin()
      or exists (select 1 from fleet_staff s where s.id = p_holder and s.branch_id in (select * from fleet_my_branches()))
      or p_holder = fleet_my_staff()
$$;
grant execute on function fleet_it_can_manage(bigint) to authenticated;

-- ---------------------------------------------------------------- RLS: everyone signed in may read; writes go through the functions below
alter table fleet_staff enable row level security;
drop policy if exists staff_select on fleet_staff; create policy staff_select on fleet_staff for select using (auth.uid() is not null);
drop policy if exists staff_write on fleet_staff; create policy staff_write on fleet_staff for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_staff to authenticated; grant usage, select on sequence fleet_staff_id_seq to authenticated;

alter table fleet_it_assets enable row level security;
drop policy if exists ita_select on fleet_it_assets; create policy ita_select on fleet_it_assets for select using (auth.uid() is not null);
drop policy if exists ita_write on fleet_it_assets; create policy ita_write on fleet_it_assets for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_it_assets to authenticated; grant usage, select on sequence fleet_it_assets_id_seq to authenticated;

alter table fleet_it_moves enable row level security;
drop policy if exists itm_select on fleet_it_moves; create policy itm_select on fleet_it_moves for select using (auth.uid() is not null);
drop policy if exists itm_write on fleet_it_moves; create policy itm_write on fleet_it_moves for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_it_moves to authenticated; grant usage, select on sequence fleet_it_moves_id_seq to authenticated;

-- ---------------------------------------------------------------- actions
-- add: anyone signed in may add a device to themselves; admins and branch managers may add to anyone they manage (incl. branch stock)
create or replace function fleet_it_add(p_holder bigint, p_category text, p_description text, p_serial text, p_condition text, p_issued date, p_note text)
returns bigint language plpgsql security definer set search_path = public as
$$
declare h fleet_staff; a bigint;
begin
  select * into h from fleet_staff where id = p_holder;
  if h.id is null then raise exception 'Holder not found'; end if;
  if not fleet_it_can_manage(p_holder) then raise exception 'You may only add equipment to yourself or to the branches you manage'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the device (make and model)'; end if;
  insert into fleet_it_assets (category, description, serial_no, condition, issued_on, holder_id, status, note, created_by, created_by_name)
  values (coalesce(nullif(p_category, ''), 'Other'), trim(p_description), nullif(trim(coalesce(p_serial, '')), ''), nullif(p_condition, ''), p_issued,
          p_holder, case when h.kind = 'stock' then 'in_stock' else 'allocated' end, nullif(p_note, ''), auth.uid(), fleet_my_name())
  returning id into a;
  insert into fleet_it_moves (asset_id, action, to_holder, note, by_user, by_name) values (a, 'added', p_holder, nullif(p_note, ''), auth.uid(), fleet_my_name());
  return a;
end $$;
grant execute on function fleet_it_add(bigint, text, text, text, text, date, text) to authenticated;

-- move: admins anywhere; branch managers within / into their branches; a person may hand their own device to their branch's stock
create or replace function fleet_it_move(p_asset bigint, p_to bigint, p_note text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets; t fleet_staff; mine bigint := fleet_my_staff();
begin
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  select * into t from fleet_staff where id = p_to; if t.id is null then raise exception 'Target holder not found'; end if;
  if a.status = 'scrapped' then raise exception 'This device is scrapped; restore it first'; end if;
  if a.holder_id = p_to then return; end if;
  if not (fleet_is_admin()
       or (a.holder_id in (select id from fleet_staff where branch_id in (select * from fleet_my_branches())) and t.branch_id in (select * from fleet_my_branches()))
       or (a.holder_id = mine and t.kind = 'stock')) then
    raise exception 'You may move this device only within the branches you manage, or hand your own device in to branch stock';
  end if;
  update fleet_it_assets set holder_id = p_to, status = case when t.kind = 'stock' then 'in_stock' else 'allocated' end, updated_at = now() where id = p_asset;
  insert into fleet_it_moves (asset_id, action, from_holder, to_holder, note, by_user, by_name) values (p_asset, 'moved', a.holder_id, p_to, nullif(p_note, ''), auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_move(bigint, bigint, text) to authenticated;

-- scrap / restore: admins and the managers of the holder's branch
create or replace function fleet_it_scrap(p_asset bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets;
begin
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  if not (fleet_is_admin() or a.holder_id in (select id from fleet_staff where branch_id in (select * from fleet_my_branches()))) then raise exception 'Only a fleet administrator or the branch manager may scrap a device'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for scrapping'; end if;
  update fleet_it_assets set status = 'scrapped', scrapped_at = now(), scrapped_by = fleet_my_name(), scrap_reason = trim(p_reason), updated_at = now() where id = p_asset;
  insert into fleet_it_moves (asset_id, action, from_holder, note, by_user, by_name) values (p_asset, 'scrapped', a.holder_id, trim(p_reason), auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_scrap(bigint, text) to authenticated;

create or replace function fleet_it_restore(p_asset bigint, p_note text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets; h fleet_staff;
begin
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  if not (fleet_is_admin() or a.holder_id in (select id from fleet_staff where branch_id in (select * from fleet_my_branches()))) then raise exception 'Only a fleet administrator or the branch manager may restore a device'; end if;
  select * into h from fleet_staff where id = a.holder_id;
  update fleet_it_assets set status = case when h.kind = 'stock' then 'in_stock' else 'allocated' end, scrapped_at = null, scrapped_by = null, scrap_reason = null, updated_at = now() where id = p_asset;
  insert into fleet_it_moves (asset_id, action, to_holder, note, by_user, by_name) values (p_asset, 'restored', a.holder_id, nullif(p_note, ''), auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_restore(bigint, text) to authenticated;

-- edit the description / serial / condition / note: admins, branch managers, or the holder
create or replace function fleet_it_update(p_asset bigint, p_category text, p_description text, p_serial text, p_condition text, p_issued date, p_note text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets;
begin
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  if not fleet_it_can_manage(a.holder_id) then raise exception 'You may only edit your own devices or those in the branches you manage'; end if;
  update fleet_it_assets set category = coalesce(nullif(p_category, ''), category), description = coalesce(nullif(trim(p_description), ''), description),
         serial_no = nullif(trim(coalesce(p_serial, '')), ''), condition = nullif(p_condition, ''), issued_on = p_issued, note = nullif(p_note, ''), updated_at = now()
   where id = p_asset;
  insert into fleet_it_moves (asset_id, action, note, by_user, by_name) values (p_asset, 'edited', format('%s | %s | %s', coalesce(nullif(p_category,''), a.category), trim(p_description), coalesce(p_serial, '')), auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_update(bigint, text, text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------- leavers still holding equipment
create or replace view fleet_v_it_leavers as
  select a.id as asset_id, a.category, a.description, a.serial_no, a.status, a.issued_on, a.site,
         s.id as holder_id, s.full_name, s.emp_no, s.company, s.branch_code, s.branch_id, s.position, s.left_period, s.date_term
  from fleet_it_assets a join fleet_staff s on s.id = a.holder_id
  where a.status <> 'scrapped' and s.kind = 'person' and s.status = 'left';
grant select on fleet_v_it_leavers to authenticated;
