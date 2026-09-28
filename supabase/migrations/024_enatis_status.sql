-- 024: eNaTIS registered-owner status per vehicle, from the "Motor Vehicles per Person" query (ASI Connect ICS as owner).
alter table fleet_vehicles add column if not exists enatis_status text check (enatis_status in ('registered','not_registered'));
alter table fleet_vehicles add column if not exists enatis_checked date;
alter table fleet_vehicles add column if not exists enatis_note text;
