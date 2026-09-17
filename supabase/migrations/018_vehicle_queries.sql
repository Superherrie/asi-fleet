-- 018: Vehicle queries — a branch manager raises a query on one of their vehicles; admins answer on the dashboard.
-- One query = a thread of comments. Status: open (waiting for admin) → answered (admin replied) → closed.

create or replace function fleet_my_name() returns text language sql stable security definer set search_path = public as
$$ select coalesce(nullif(full_name, ''), email) from fleet_profiles where user_id = auth.uid() $$;

create table if not exists fleet_vehicle_queries (
  id              bigserial primary key,
  vehicle_id      bigint not null references fleet_vehicles(id) on delete cascade,
  branch_id       bigint references fleet_branches(id),
  period_from     text,
  period_to       text,
  subject         text not null default '',
  status          text not null default 'open' check (status in ('open','answered','closed')),
  raised_by       uuid not null default auth.uid() references auth.users(id) on delete set null,
  raised_by_name  text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists fleet_vehicle_queries_vehicle on fleet_vehicle_queries(vehicle_id);
create index if not exists fleet_vehicle_queries_status on fleet_vehicle_queries(status);

create table if not exists fleet_vehicle_query_comments (
  id           bigserial primary key,
  query_id     bigint not null references fleet_vehicle_queries(id) on delete cascade,
  author       uuid not null default auth.uid() references auth.users(id) on delete set null,
  author_name  text not null default '',
  by_admin     boolean not null default false,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists fleet_vehicle_query_comments_query on fleet_vehicle_query_comments(query_id);

-- fill names / branch on insert; a comment moves the query between open and answered and bumps updated_at
create or replace function fleet_vehicle_query_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.raised_by := coalesce(new.raised_by, auth.uid());
  new.raised_by_name := coalesce(nullif(new.raised_by_name, ''), fleet_my_name(), '');
  new.branch_id := coalesce(new.branch_id, (select branch_id from fleet_vehicles where id = new.vehicle_id));
  return new;
end $$;
drop trigger if exists fleet_vehicle_query_bi on fleet_vehicle_queries;
create trigger fleet_vehicle_query_bi before insert on fleet_vehicle_queries for each row execute function fleet_vehicle_query_before_insert();

create or replace function fleet_vehicle_query_comment_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author := coalesce(new.author, auth.uid());
  new.author_name := coalesce(nullif(new.author_name, ''), fleet_my_name(), '');
  new.by_admin := fleet_is_admin();
  update fleet_vehicle_queries
     set updated_at = now(),
         status = case when status = 'closed' then 'closed' when new.by_admin then 'answered' else 'open' end
   where id = new.query_id;
  return new;
end $$;
drop trigger if exists fleet_vehicle_query_comment_bi on fleet_vehicle_query_comments;
create trigger fleet_vehicle_query_comment_bi before insert on fleet_vehicle_query_comments for each row execute function fleet_vehicle_query_comment_before_insert();

-- who may see a query: admins, the person who raised it, and anyone holding the vehicle's branch
create or replace function fleet_can_see_query(q bigint) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from fleet_vehicle_queries x where x.id = q and (fleet_is_admin() or x.raised_by = auth.uid() or x.branch_id in (select * from fleet_my_branches()))) $$;

alter table fleet_vehicle_queries enable row level security;
alter table fleet_vehicle_query_comments enable row level security;
drop policy if exists vq_select on fleet_vehicle_queries;
create policy vq_select on fleet_vehicle_queries for select using (fleet_is_admin() or raised_by = auth.uid() or branch_id in (select * from fleet_my_branches()));
drop policy if exists vq_insert on fleet_vehicle_queries;
create policy vq_insert on fleet_vehicle_queries for insert with check (fleet_is_admin() or vehicle_id in (select id from fleet_vehicles where branch_id in (select * from fleet_my_branches())));
drop policy if exists vq_update on fleet_vehicle_queries;
create policy vq_update on fleet_vehicle_queries for update using (fleet_is_admin() or raised_by = auth.uid()) with check (fleet_is_admin() or raised_by = auth.uid());
drop policy if exists vqc_select on fleet_vehicle_query_comments;
create policy vqc_select on fleet_vehicle_query_comments for select using (fleet_can_see_query(query_id));
drop policy if exists vqc_insert on fleet_vehicle_query_comments;
create policy vqc_insert on fleet_vehicle_query_comments for insert with check (fleet_can_see_query(query_id));
grant select, insert, update on fleet_vehicle_queries to authenticated;
grant select, insert on fleet_vehicle_query_comments to authenticated;
grant usage, select on sequence fleet_vehicle_queries_id_seq, fleet_vehicle_query_comments_id_seq to authenticated;
