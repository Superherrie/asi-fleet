-- 013: Avis traffic-fine administration fees (FINESINV, R50 + VAT per redirected fine) → 413000 Fines non Recoverable (chart of accounts), by branch
insert into fleet_gl_map (source, cost_type, category, gl_account, gl_name)
select 'avis', 'fines', c, '413000', 'Fines non Recoverable' from unnest(array['Admin','Ops Cabling','Ops Admin','Sales','Exec']) c
where not exists (select 1 from fleet_gl_map g where g.source = 'avis' and g.cost_type = 'fines' and g.category = c);
