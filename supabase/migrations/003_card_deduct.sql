-- Staff cards that are NOT recovered from salary (directors) stay company cost on the journal
alter table fleet_cards add column if not exists deduct boolean not null default true;
