-- 035: IT equipment administrators and return requests.
--   fleet_profiles.it_admin  flags the people who run the IT register (plus fleet admins). Everyone else sees and manages only
--                            the devices held against their own name: add, edit, and ask to return (processed by an administrator).
--   fleet_it_returns         a return request per device; approved by an administrator, which moves the device to branch stock.

alter table fleet_profiles add column if not exists it_admin boolean not null default false;

create or replace function fleet_it_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin or it_admin or role in ('admin','finance','payroll') from fleet_profiles where user_id = auth.uid()), false) $$;
grant execute on function fleet_it_admin() to authenticated;

create or replace function fleet_it_can_manage(p_holder bigint) returns boolean language sql stable security definer set search_path = public as
$$ select fleet_it_admin() or p_holder = fleet_my_staff() $$;

-- ---------------------------------------------------------------- read access: administrators everything, others their own
drop policy if exists ita_select on fleet_it_assets;
create policy ita_select on fleet_it_assets for select using (fleet_it_admin() or holder_id = fleet_my_staff());
drop policy if exists staff_select on fleet_staff;
create policy staff_select on fleet_staff for select using (fleet_it_admin() or id = fleet_my_staff() or kind = 'stock');
drop policy if exists itm_select on fleet_it_moves;
create policy itm_select on fleet_it_moves for select using (fleet_it_admin() or exists (select 1 from fleet_it_assets a where a.id = asset_id and a.holder_id = fleet_my_staff()));

drop view if exists fleet_v_it_leavers;
create view fleet_v_it_leavers with (security_invoker = true) as
  select a.id as asset_id, a.category, a.description, a.serial_no, a.status, a.issued_on, a.site,
         s.id as holder_id, s.full_name, s.emp_no, s.company, s.branch_code, s.branch_id, s.position, s.left_period, s.date_term
  from fleet_it_assets a join fleet_staff s on s.id = a.holder_id
  where a.status <> 'scrapped' and s.kind = 'person' and s.status = 'left';
grant select on fleet_v_it_leavers to authenticated;

-- ---------------------------------------------------------------- actions re-scoped
create or replace function fleet_it_add(p_holder bigint, p_category text, p_description text, p_serial text, p_condition text, p_issued date, p_note text)
returns bigint language plpgsql security definer set search_path = public as
$$
declare h fleet_staff; a bigint;
begin
  select * into h from fleet_staff where id = p_holder;
  if h.id is null then raise exception 'Holder not found'; end if;
  if not (fleet_it_admin() or p_holder = fleet_my_staff()) then raise exception 'You may only add equipment to yourself'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the device (make and model)'; end if;
  insert into fleet_it_assets (category, description, serial_no, condition, issued_on, holder_id, status, note, created_by, created_by_name)
  values (coalesce(nullif(p_category, ''), 'Other'), trim(p_description), nullif(trim(coalesce(p_serial, '')), ''), nullif(p_condition, ''), p_issued,
          p_holder, case when h.kind = 'stock' then 'in_stock' else 'allocated' end, nullif(p_note, ''), auth.uid(), fleet_my_name())
  returning id into a;
  insert into fleet_it_moves (asset_id, action, to_holder, note, by_user, by_name) values (a, 'added', p_holder, nullif(p_note, ''), auth.uid(), fleet_my_name());
  return a;
end $$;

create or replace function fleet_it_move(p_asset bigint, p_to bigint, p_note text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets; t fleet_staff;
begin
  if not fleet_it_admin() then raise exception 'Only an IT equipment administrator may move devices; ask to return yours from My equipment'; end if;
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  select * into t from fleet_staff where id = p_to; if t.id is null then raise exception 'Target holder not found'; end if;
  if a.status = 'scrapped' then raise exception 'This device is scrapped; restore it first'; end if;
  if a.holder_id = p_to then return; end if;
  update fleet_it_assets set holder_id = p_to, status = case when t.kind = 'stock' then 'in_stock' else 'allocated' end, updated_at = now() where id = p_asset;
  update fleet_it_returns set status = 'cancelled', decided_by = fleet_my_name(), decided_at = now(), decision_note = 'Device moved by an administrator' where asset_id = p_asset and status = 'pending';
  insert into fleet_it_moves (asset_id, action, from_holder, to_holder, note, by_user, by_name) values (p_asset, 'moved', a.holder_id, p_to, nullif(p_note, ''), auth.uid(), fleet_my_name());
end $$;

create or replace function fleet_it_scrap(p_asset bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets;
begin
  if not fleet_it_admin() then raise exception 'Only an IT equipment administrator may scrap a device'; end if;
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for scrapping'; end if;
  update fleet_it_assets set status = 'scrapped', scrapped_at = now(), scrapped_by = fleet_my_name(), scrap_reason = trim(p_reason), updated_at = now() where id = p_asset;
  update fleet_it_returns set status = 'cancelled', decided_by = fleet_my_name(), decided_at = now(), decision_note = 'Device scrapped' where asset_id = p_asset and status = 'pending';
  insert into fleet_it_moves (asset_id, action, from_holder, note, by_user, by_name) values (p_asset, 'scrapped', a.holder_id, trim(p_reason), auth.uid(), fleet_my_name());
end $$;

create or replace function fleet_it_restore(p_asset bigint, p_note text)
returns void language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets; h fleet_staff;
begin
  if not fleet_it_admin() then raise exception 'Only an IT equipment administrator may restore a device'; end if;
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  select * into h from fleet_staff where id = a.holder_id;
  update fleet_it_assets set status = case when h.kind = 'stock' then 'in_stock' else 'allocated' end, scrapped_at = null, scrapped_by = null, scrap_reason = null, updated_at = now() where id = p_asset;
  insert into fleet_it_moves (asset_id, action, to_holder, note, by_user, by_name) values (p_asset, 'restored', a.holder_id, nullif(p_note, ''), auth.uid(), fleet_my_name());
end $$;

-- ---------------------------------------------------------------- return requests
alter table fleet_it_moves drop constraint if exists fleet_it_moves_action_check;
alter table fleet_it_moves add constraint fleet_it_moves_action_check check (action in ('added','moved','scrapped','restored','edited','return_requested','return_cancelled','return_rejected'));

create table if not exists fleet_it_returns (
  id                bigserial primary key,
  asset_id          bigint not null references fleet_it_assets(id) on delete cascade,
  requested_by      bigint references fleet_staff(id),
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  note              text,
  status            text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  to_holder         bigint references fleet_staff(id),   -- where the device went on approval
  decided_by        text,
  decided_at        timestamptz,
  decision_note     text
);
create unique index if not exists fleet_it_returns_pending on fleet_it_returns(asset_id) where status = 'pending';
alter table fleet_it_returns enable row level security;
drop policy if exists itr_select on fleet_it_returns;
create policy itr_select on fleet_it_returns for select using (fleet_it_admin() or requested_by = fleet_my_staff());
drop policy if exists itr_write on fleet_it_returns;
create policy itr_write on fleet_it_returns for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_it_returns to authenticated; grant usage, select on sequence fleet_it_returns_id_seq to authenticated;

-- the holder asks to hand a device back
create or replace function fleet_it_request_return(p_asset bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public as
$$
declare a fleet_it_assets; r bigint; mine bigint := fleet_my_staff();
begin
  select * into a from fleet_it_assets where id = p_asset; if a.id is null then raise exception 'Asset not found'; end if;
  if mine is null or a.holder_id <> mine then raise exception 'You can only return a device that is recorded against your name'; end if;
  if a.status <> 'allocated' then raise exception 'This device is not allocated to you'; end if;
  if exists (select 1 from fleet_it_returns where asset_id = p_asset and status = 'pending') then raise exception 'A return request is already waiting for approval'; end if;
  insert into fleet_it_returns (asset_id, requested_by, requested_by_name, note) values (p_asset, mine, fleet_my_name(), nullif(p_note, '')) returning id into r;
  insert into fleet_it_moves (asset_id, action, from_holder, note, by_user, by_name) values (p_asset, 'return_requested', a.holder_id, nullif(p_note, ''), auth.uid(), fleet_my_name());
  return r;
end $$;
grant execute on function fleet_it_request_return(bigint, text) to authenticated;

create or replace function fleet_it_cancel_return(p_return bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare r fleet_it_returns;
begin
  select * into r from fleet_it_returns where id = p_return; if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been processed'; end if;
  if not (fleet_it_admin() or r.requested_by = fleet_my_staff()) then raise exception 'Not your request'; end if;
  update fleet_it_returns set status = 'cancelled', decided_by = fleet_my_name(), decided_at = now() where id = p_return;
  insert into fleet_it_moves (asset_id, action, note, by_user, by_name) values (r.asset_id, 'return_cancelled', null, auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_cancel_return(bigint) to authenticated;

-- an administrator approves (device goes to p_to, or to the holder's branch stock) or rejects
create or replace function fleet_it_decide_return(p_return bigint, p_approve boolean, p_note text, p_to bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare r fleet_it_returns; a fleet_it_assets; h fleet_staff; t bigint;
begin
  if not fleet_it_admin() then raise exception 'Only an IT equipment administrator may process returns'; end if;
  select * into r from fleet_it_returns where id = p_return; if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been processed'; end if;
  select * into a from fleet_it_assets where id = r.asset_id; select * into h from fleet_staff where id = a.holder_id;
  if not p_approve then
    update fleet_it_returns set status = 'rejected', decided_by = fleet_my_name(), decided_at = now(), decision_note = nullif(p_note, '') where id = p_return;
    insert into fleet_it_moves (asset_id, action, from_holder, note, by_user, by_name) values (a.id, 'return_rejected', a.holder_id, nullif(p_note, ''), auth.uid(), fleet_my_name());
    return;
  end if;
  t := coalesce(p_to, (select id from fleet_staff where kind = 'stock' and branch_id = h.branch_id), (select id from fleet_staff where kind = 'stock' and branch_code = '000'));
  if t is null then raise exception 'No stock holder found for this branch; choose where the device goes'; end if;
  update fleet_it_assets set holder_id = t, status = case when (select kind from fleet_staff where id = t) = 'stock' then 'in_stock' else 'allocated' end, updated_at = now() where id = a.id;
  update fleet_it_returns set status = 'approved', to_holder = t, decided_by = fleet_my_name(), decided_at = now(), decision_note = nullif(p_note, '') where id = p_return;
  insert into fleet_it_moves (asset_id, action, from_holder, to_holder, note, by_user, by_name) values (a.id, 'moved', a.holder_id, t, coalesce('Return approved' || case when nullif(p_note, '') is null then '' else ': ' || p_note end, 'Return approved'), auth.uid(), fleet_my_name());
end $$;
grant execute on function fleet_it_decide_return(bigint, boolean, text, bigint) to authenticated;
