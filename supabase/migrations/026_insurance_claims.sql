-- 026: Insurance claims — one row per incident / claim with a dated progress log. Admins manage claims; branch managers see the
-- claims of their branches and can add progress updates.
create table if not exists fleet_insurance_claims (
  id                bigserial primary key,
  vehicle_id        bigint references fleet_vehicles(id) on delete set null,
  asset_desc        text,                         -- for non-vehicle claims (stock, equipment, copier …)
  branch_id         bigint references fleet_branches(id),
  incident_date     date not null,
  incident_type     text not null default 'accident'
                      check (incident_type in ('accident','hijacking','theft','break_in','windscreen','third_party','stock_in_transit','other')),
  location          text,
  driver_name       text,
  description       text,
  police_station    text,
  police_case_no    text,
  reported_internal date,                         -- date the incident was reported to head office
  reported_insurer  date,                         -- date the claim was lodged with the broker / insurer
  insurer           text,
  policy_no         text,
  claim_no          text,
  handler           text,                         -- claims handler at the broker / insurer
  owner_name        text,                         -- person driving the claim on our side
  status            text not null default 'reported'
                      check (status in ('reported','documents_outstanding','registered','assessment','approved','in_repair','settled','rejected','withdrawn')),
  outstanding       text,                         -- what is still needed / next action
  quote_amount      numeric(14,2),
  excess_amount     numeric(14,2),
  settlement_amount numeric(14,2),
  closed_date       date,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists fleet_insurance_claims_vehicle on fleet_insurance_claims(vehicle_id);

create table if not exists fleet_insurance_claim_events (
  id          bigserial primary key,
  claim_id    bigint not null references fleet_insurance_claims(id) on delete cascade,
  event_date  date not null default current_date,
  body        text not null,
  author_id   uuid default auth.uid(),
  author_name text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists fleet_insurance_claim_events_claim on fleet_insurance_claim_events(claim_id, event_date);

create or replace function fleet_can_see_claim(p_claim bigint) returns boolean language sql stable security definer set search_path = public as
$$ select fleet_can_view_all() or exists (select 1 from fleet_insurance_claims c where c.id = p_claim and c.branch_id in (select * from fleet_my_branches())) $$;
grant execute on function fleet_can_see_claim(bigint) to authenticated;

create or replace function fleet_insurance_claim_event_stamp() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  new.author_name := coalesce(nullif(new.author_name, ''), fleet_my_name(), '');
  update fleet_insurance_claims set updated_at = now() where id = new.claim_id;
  return new;
end $$;
drop trigger if exists fleet_insurance_claim_event_stamp on fleet_insurance_claim_events;
create trigger fleet_insurance_claim_event_stamp before insert on fleet_insurance_claim_events for each row execute function fleet_insurance_claim_event_stamp();

alter table fleet_insurance_claims enable row level security;
alter table fleet_insurance_claim_events enable row level security;
drop policy if exists icl_select on fleet_insurance_claims;
create policy icl_select on fleet_insurance_claims for select using (fleet_can_view_all() or branch_id in (select * from fleet_my_branches()));
drop policy if exists icl_write on fleet_insurance_claims;
create policy icl_write on fleet_insurance_claims for all using (fleet_is_admin()) with check (fleet_is_admin());
drop policy if exists ice_select on fleet_insurance_claim_events;
create policy ice_select on fleet_insurance_claim_events for select using (fleet_can_see_claim(claim_id));
drop policy if exists ice_insert on fleet_insurance_claim_events;
create policy ice_insert on fleet_insurance_claim_events for insert with check (fleet_can_see_claim(claim_id) and (fleet_is_admin() or claim_id in (select id from fleet_insurance_claims where branch_id in (select * from fleet_my_branches()))));
drop policy if exists ice_admin on fleet_insurance_claim_events;
create policy ice_admin on fleet_insurance_claim_events for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_insurance_claims, fleet_insurance_claim_events to authenticated;
grant usage, select on sequence fleet_insurance_claims_id_seq, fleet_insurance_claim_events_id_seq to authenticated;
