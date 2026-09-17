-- 017: Branch managers see the vehicles allocated to their branches.
-- Which branches: the cost centres the user holds in the Budget app (budget_assignments, compiler or approver) matched to fleet_branches by code.
-- Fleet admins see every branch. Costs are summed server-side so the line tables stay admin-only.

create or replace function fleet_my_branches()
returns setof bigint language sql stable security definer set search_path = public as
$$
  select b.id from fleet_branches b
  where fleet_is_admin()
     or b.code in (select c.code from budget_assignments a join budget_cost_centres c on c.id = a.cost_centre_id where a.user_id = auth.uid())
$$;
grant execute on function fleet_my_branches() to authenticated;

create or replace function fleet_branch_vehicles(p_from text, p_to text)
returns table (
  vehicle_id bigint, registration text, year int, make text, model text, ownership text, category text,
  branch_id bigint, branch_code text, branch_name text, holders text, tracking_provider text, insured_value numeric,
  active boolean, disposal_type text, disposal_date date,
  fuel numeric, toll numeric, card_fees numeric, maintenance numeric, avis numeric, tracking numeric, insurance numeric, fines numeric, km numeric
) language sql stable security definer set search_path = public as
$$
  with mine as (select * from fleet_my_branches() as id),
  v as (
    select v.*, b.code as bcode, b.name as bname from fleet_vehicles v join fleet_branches b on b.id = v.branch_id
    where v.branch_id in (select id from mine)
  ),
  cards as (
    select c.vehicle_id, string_agg(distinct coalesce(e.full_name, c.fa_driver_name), ', ') as holders
    from fleet_cards c left join fleet_employees e on e.id = c.employee_id
    where c.active and c.vehicle_id is not null group by c.vehicle_id
  ),
  fa as (
    select c.vehicle_id, sum(l.fuel + l.oil_excl) as fuel, sum(l.toll_excl) as toll, sum(l.fees_excl) as fees,
           sum(l.repairs_excl + l.tyres_excl + l.accident_excl + l.maint_excl + l.overhaul_excl + l.other_excl) as card_maint, sum(coalesce(l.kms, 0)) as km
    from fleet_fa_lines l join fleet_cards c on c.id = l.card_id
    where l.period between p_from and p_to and c.vehicle_id is not null group by c.vehicle_id
  ),
  mt as (select vehicle_id, sum(excl) as excl from fleet_maint_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  av as (select vehicle_id, sum(case when transaction_type ilike '%FINE%' then 0 else total end) as total, sum(case when transaction_type ilike '%FINE%' then total else 0 end) as fines
         from fleet_avis_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  tr as (select vehicle_id, sum(amount_excl) as excl from fleet_tracking_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id),
  ins as (select vehicle_id, sum(premium) as premium from fleet_insurance_lines where period between p_from and p_to and vehicle_id is not null group by vehicle_id)
  select v.id, v.registration, v.year, v.make, v.model, v.ownership, v.category, v.branch_id, v.bcode, v.bname, cards.holders, v.tracking_provider, v.insured_value,
         v.active, v.disposal_type, v.disposal_date,
         coalesce(fa.fuel, 0), coalesce(fa.toll, 0), coalesce(fa.fees, 0), coalesce(mt.excl, 0) + coalesce(fa.card_maint, 0), coalesce(av.total, 0), coalesce(tr.excl, 0), coalesce(ins.premium, 0), coalesce(av.fines, 0), coalesce(fa.km, 0)
  from v left join cards on cards.vehicle_id = v.id left join fa on fa.vehicle_id = v.id left join mt on mt.vehicle_id = v.id
         left join av on av.vehicle_id = v.id left join tr on tr.vehicle_id = v.id left join ins on ins.vehicle_id = v.id
  order by v.bcode, v.registration
$$;
grant execute on function fleet_branch_vehicles(text, text) to authenticated;
