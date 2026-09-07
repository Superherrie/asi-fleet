-- Accrual balances split into opening balance, accrued, paid out and adjustments
drop view if exists fleet_v_accrual_balances;
create view fleet_v_accrual_balances as
  select e.id as employee_id, e.emp_no, e.full_name, e.branch_id, e.category,
         coalesce(sum(t.amount),0) as balance,
         coalesce(sum(t.amount) filter (where t.kind = 'opening'),0) as opening,
         coalesce(sum(t.amount) filter (where t.kind = 'accrual'),0) as accrued,
         coalesce(-sum(t.amount) filter (where t.kind = 'payout'),0) as paid_out,
         coalesce(sum(t.amount) filter (where t.kind = 'adjustment'),0) as adjustments,
         max(t.txn_date) as last_txn
  from fleet_employees e
  left join fleet_accrual_txns t on t.employee_id = e.id
  group by e.id;
grant select on fleet_v_accrual_balances to authenticated;
