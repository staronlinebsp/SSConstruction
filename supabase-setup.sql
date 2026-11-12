-- Run once in the SQL Editor of a NEW, dedicated Supabase project.
-- Users must also be explicitly approved in workspace_profiles (see SETUP.md).
create table if not exists public.workspace_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','user'))
);
create table if not exists public.workspace_data (
  key text primary key,
  value jsonb not null,
  revision bigint not null default 1 check (revision >= 1)
);
alter table public.workspace_profiles enable row level security;
alter table public.workspace_data enable row level security;
revoke all on public.workspace_profiles from public, anon, authenticated;
revoke all on public.workspace_data from public, anon, authenticated;
grant select on public.workspace_profiles to authenticated;
grant select on public.workspace_data to authenticated;
drop policy if exists workspace_profile_read_own on public.workspace_profiles;
create policy workspace_profile_read_own on public.workspace_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists workspace_data_read_approved on public.workspace_data;
create policy workspace_data_read_approved on public.workspace_data for select to authenticated
  using (exists (select 1 from public.workspace_profiles p where p.user_id = (select auth.uid())));

-- Only approved users can write. Changes use a per-category compare-and-swap revision
-- so concurrent edits cannot silently overwrite a newer version.
create or replace function public.save_workspace_data(p_key text, p_value jsonb, p_expected_revision bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare new_revision bigint;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_profiles where user_id=auth.uid()) then
    raise exception 'Not approved' using errcode='42501';
  end if;
  if p_key is null or p_key not in ('ss_inv_company_v2','ss_inv_contracts_v2','ss_inv_history_v2','ss_inv_employees_v1','ss_inv_attendance_v1','ss_inv_salary_hist_v1') then
    raise exception 'Unknown data key' using errcode='22023';
  end if;
  if p_value is null or p_expected_revision is null or p_expected_revision < 0 or octet_length(p_value::text) > 5242880 then
    raise exception 'Invalid data' using errcode='22023';
  end if;
  if (p_key in ('ss_inv_company_v2','ss_inv_attendance_v1') and jsonb_typeof(p_value) <> 'object')
     or (p_key in ('ss_inv_contracts_v2','ss_inv_history_v2','ss_inv_employees_v1','ss_inv_salary_hist_v1') and jsonb_typeof(p_value) <> 'array') then
    raise exception 'Invalid data type' using errcode='22023';
  end if;
  if p_expected_revision=0 then
    insert into public.workspace_data(key,value,revision) values (p_key,p_value,1)
    on conflict (key) do nothing returning revision into new_revision;
  else
    update public.workspace_data set value=p_value, revision=revision+1
    where key=p_key and revision=p_expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then
    raise exception 'Data changed in another session' using errcode='40001';
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_workspace_data(text,jsonb,bigint) from public, anon;
grant execute on function public.save_workspace_data(text,jsonb,bigint) to authenticated;
