-- 043: shared_branch_appraisers (Herman, 30 Oct 2026): who appraises each branch's manager. Appraisals are assigned per branch,
--      so a new branch manager inherits the appraiser. Per-person exceptions go in shared_people.appraiser. Shared with ASI Excellence.
create table if not exists shared_branch_appraisers (
  branch_code       text primary key,
  appraiser_name    text not null,
  appraiser_emp_no  text,
  source            text not null default 'manual',
  updated_at        timestamptz not null default now(),
  updated_by        text
);
alter table shared_branch_appraisers enable row level security;
drop policy if exists shared_branch_appraisers_select on shared_branch_appraisers;
create policy shared_branch_appraisers_select on shared_branch_appraisers for select to authenticated using (true);
grant select on shared_branch_appraisers to authenticated;
revoke insert, update, delete on shared_branch_appraisers from authenticated, anon;   -- service role only
comment on table shared_branch_appraisers is 'Appraiser per branch (branch managers inherit it). Read by all ASI apps; written by scripts with the service role.';

insert into shared_branch_appraisers (branch_code, appraiser_name, source, updated_by) values
  ('KAT', 'Eugene Lamb', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('RCH', 'Eugene Lamb', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('RST', 'Eugene Lamb', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('SEC', 'Eugene Lamb', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('VER', 'Eugene Lamb', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('CAP', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('CPT', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('DBN', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('ESL', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('GAU', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('MDB', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('VEN', 'Pierre van Aswegen', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('DCS', 'Gerrit Barnard', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043'),
  ('000', 'Sega Tiro', 'ASI Excellence exec_cost_centres, 30 Oct 2026', 'migration 043')
on conflict (branch_code) do nothing;

-- fill the appraisers' payroll numbers where the name is unambiguous on the staff list
update shared_branch_appraisers a set appraiser_emp_no = s.emp_no
  from (select full_name, min(emp_no) emp_no, count(distinct emp_no) n from fleet_staff where kind = 'person' and status = 'active' and emp_no is not null group by full_name) s
 where a.appraiser_emp_no is null and s.n = 1 and lower(regexp_replace(s.full_name, '[^A-Za-z]', '', 'g')) = lower(regexp_replace(a.appraiser_name, '[^A-Za-z]', '', 'g'));
select branch_code, appraiser_name, appraiser_emp_no from shared_branch_appraisers order by appraiser_name, branch_code;
