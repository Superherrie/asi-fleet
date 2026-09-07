-- Control total per import: the debit order / statement amount actually charged, keyed in by the user, so the
-- imported lines can be proven to balance before the journal is generated.
alter table fleet_imports add column if not exists control_amount numeric(14,2);
alter table fleet_imports add column if not exists control_note text;
