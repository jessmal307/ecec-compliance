-- Multi-user membership (ship with one owner per org).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Signup path: AFTER INSERT on public.organizations creates an owner
-- org_members row. That covers handle_new_user() and ensureOrganization().

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  constraint org_members_role_check check (role in ('owner', 'admin', 'director')),
  constraint org_members_org_id_user_id_key unique (org_id, user_id)
);

create index if not exists org_members_user_id_idx on public.org_members (user_id);

alter table public.org_members enable row level security;

-- SECURITY DEFINER so membership lookups do not recurse through org_members RLS.
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
$$;

revoke all on function public.user_org_ids() from public;
grant execute on function public.user_org_ids() to authenticated;

insert into public.org_members (org_id, user_id, role)
select id, owner_id, 'owner'
from public.organizations
where owner_id is not null
on conflict (org_id, user_id) do nothing;

create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.org_members (org_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- organizations: INSERT stays owner_id = auth.uid() (chicken-egg; you are
-- not a member until the row exists). SELECT/UPDATE use membership.
drop policy if exists "Users can view their own organization" on public.organizations;
create policy "Users can view their own organization"
  on public.organizations
  for select
  to authenticated
  using (id in (select public.user_org_ids()));

drop policy if exists "Users can update their own organization" on public.organizations;
create policy "Users can update their own organization"
  on public.organizations
  for update
  to authenticated
  using (id in (select public.user_org_ids()))
  with check (id in (select public.user_org_ids()));

drop policy if exists "Users can select org members in their organization"
  on public.org_members;
create policy "Users can select org members in their organization"
  on public.org_members
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- sites
drop policy if exists "Users can view sites in their organization" on public.sites;
create policy "Users can view sites in their organization"
  on public.sites
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists "Users can insert sites in their organization" on public.sites;
create policy "Users can insert sites in their organization"
  on public.sites
  for insert
  to authenticated
  with check (org_id in (select public.user_org_ids()));

drop policy if exists "Users can delete sites in their organization" on public.sites;
create policy "Users can delete sites in their organization"
  on public.sites
  for delete
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists "Users can update sites in their organization" on public.sites;
create policy "Users can update sites in their organization"
  on public.sites
  for update
  to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- staff
drop policy if exists "Users can view staff in their organization" on public.staff;
create policy "Users can view staff in their organization"
  on public.staff
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists "Users can insert staff in their organization" on public.staff;
create policy "Users can insert staff in their organization"
  on public.staff
  for insert
  to authenticated
  with check (org_id in (select public.user_org_ids()));

drop policy if exists "Users can update staff in their organization" on public.staff;
create policy "Users can update staff in their organization"
  on public.staff
  for update
  to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

drop policy if exists "Users can delete staff in their organization" on public.staff;
create policy "Users can delete staff in their organization"
  on public.staff
  for delete
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- staff_sites (no org_id; membership via staff/site org_id)
drop policy if exists "Users can view staff_sites in their organization" on public.staff_sites;
create policy "Users can view staff_sites in their organization"
  on public.staff_sites
  for select
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can insert staff_sites in their organization" on public.staff_sites;
create policy "Users can insert staff_sites in their organization"
  on public.staff_sites
  for insert
  to authenticated
  with check (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
    and site_id in (
      select id from public.sites
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can delete staff_sites in their organization" on public.staff_sites;
create policy "Users can delete staff_sites in their organization"
  on public.staff_sites
  for delete
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
  );

-- staff_requirement_exclusions
drop policy if exists "Users can view staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions;
create policy "Users can view staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions
  for select
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can insert staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions;
create policy "Users can insert staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions
  for insert
  to authenticated
  with check (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can delete staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions;
create policy "Users can delete staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions
  for delete
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (select public.user_org_ids())
    )
  );

-- site_requirement_exclusions (same owner_id rule; not in the original list)
drop policy if exists "Users can view site requirement exclusions in their organization"
  on public.site_requirement_exclusions;
create policy "Users can view site requirement exclusions in their organization"
  on public.site_requirement_exclusions
  for select
  to authenticated
  using (
    site_id in (
      select id from public.sites
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can insert site requirement exclusions in their organization"
  on public.site_requirement_exclusions;
create policy "Users can insert site requirement exclusions in their organization"
  on public.site_requirement_exclusions
  for insert
  to authenticated
  with check (
    site_id in (
      select id from public.sites
      where org_id in (select public.user_org_ids())
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (select public.user_org_ids())
    )
  );

drop policy if exists "Users can delete site requirement exclusions in their organization"
  on public.site_requirement_exclusions;
create policy "Users can delete site requirement exclusions in their organization"
  on public.site_requirement_exclusions
  for delete
  to authenticated
  using (
    site_id in (
      select id from public.sites
      where org_id in (select public.user_org_ids())
    )
  );

-- requirement_types (select + insert only; no update/delete policies today)
drop policy if exists "Users can view requirement types in their organization"
  on public.requirement_types;
create policy "Users can view requirement types in their organization"
  on public.requirement_types
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists "Users can insert requirement types in their organization"
  on public.requirement_types;
create policy "Users can insert requirement types in their organization"
  on public.requirement_types
  for insert
  to authenticated
  with check (org_id in (select public.user_org_ids()));

-- compliance_items
drop policy if exists "Users can view compliance items in their organization"
  on public.compliance_items;
create policy "Users can view compliance items in their organization"
  on public.compliance_items
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

drop policy if exists "Users can insert compliance items in their organization"
  on public.compliance_items;
create policy "Users can insert compliance items in their organization"
  on public.compliance_items
  for insert
  to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (select public.user_org_ids())
    )
    and (
      (
        staff_id is not null
        and site_id is null
        and staff_id in (
          select id from public.staff
          where org_id in (select public.user_org_ids())
        )
      )
      or (
        site_id is not null
        and staff_id is null
        and site_id in (
          select id from public.sites
          where org_id in (select public.user_org_ids())
        )
      )
    )
  );

drop policy if exists "Users can update compliance items in their organization"
  on public.compliance_items;
create policy "Users can update compliance items in their organization"
  on public.compliance_items
  for update
  to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (select public.user_org_ids())
    )
    and (
      (
        staff_id is not null
        and site_id is null
        and staff_id in (
          select id from public.staff
          where org_id in (select public.user_org_ids())
        )
      )
      or (
        site_id is not null
        and staff_id is null
        and site_id in (
          select id from public.sites
          where org_id in (select public.user_org_ids())
        )
      )
    )
  );

drop policy if exists "Users can delete compliance items in their organization"
  on public.compliance_items;
create policy "Users can delete compliance items in their organization"
  on public.compliance_items
  for delete
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- alerts (no org_id; membership via compliance_items)
drop policy if exists "Users can view alerts in their organization" on public.alerts;
create policy "Users can view alerts in their organization"
  on public.alerts
  for select
  to authenticated
  using (
    compliance_item_id in (
      select id from public.compliance_items
      where org_id in (select public.user_org_ids())
    )
  );

-- storage.objects on compliance-docs
drop policy if exists "Users can view compliance docs in their organization"
  on storage.objects;
create policy "Users can view compliance docs in their organization"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'compliance-docs'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_org_ids() as org_id
    )
  );

drop policy if exists "Users can upload compliance docs in their organization"
  on storage.objects;
create policy "Users can upload compliance docs in their organization"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'compliance-docs'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_org_ids() as org_id
    )
  );

drop policy if exists "Users can delete compliance docs in their organization"
  on storage.objects;
create policy "Users can delete compliance docs in their organization"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'compliance-docs'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_org_ids() as org_id
    )
  );
