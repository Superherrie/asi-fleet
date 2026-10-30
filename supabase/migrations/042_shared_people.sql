-- 042: shared_people (Herman, 30 Oct 2026): one place to state a fact about a person that the payroll does not carry, shared by
--      every ASI app on this Supabase project (Fleet, ASI Excellence, ...). Payroll stays the master for everyone it covers;
--      this table holds contractors, alternative spellings seen in Jotform / supplier sheets, role overrides and reporting lines.
create table if not exists shared_people (
  id                   bigserial primary key,
  full_name            text not null,                 -- canonical; spelled as on payroll where the person is on payroll
  company              text,                          -- payroll company, or the contractor's own company
  emp_no               text,                          -- payroll number; null for people not on payroll
  kind                 text not null default 'employee' check (kind in ('employee','contractor')),
  contractor_company   text,                          -- e.g. 'DCS'
  aliases              text[] not null default '{}',  -- other spellings seen in Jotform, logs, supplier sheets
  branch_code          text,
  role_override        text,                          -- job title to use instead of the payroll position
  role_override_note   text,
  appraiser            text,                          -- who appraises them (filled by ASI Excellence)
  notes                text,
  source               text not null default 'manual',
  updated_at           timestamptz not null default now(),
  updated_by           text
);
create unique index if not exists shared_people_company_emp on shared_people (company, emp_no) where emp_no is not null;
create index if not exists shared_people_aliases on shared_people using gin (aliases);

alter table shared_people enable row level security;
drop policy if exists shared_people_select on shared_people;
create policy shared_people_select on shared_people for select to authenticated using (true);
-- no insert / update / delete policies: only the service role (which bypasses RLS) writes
grant select on shared_people to authenticated;
revoke insert, update, delete on shared_people from authenticated, anon;

comment on table shared_people is 'Facts about people that payroll does not carry: contractors, aliases, role overrides, appraisers. Read by all ASI apps; written by scripts with the service role.';
