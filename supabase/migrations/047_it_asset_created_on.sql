-- 047: IT equipment gets a second date. "Issued on" is when the device went to its holder; "Created on" is the day the
-- asset itself was created on the register. For the devices already on the register it starts out equal to the issue date
-- (blank where no issue date is known); every device added from now on gets the day it was captured (South African date),
-- set by the system and not typed in.
alter table fleet_it_assets add column if not exists created_on date;
update fleet_it_assets set created_on = issued_on where created_on is null;
alter table fleet_it_assets alter column created_on set default ((now() at time zone 'Africa/Johannesburg')::date);
comment on column fleet_it_assets.created_on is 'Date the asset was created on the register: = issued_on for assets loaded before 25 Nov 2026, the capture date for new ones';
