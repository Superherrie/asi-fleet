-- 016: claim status 'finalised' — paid through payroll and closed (set by admin once the payroll run is done)
alter table fleet_claims drop constraint if exists fleet_claims_status_check;
alter table fleet_claims add constraint fleet_claims_status_check check (status in ('pending','exported','paid','finalised'));
