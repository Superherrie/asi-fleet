-- 012: maintenance accrual journal split into Provision and Utilisation (two tabs of one workbook)
alter table fleet_journals drop constraint if exists fleet_journals_source_check;
alter table fleet_journals add constraint fleet_journals_source_check check (source in ('first_auto','avis','insurance','tracking','claims','deductions','fa_maintenance','accrual_provision','accrual_utilisation'));
