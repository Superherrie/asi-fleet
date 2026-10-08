-- 030: Other registrations / unit labels a supplier uses for a vehicle (e.g. Cartrack bills FL97ZYGP as "TEMP-CB120188" from its
-- temporary plate at installation). Imports match these to the vehicle as well as the registration.
alter table fleet_vehicles add column if not exists alt_regs text[] not null default '{}';
comment on column fleet_vehicles.alt_regs is 'Other registrations / labels suppliers use for this vehicle; matched on import like the registration';
notify pgrst, 'reload schema';
