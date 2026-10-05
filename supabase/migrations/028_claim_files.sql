-- 028: Documents and photos on insurance claims. Files live in the private storage bucket 'claim-files' under <claim id>/<file>;
-- anyone who can see the claim can open them (through short-lived signed links), claims administrators and the branch's manager can add them.
create table if not exists fleet_insurance_claim_files (
  id               bigserial primary key,
  claim_id         bigint not null references fleet_insurance_claims(id) on delete cascade,
  path             text not null unique,          -- object path in the claim-files bucket
  file_name        text not null,
  mime             text,
  size_bytes       bigint,
  kind             text not null default 'document' check (kind in ('photo','document')),
  note             text,
  uploaded_by      uuid default auth.uid(),
  uploaded_by_name text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists fleet_insurance_claim_files_claim on fleet_insurance_claim_files(claim_id);

create or replace function fleet_can_add_to_claim(p_claim bigint) returns boolean language sql stable security definer set search_path = public as
$$ select fleet_claims_admin() or exists (select 1 from fleet_insurance_claims c where c.id = p_claim and c.branch_id in (select * from fleet_my_branches())) $$;
grant execute on function fleet_can_add_to_claim(bigint) to authenticated;

create or replace function fleet_insurance_claim_file_stamp() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  new.uploaded_by_name := coalesce(nullif(new.uploaded_by_name, ''), fleet_my_name(), '');
  update fleet_insurance_claims set updated_at = now() where id = new.claim_id;
  return new;
end $$;
drop trigger if exists fleet_insurance_claim_file_stamp on fleet_insurance_claim_files;
create trigger fleet_insurance_claim_file_stamp before insert on fleet_insurance_claim_files for each row execute function fleet_insurance_claim_file_stamp();

alter table fleet_insurance_claim_files enable row level security;
drop policy if exists icf_select on fleet_insurance_claim_files;
create policy icf_select on fleet_insurance_claim_files for select using (fleet_can_see_claim(claim_id));
drop policy if exists icf_insert on fleet_insurance_claim_files;
create policy icf_insert on fleet_insurance_claim_files for insert with check (fleet_can_add_to_claim(claim_id));
drop policy if exists icf_delete on fleet_insurance_claim_files;
create policy icf_delete on fleet_insurance_claim_files for delete using (fleet_claims_admin() or uploaded_by = auth.uid());
grant select, insert, delete on fleet_insurance_claim_files to authenticated;
grant usage, select on sequence fleet_insurance_claim_files_id_seq to authenticated;

-- storage: the first folder of the object path is the claim id
drop policy if exists claim_files_read on storage.objects;
create policy claim_files_read on storage.objects for select using (bucket_id = 'claim-files' and (storage.foldername(name))[1] ~ '^\d+$' and fleet_can_see_claim(((storage.foldername(name))[1])::bigint));
drop policy if exists claim_files_write on storage.objects;
create policy claim_files_write on storage.objects for insert with check (bucket_id = 'claim-files' and (storage.foldername(name))[1] ~ '^\d+$' and fleet_can_add_to_claim(((storage.foldername(name))[1])::bigint));
drop policy if exists claim_files_delete on storage.objects;
create policy claim_files_delete on storage.objects for delete using (bucket_id = 'claim-files' and (fleet_claims_admin() or owner = auth.uid()));

-- claims administrators may also remove a claim's progress entries and the claim itself (already covered by icl_write / ice_admin)
