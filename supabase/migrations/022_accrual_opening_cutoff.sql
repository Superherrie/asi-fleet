-- 022: An opening balance is the person's position on its date, so anything dated before it is already inside it.
-- The July 2026 maintenance charges and provisions were being counted twice: once in the 31 July opening balance taken from
-- the 900500 reconciliation, and again as their own transactions. The balance now starts at the opening and only adds what follows.
drop view if exists fleet_v_accrual_balances;
create view fleet_v_accrual_balances as
  with o as (select employee_id, max(txn_date) as opened from fleet_accrual_txns where kind = 'opening' group by employee_id),
  t as (
    select x.* from fleet_accrual_txns x left join o on o.employee_id = x.employee_id
     where o.opened is null or x.kind = 'opening' and x.txn_date = o.opened or x.kind <> 'opening' and x.txn_date >= o.opened
  )
  select e.id as employee_id, e.emp_no, e.full_name, e.branch_id, e.category,
         coalesce(sum(t.amount),0) as balance,
         coalesce(sum(t.amount) filter (where t.kind = 'opening'),0) as opening,
         coalesce(sum(t.amount) filter (where t.kind = 'accrual'),0) as accrued,
         coalesce(-sum(t.amount) filter (where t.kind = 'payout'),0) as paid_out,
         coalesce(sum(t.amount) filter (where t.kind = 'adjustment'),0) as adjustments,
         max(t.txn_date) as last_txn,
         (select o.opened from o where o.employee_id = e.id) as opened
  from fleet_employees e
  left join t on t.employee_id = e.id
  group by e.id;
grant select on fleet_v_accrual_balances to authenticated;
