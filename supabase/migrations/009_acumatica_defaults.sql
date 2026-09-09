-- Account defaults learned from the accountant's posted journals (Avis July 2026, Maintenance accrual July 2026)
insert into fleet_settings (key, value, description) values
  ('journal_ref', 'HDV', 'Ref. Number on Acumatica journal lines (initials)'),
  ('journal_branch', 'ICS', 'Acumatica Branch on every journal line')
on conflict (key) do update set value = excluded.value where fleet_settings.value = '';
update fleet_settings set value = '904000', description = 'VAT input (Acumatica 904000)' where key = 'vat_input_account' and value = '';
update fleet_settings set value = '906000', description = 'Avis Zeda creditor (Acumatica 906000)' where key = 'avis_creditor_account' and value = '';
update fleet_settings set value = '900500', description = 'Motor vehicles maintenance accrual (Acumatica 900500)' where key = 'maintenance_accrual_account' and value = '';
-- Avis: rentals always to 218100 Lease/Rental - Ops Cabling (per posted journal), repairs recharged by Avis to 216100
update fleet_gl_map set gl_account = '218100', gl_name = 'M/V Exp - Lease/Rental - Ops Cabling' where source = 'avis' and cost_type = 'lease';
insert into fleet_gl_map (source, cost_type, category, gl_account, gl_name)
select 'avis', 'other', c, '216100', 'M/V Exp - Maintenance - Ops Cabling' from unnest(array['Admin','Ops Cabling','Ops Admin','Sales','Exec']) c
on conflict (source, cost_type, category) do update set gl_account = '216100', gl_name = 'M/V Exp - Maintenance - Ops Cabling';
