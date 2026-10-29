-- 041: one idle status only (Herman, 29 Oct 2026): a number is either with a person, unassigned (pool: give to the next new starter
--      or cancel at end of term), to cancel, or cancelled. "unclaimed" folds into "unassigned".
update fleet_cell_contracts set status = 'unassigned', updated_at = now() where status = 'unclaimed';
alter table fleet_cell_contracts drop constraint if exists fleet_cell_contracts_status_check;
alter table fleet_cell_contracts add constraint fleet_cell_contracts_status_check check (status in ('active','to_cancel','cancelled','unassigned'));
