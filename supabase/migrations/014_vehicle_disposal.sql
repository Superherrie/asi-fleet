-- 014: track when a vehicle leaves the fleet — sold, returned (Avis) or written off — with the date.
alter table fleet_vehicles add column if not exists disposal_type text check (disposal_type in ('sold','returned','written_off'));
alter table fleet_vehicles add column if not exists disposal_date date;
alter table fleet_vehicles add column if not exists disposal_note text;
-- a disposed vehicle is inactive; clearing the disposal reactivates it
create or replace function fleet_vehicle_disposal_sync() returns trigger language plpgsql as $$
begin
  if new.disposal_type is not null and new.disposal_date is not null then new.active := false;
  elsif (old.disposal_type is not null) and new.disposal_type is null then new.active := true; end if;
  return new;
end $$;
drop trigger if exists fleet_vehicles_disposal on fleet_vehicles;
create trigger fleet_vehicles_disposal before update on fleet_vehicles for each row execute function fleet_vehicle_disposal_sync();
