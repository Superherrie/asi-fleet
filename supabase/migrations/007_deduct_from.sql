-- Effective-dated deduction: a card with deduct = false becomes deducted (and its owner's maintenance utilised
-- against the accrual) from the usage month in deduct_from onward. Directors switch from September 2026 usage.
alter table fleet_cards add column if not exists deduct_from text;   -- 'YYYY-MM' usage month, null = never
update fleet_cards c set deduct_from = '2026-09'
from fleet_employees e where c.employee_id = e.id and c.holder_type = 'staff' and c.deduct = false and e.emp_no in ('2533','0287','0037');
