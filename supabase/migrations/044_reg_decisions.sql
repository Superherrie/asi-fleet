-- 044: new-vehicle decisions (Herman, 13 Nov 2026): "Do not automatically assume that a new vehicle must be ZZZ. We need to flag
--      attention for any new vehicle that comes through, from Avis, First Auto, anywhere."
--      A registration a supplier bills that is not on the fleet master stays open (Fleet -> New vehicles) until someone either adds it
--      to the master with its branch and category, or records here that it is not ours. Only a "not ours" decision posts to branch ZZZ.
create table if not exists fleet_reg_decisions (
  registration     text primary key,                       -- normalised: upper case, letters and digits only
  decision         text not null default 'not_ours' check (decision in ('not_ours')),
  note             text,
  decided_by       uuid default auth.uid(),
  decided_by_name  text,
  decided_at       timestamptz not null default now()
);
alter table fleet_reg_decisions enable row level security;
drop policy if exists regdec_select on fleet_reg_decisions;
create policy regdec_select on fleet_reg_decisions for select using (auth.uid() is not null);
drop policy if exists regdec_write on fleet_reg_decisions;
create policy regdec_write on fleet_reg_decisions for all using (fleet_is_admin()) with check (fleet_is_admin());
grant select, insert, update, delete on fleet_reg_decisions to authenticated;
comment on table fleet_reg_decisions is 'Registrations billed by a supplier but decided not to be ours (posted to branch ZZZ). No row = still needs a decision.';
