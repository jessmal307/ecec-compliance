-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run. If `organizations` already exists without owner_id, the
-- ALTER below adds it before any policy or trigger references the column.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.organizations
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;

alter table public.organizations
  add column if not exists alert_email text;

alter table public.organizations
  add column if not exists plan text not null default 'core';

update public.organizations
set plan = 'core'
where plan is null
   or plan not in ('core', 'plus', 'pro');

alter table public.organizations
  alter column plan set default 'core';

alter table public.organizations
  alter column plan set not null;

alter table public.organizations drop constraint if exists organizations_plan_check;
alter table public.organizations add constraint organizations_plan_check
  check (plan in ('core', 'plus', 'pro'));

create unique index if not exists organizations_owner_id_key
  on public.organizations (owner_id);

alter table public.organizations enable row level security;

drop policy if exists "Users can insert their own organization" on public.organizations;
create policy "Users can insert their own organization"
  on public.organizations
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

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

update public.organizations as org
set alert_email = users.email
from auth.users as users
where org.owner_id = users.id
  and org.alert_email is null
  and users.email is not null;

-- Creates an organization row for every new auth user.
-- This still works when email confirmation is enabled (no session yet).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_name text;
  new_org_id uuid;
begin
  org_name := coalesce(
    nullif(new.raw_user_meta_data->>'organization_name', ''),
    split_part(new.email, '@', 1) || '''s organization'
  );

  insert into public.organizations (name, owner_id, alert_email)
  values (org_name, new.id, new.email)
  on conflict (owner_id) do nothing;

  select id into new_org_id from public.organizations where owner_id = new.id;
  if new_org_id is not null then
    perform public.seed_requirement_types(new_org_id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  service_approval_number text,
  phone text,
  nominated_supervisor text,
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists sites_org_id_idx on public.sites (org_id);

alter table public.sites enable row level security;

drop policy if exists "Users can view sites in their organization" on public.sites;
create policy "Users can view sites in their organization"
  on public.sites
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert sites in their organization" on public.sites;
create policy "Users can insert sites in their organization"
  on public.sites
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can delete sites in their organization" on public.sites;
create policy "Users can delete sites in their organization"
  on public.sites
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can update sites in their organization" on public.sites;
create policy "Users can update sites in their organization"
  on public.sites
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

alter table public.sites
  add column if not exists address text,
  add column if not exists service_approval_number text,
  add column if not exists phone text,
  add column if not exists nominated_supervisor text,
  add column if not exists archived_at timestamptz;

alter table public.sites
  add column if not exists operating_days integer[] not null default '{1,2,3,4,5}';

update public.sites
set operating_days = '{1,2,3,4,5}'
where operating_days is null
   or cardinality(operating_days) = 0;

alter table public.sites
  alter column operating_days set default '{1,2,3,4,5}';

alter table public.sites
  alter column operating_days set not null;

alter table public.sites drop constraint if exists sites_operating_days_check;
alter table public.sites add constraint sites_operating_days_check
  check (operating_days <@ '{1,2,3,4,5,6,7}'::integer[]);

create table if not exists public.site_closures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  closure_date date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint site_closures_site_id_closure_date_key unique (site_id, closure_date)
);

create index if not exists site_closures_site_id_closure_date_idx
  on public.site_closures (site_id, closure_date);

alter table public.site_closures enable row level security;

drop policy if exists "Users can view site closures in their organization"
  on public.site_closures;
create policy "Users can view site closures in their organization"
  on public.site_closures
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert site closures in their organization"
  on public.site_closures;
create policy "Users can insert site closures in their organization"
  on public.site_closures
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
    and site_id in (
      select id from public.sites
      where org_id in (
        select public.user_org_ids()
      )
    )
  );

drop policy if exists "Users can update site closures in their organization"
  on public.site_closures;
create policy "Users can update site closures in their organization"
  on public.site_closures
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can delete site closures in their organization"
  on public.site_closures;
create policy "Users can delete site closures in their organization"
  on public.site_closures
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

create index if not exists sites_org_id_archived_at_idx
  on public.sites (org_id, archived_at);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  employment_status text not null default 'active',
  start_date date,
  end_date date,
  email text,
  phone text,
  notes text,
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint staff_employment_status_check check (
    employment_status in ('active', 'inactive', 'on_leave')
  )
);

alter table public.staff
  add column if not exists employment_status text not null default 'active';

alter table public.staff
  add column if not exists start_date date;

alter table public.staff
  add column if not exists end_date date;

alter table public.staff
  add column if not exists email text;

alter table public.staff
  add column if not exists phone text;

alter table public.staff
  add column if not exists notes text;

alter table public.staff
  add column if not exists archived_at timestamptz;

update public.staff
set employment_status = 'active'
where employment_status is null
   or employment_status not in ('active', 'inactive', 'on_leave');

alter table public.staff drop constraint if exists staff_employment_status_check;
alter table public.staff add constraint staff_employment_status_check
  check (employment_status in ('active', 'inactive', 'on_leave'));

create index if not exists staff_org_id_idx on public.staff (org_id);
create index if not exists staff_org_id_archived_at_idx
  on public.staff (org_id, archived_at);

alter table public.staff enable row level security;

drop policy if exists "Users can view staff in their organization" on public.staff;
create policy "Users can view staff in their organization"
  on public.staff
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert staff in their organization" on public.staff;
create policy "Users can insert staff in their organization"
  on public.staff
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can update staff in their organization" on public.staff;
create policy "Users can update staff in their organization"
  on public.staff
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can delete staff in their organization" on public.staff;
create policy "Users can delete staff in their organization"
  on public.staff
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

create table if not exists public.staff_sites (
  staff_id uuid not null references public.staff (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  primary key (staff_id, site_id)
);

create index if not exists staff_sites_site_id_idx on public.staff_sites (site_id);

alter table public.staff_sites enable row level security;

drop policy if exists "Users can view staff_sites in their organization" on public.staff_sites;
create policy "Users can view staff_sites in their organization"
  on public.staff_sites
  for select
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
    and site_id in (
      select id from public.sites
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
  );

create table if not exists public.staff_requirement_exclusions (
  staff_id uuid not null references public.staff (id) on delete cascade,
  requirement_type_id uuid not null references public.requirement_types (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, requirement_type_id)
);

alter table public.staff_requirement_exclusions
  add column if not exists org_id uuid references public.organizations (id) on delete cascade;

update public.staff_requirement_exclusions as exclusions
set org_id = staff.org_id
from public.staff
where exclusions.staff_id = staff.id
  and exclusions.org_id is null;

create or replace function public.fill_staff_requirement_exclusion_org_id()
returns trigger
language plpgsql
as $$
begin
  select org_id into new.org_id
  from public.staff
  where id = new.staff_id;

  if new.org_id is null then
    raise exception 'staff org_id is required';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_requirement_exclusions_fill_org_id
  on public.staff_requirement_exclusions;
create trigger staff_requirement_exclusions_fill_org_id
  before insert on public.staff_requirement_exclusions
  for each row execute function public.fill_staff_requirement_exclusion_org_id();

create index if not exists staff_requirement_exclusions_requirement_type_id_idx
  on public.staff_requirement_exclusions (requirement_type_id);

alter table public.staff_requirement_exclusions enable row level security;

drop policy if exists "Users can view staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions;
create policy "Users can view staff requirement exclusions in their organization"
  on public.staff_requirement_exclusions
  for select
  to authenticated
  using (
    staff_id in (
      select id from public.staff
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
  );

create table if not exists public.site_requirement_exclusions (
  site_id uuid not null references public.sites (id) on delete cascade,
  requirement_type_id uuid not null references public.requirement_types (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (site_id, requirement_type_id)
);

alter table public.site_requirement_exclusions
  add column if not exists org_id uuid references public.organizations (id) on delete cascade;

update public.site_requirement_exclusions as exclusions
set org_id = sites.org_id
from public.sites
where exclusions.site_id = sites.id
  and exclusions.org_id is null;

create or replace function public.fill_site_requirement_exclusion_org_id()
returns trigger
language plpgsql
as $$
begin
  select org_id into new.org_id
  from public.sites
  where id = new.site_id;

  if new.org_id is null then
    raise exception 'site org_id is required';
  end if;

  return new;
end;
$$;

drop trigger if exists site_requirement_exclusions_fill_org_id
  on public.site_requirement_exclusions;
create trigger site_requirement_exclusions_fill_org_id
  before insert on public.site_requirement_exclusions
  for each row execute function public.fill_site_requirement_exclusion_org_id();

create index if not exists site_requirement_exclusions_requirement_type_id_idx
  on public.site_requirement_exclusions (requirement_type_id);

alter table public.site_requirement_exclusions enable row level security;

drop policy if exists "Users can view site requirement exclusions in their organization"
  on public.site_requirement_exclusions;
create policy "Users can view site requirement exclusions in their organization"
  on public.site_requirement_exclusions
  for select
  to authenticated
  using (
    site_id in (
      select id from public.sites
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (
        select public.user_org_ids()
      )
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
      where org_id in (
        select public.user_org_ids()
      )
    )
  );

create table if not exists public.requirement_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  mandatory boolean not null default true,
  recheck_interval_days integer,
  validity_months integer,
  renewal_lead_days integer,
  applies_to text not null default 'staff',
  perpetual boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists requirement_types_org_id_idx on public.requirement_types (org_id);

alter table public.requirement_types
  add column if not exists mandatory boolean not null default true;

alter table public.requirement_types
  add column if not exists recheck_interval_days integer;

alter table public.requirement_types
  add column if not exists validity_months integer;

alter table public.requirement_types
  add column if not exists renewal_lead_days integer;

alter table public.requirement_types
  add column if not exists applies_to text not null default 'staff';

alter table public.requirement_types
  add column if not exists perpetual boolean not null default false;

alter table public.requirement_types
  drop column if exists recheck_interval_months;

alter table public.requirement_types drop constraint if exists requirement_types_applies_to_check;
alter table public.requirement_types add constraint requirement_types_applies_to_check
  check (applies_to in ('staff', 'site'));

alter table public.requirement_types enable row level security;

drop policy if exists "Users can view requirement types in their organization" on public.requirement_types;
create policy "Users can view requirement types in their organization"
  on public.requirement_types
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert requirement types in their organization" on public.requirement_types;
create policy "Users can insert requirement types in their organization"
  on public.requirement_types
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

alter table public.requirement_types
  add column if not exists archived_at timestamptz;

alter table public.requirement_types
  add column if not exists is_custom boolean not null default false;

alter table public.requirement_types
  add column if not exists customized boolean not null default false;

create index if not exists requirement_types_org_id_archived_at_idx
  on public.requirement_types (org_id, archived_at);

drop policy if exists "Users can update requirement types in their organization" on public.requirement_types;
create policy "Users can update requirement types in their organization"
  on public.requirement_types
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can delete requirement types in their organization" on public.requirement_types;
create policy "Users can delete requirement types in their organization"
  on public.requirement_types
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

create or replace function public.normalized_requirement_name(raw text)
returns text
language sql
immutable
as $$
  select btrim(
    replace(replace(replace(replace(replace(coalesce(raw, ''),
      '&amp;', '&'),
      '&AMP;', '&'),
      '&#38;', '&'),
      '&lt;', '<'),
      '&gt;', '>')
  );
$$;

create or replace function public.cleanup_requirement_types(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  update public.requirement_types as types
  set name = public.normalized_requirement_name(types.name)
  where types.org_id = target_org_id
    and types.name is distinct from public.normalized_requirement_name(types.name)
    and not exists (
      select 1
      from public.requirement_types as other
      where other.org_id = types.org_id
        and other.id <> types.id
        and other.name = public.normalized_requirement_name(types.name)
    );

  for rec in
    with ranked as (
      select
        types.id,
        types.is_custom,
        types.customized,
        lower(public.normalized_requirement_name(types.name)) as name_key,
        row_number() over (
          partition by lower(public.normalized_requirement_name(types.name))
          order by
            (
              select count(*)
              from public.compliance_items as items
              where items.requirement_type_id = types.id
            ) desc,
            types.created_at asc nulls last,
            types.id
        ) as rn
      from public.requirement_types as types
      where types.org_id = target_org_id
    )
    select loser.id as loser_id, winner.id as winner_id
    from ranked as loser
    join ranked as winner
      on winner.name_key = loser.name_key
     and winner.rn = 1
    where loser.rn > 1
      and loser.is_custom = false
      and loser.customized = false
  loop
    update public.compliance_items
    set requirement_type_id = rec.winner_id
    where requirement_type_id = rec.loser_id;

    insert into public.staff_requirement_exclusions (staff_id, requirement_type_id)
    select exclusions.staff_id, rec.winner_id
    from public.staff_requirement_exclusions as exclusions
    where exclusions.requirement_type_id = rec.loser_id
    on conflict do nothing;

    delete from public.staff_requirement_exclusions
    where requirement_type_id = rec.loser_id;

    insert into public.site_requirement_exclusions (site_id, requirement_type_id)
    select exclusions.site_id, rec.winner_id
    from public.site_requirement_exclusions as exclusions
    where exclusions.requirement_type_id = rec.loser_id
    on conflict do nothing;

    delete from public.site_requirement_exclusions
    where requirement_type_id = rec.loser_id;

    delete from public.requirement_types
    where id = rec.loser_id
      and is_custom = false
      and customized = false;
  end loop;

  update public.requirement_types as types
  set name = public.normalized_requirement_name(types.name)
  where types.org_id = target_org_id
    and types.name is distinct from public.normalized_requirement_name(types.name);

  insert into public.requirement_types (
    org_id,
    name,
    mandatory,
    recheck_interval_days,
    validity_months,
    renewal_lead_days,
    applies_to,
    perpetual,
    is_custom,
    customized
  )
  select
    target_org_id,
    seed.name,
    seed.mandatory,
    seed.recheck_interval_days,
    seed.validity_months,
    seed.renewal_lead_days,
    seed.applies_to,
    seed.perpetual,
    false,
    false
  from (
    values
      ('First Aid', 'staff', 36, 45, null::integer, true, false),
      ('CPR', 'staff', 12, 30, null::integer, true, false),
      ('Anaphylaxis Management', 'staff', 36, 45, null::integer, true, false),
      ('Asthma Management', 'staff', 36, 45, null::integer, true, false),
      ('WWCC', 'staff', 60, 90, 90, true, false),
      ('Child Protection Training', 'staff', null::integer, 60, null::integer, true, false),
      ('Qualification', 'staff', null::integer, null::integer, null::integer, true, true),
      ('Teacher Accreditation', 'staff', null::integer, null::integer, null::integer, false, true),
      ('Police Check', 'staff', 36, 30, null::integer, true, false),
      ('Other', 'staff', null::integer, null::integer, null::integer, false, false),
      ('Fire Safety', 'site', 12, 45, null::integer, true, false),
      ('Public Liability Insurance', 'site', 12, 30, null::integer, true, false),
      ('Workers Compensation', 'site', 12, 30, null::integer, true, false),
      ('Service Approval', 'site', null::integer, null::integer, null::integer, true, true),
      ('QIP Review', 'site', 12, 30, null::integer, true, false),
      ('Fire Equipment Servicing', 'site', null::integer, 30, 180, true, false),
      ('Evacuation Drills', 'site', null::integer, null::integer, 90, true, false),
      ('Electrical Test & Tag', 'site', 12, 30, null::integer, true, false),
      ('Food Safety Registration', 'site', 12, 30, null::integer, false, false)
  ) as seed(
    name,
    applies_to,
    validity_months,
    renewal_lead_days,
    recheck_interval_days,
    mandatory,
    perpetual
  )
  where not exists (
    select 1
    from public.requirement_types as types
    where types.org_id = target_org_id
      and lower(public.normalized_requirement_name(types.name)) = lower(seed.name)
  );

  update public.requirement_types as types
  set
    name = seed.name,
    applies_to = seed.applies_to,
    validity_months = seed.validity_months,
    renewal_lead_days = seed.renewal_lead_days,
    recheck_interval_days = seed.recheck_interval_days,
    mandatory = seed.mandatory,
    perpetual = seed.perpetual
  from (
    values
      ('First Aid', 'staff', 36, 45, null::integer, true, false),
      ('CPR', 'staff', 12, 30, null::integer, true, false),
      ('Anaphylaxis Management', 'staff', 36, 45, null::integer, true, false),
      ('Asthma Management', 'staff', 36, 45, null::integer, true, false),
      ('WWCC', 'staff', 60, 90, 90, true, false),
      ('Child Protection Training', 'staff', null::integer, 60, null::integer, true, false),
      ('Qualification', 'staff', null::integer, null::integer, null::integer, true, true),
      ('Teacher Accreditation', 'staff', null::integer, null::integer, null::integer, false, true),
      ('Police Check', 'staff', 36, 30, null::integer, true, false),
      ('Other', 'staff', null::integer, null::integer, null::integer, false, false),
      ('Fire Safety', 'site', 12, 45, null::integer, true, false),
      ('Public Liability Insurance', 'site', 12, 30, null::integer, true, false),
      ('Workers Compensation', 'site', 12, 30, null::integer, true, false),
      ('Service Approval', 'site', null::integer, null::integer, null::integer, true, true),
      ('QIP Review', 'site', 12, 30, null::integer, true, false),
      ('Fire Equipment Servicing', 'site', null::integer, 30, 180, true, false),
      ('Evacuation Drills', 'site', null::integer, null::integer, 90, true, false),
      ('Electrical Test & Tag', 'site', 12, 30, null::integer, true, false),
      ('Food Safety Registration', 'site', 12, 30, null::integer, false, false)
  ) as seed(
    name,
    applies_to,
    validity_months,
    renewal_lead_days,
    recheck_interval_days,
    mandatory,
    perpetual
  )
  where types.org_id = target_org_id
    and types.is_custom = false
    and types.customized = false
    and lower(public.normalized_requirement_name(types.name)) = lower(seed.name);

  update public.compliance_items as items
  set requirement_type_id = kept.id
  from public.requirement_types as obsolete
  join public.requirement_types as kept
    on kept.org_id = obsolete.org_id
   and lower(public.normalized_requirement_name(kept.name)) = 'anaphylaxis management'
  where obsolete.org_id = target_org_id
    and obsolete.is_custom = false
    and obsolete.customized = false
    and items.requirement_type_id = obsolete.id
    and lower(public.normalized_requirement_name(obsolete.name)) = 'anaphylaxis';

  insert into public.staff_requirement_exclusions (staff_id, requirement_type_id)
  select exclusions.staff_id, kept.id
  from public.staff_requirement_exclusions as exclusions
  join public.requirement_types as obsolete
    on obsolete.id = exclusions.requirement_type_id
   and obsolete.is_custom = false
   and obsolete.customized = false
  join public.requirement_types as kept
    on kept.org_id = obsolete.org_id
   and lower(public.normalized_requirement_name(kept.name)) = 'anaphylaxis management'
  where obsolete.org_id = target_org_id
    and lower(public.normalized_requirement_name(obsolete.name)) = 'anaphylaxis'
  on conflict do nothing;

  insert into public.site_requirement_exclusions (site_id, requirement_type_id)
  select exclusions.site_id, kept.id
  from public.site_requirement_exclusions as exclusions
  join public.requirement_types as obsolete
    on obsolete.id = exclusions.requirement_type_id
   and obsolete.is_custom = false
   and obsolete.customized = false
  join public.requirement_types as kept
    on kept.org_id = obsolete.org_id
   and lower(public.normalized_requirement_name(kept.name)) = 'anaphylaxis management'
  where obsolete.org_id = target_org_id
    and lower(public.normalized_requirement_name(obsolete.name)) = 'anaphylaxis'
  on conflict do nothing;

  delete from public.requirement_types as types
  where types.org_id = target_org_id
    and types.is_custom = false
    and types.customized = false
    and lower(public.normalized_requirement_name(types.name)) not in (
      'first aid',
      'cpr',
      'anaphylaxis management',
      'asthma management',
      'wwcc',
      'child protection training',
      'qualification',
      'teacher accreditation',
      'police check',
      'other',
      'fire safety',
      'public liability insurance',
      'workers compensation',
      'service approval',
      'qip review',
      'fire equipment servicing',
      'evacuation drills',
      'electrical test & tag',
      'food safety registration'
    )
    and not exists (
      select 1
      from public.compliance_items as items
      where items.requirement_type_id = types.id
    );
end;
$$;

create or replace function public.seed_requirement_types(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.cleanup_requirement_types(target_org_id);
end;
$$;

do $$
declare
  org_record record;
begin
  for org_record in select id from public.organizations loop
    perform public.seed_requirement_types(org_record.id);
  end loop;
end;
$$;

create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requirement_type_id uuid not null references public.requirement_types (id) on delete restrict,
  label text not null,
  expiry_date date,
  reference_number text,
  issued_date date,
  issuer text,
  status text not null default 'current',
  last_verified_date date,
  working_towards boolean not null default false,
  working_towards_target text,
  staff_id uuid references public.staff (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint compliance_items_owner_check check (
    (staff_id is not null and site_id is null)
    or (staff_id is null and site_id is not null)
  ),
  constraint compliance_items_status_check check (
    status in ('current', 'expired', 'pending', 'revoked')
  )
);

alter table public.compliance_items
  alter column expiry_date drop not null;

alter table public.compliance_items
  add column if not exists reference_number text,
  add column if not exists issued_date date,
  add column if not exists issuer text,
  add column if not exists status text not null default 'current',
  add column if not exists last_verified_date date,
  add column if not exists document_url text,
  add column if not exists archived_at timestamptz,
  add column if not exists working_towards boolean not null default false,
  add column if not exists working_towards_target text;

alter table public.compliance_items drop constraint if exists compliance_items_status_check;
alter table public.compliance_items add constraint compliance_items_status_check
  check (status in ('current', 'expired', 'pending', 'revoked'));

alter table public.compliance_items
  add column if not exists requirement_type_id uuid references public.requirement_types (id) on delete restrict;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'compliance_items'
      and column_name = 'type'
  ) then
    execute $u$
      update public.compliance_items as items
      set requirement_type_id = types.id
      from public.requirement_types as types
      where items.requirement_type_id is null
        and items.org_id = types.org_id
        and items.type = types.name
    $u$;
  end if;
end;
$$;

alter table public.compliance_items drop constraint if exists compliance_items_type_check;
alter table public.compliance_items drop column if exists type;

create index if not exists compliance_items_org_id_idx on public.compliance_items (org_id);
create index if not exists compliance_items_expiry_date_idx on public.compliance_items (expiry_date);
create index if not exists compliance_items_requirement_type_id_idx
  on public.compliance_items (requirement_type_id);
create index if not exists compliance_items_org_id_archived_at_idx
  on public.compliance_items (org_id, archived_at);

alter table public.compliance_items enable row level security;

drop policy if exists "Users can view compliance items in their organization" on public.compliance_items;
create policy "Users can view compliance items in their organization"
  on public.compliance_items
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert compliance items in their organization" on public.compliance_items;
create policy "Users can insert compliance items in their organization"
  on public.compliance_items
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (
        select public.user_org_ids()
      )
    )
    and (
      (
        staff_id is not null
        and site_id is null
        and staff_id in (
          select id from public.staff
          where org_id in (
            select public.user_org_ids()
          )
        )
      )
      or (
        site_id is not null
        and staff_id is null
        and site_id in (
          select id from public.sites
          where org_id in (
            select public.user_org_ids()
          )
        )
      )
    )
  );

drop policy if exists "Users can update compliance items in their organization" on public.compliance_items;
create policy "Users can update compliance items in their organization"
  on public.compliance_items
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
    and requirement_type_id in (
      select id from public.requirement_types
      where org_id in (
        select public.user_org_ids()
      )
    )
    and (
      (
        staff_id is not null
        and site_id is null
        and staff_id in (
          select id from public.staff
          where org_id in (
            select public.user_org_ids()
          )
        )
      )
      or (
        site_id is not null
        and staff_id is null
        and site_id in (
          select id from public.sites
          where org_id in (
            select public.user_org_ids()
          )
        )
      )
    )
  );

drop policy if exists "Users can delete compliance items in their organization" on public.compliance_items;
create policy "Users can delete compliance items in their organization"
  on public.compliance_items
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  compliance_item_id uuid not null references public.compliance_items (id) on delete cascade,
  threshold text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint alerts_threshold_check check (threshold in ('renewal', 'expired', 'recheck'))
);

create index if not exists alerts_compliance_item_id_idx
  on public.alerts (compliance_item_id);

alter table public.alerts drop constraint if exists alerts_threshold_check;
alter table public.alerts drop constraint if exists alerts_compliance_item_id_threshold_key;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'alerts'
      and column_name = 'threshold'
      and data_type = 'integer'
  ) then
    alter table public.alerts
      alter column threshold type text using (
        case threshold
          when 0 then 'expired'
          when 7 then 'renewal'
          when 30 then 'renewal'
          else threshold::text
        end
      );
  end if;
end
$$;

update public.alerts
set threshold = case threshold
  when '0' then 'expired'
  when '7' then 'renewal'
  when '30' then 'renewal'
  else threshold
end
where threshold in ('0', '7', '30');

delete from public.alerts
where threshold not in ('renewal', 'expired', 'recheck');

delete from public.alerts a
using public.alerts b
where a.ctid > b.ctid
  and a.compliance_item_id = b.compliance_item_id
  and a.threshold = b.threshold;

alter table public.alerts
  add column if not exists created_at timestamptz not null default now();

alter table public.alerts
  add column if not exists sent_at timestamptz;

update public.alerts
set sent_at = coalesce(sent_at, created_at, now())
where sent_at is null;

alter table public.alerts
  alter column sent_at set default now();

alter table public.alerts
  alter column sent_at set not null;

alter table public.alerts drop constraint if exists alerts_threshold_check;
alter table public.alerts
  add constraint alerts_threshold_check
  check (threshold in ('renewal', 'expired', 'recheck'));

alter table public.alerts drop constraint if exists alerts_compliance_item_id_fkey;
alter table public.alerts
  add constraint alerts_compliance_item_id_fkey
  foreign key (compliance_item_id)
  references public.compliance_items (id)
  on delete cascade;

create unique index if not exists alerts_item_renewal_expired_once_idx
  on public.alerts (compliance_item_id, threshold)
  where threshold in ('renewal', 'expired');

alter table public.alerts enable row level security;

drop policy if exists "Users can view alerts in their organization" on public.alerts;
create policy "Users can view alerts in their organization"
  on public.alerts
  for select
  to authenticated
  using (
    compliance_item_id in (
      select id from public.compliance_items
      where org_id in (
        select public.user_org_ids()
      )
    )
  );

-- Private certificate files. Object keys: {org_id}/{item_id}/{filename}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-docs',
  'compliance-docs',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  name = excluded.name,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

-- In-app feedback. Members can insert their own org's rows. No SELECT
-- policy: read this in the dashboard (service role), not from the client.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  message text not null,
  page text not null default '',
  created_at timestamptz not null default now(),
  constraint feedback_type_check check (
    type in ('bug', 'improvement', 'feature_request', 'other', 'feature-interest')
  )
);

alter table public.feedback drop constraint if exists feedback_type_check;
alter table public.feedback add constraint feedback_type_check
  check (type in ('bug', 'improvement', 'feature_request', 'other', 'feature-interest'));

create index if not exists feedback_org_id_created_at_idx
  on public.feedback (org_id, created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "Users can insert feedback in their organization"
  on public.feedback;
create policy "Users can insert feedback in their organization"
  on public.feedback
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
    and user_id = auth.uid()
  );

-- Org calendar notes. Compliance expiries and rechecks are derived from
-- compliance_items; this table is only for events people add themselves.
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  event_date date not null,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_org_id_event_date_idx
  on public.calendar_events (org_id, event_date);

alter table public.calendar_events enable row level security;

drop policy if exists "Users can view calendar events in their organization"
  on public.calendar_events;
create policy "Users can view calendar events in their organization"
  on public.calendar_events
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can insert calendar events in their organization"
  on public.calendar_events;
create policy "Users can insert calendar events in their organization"
  on public.calendar_events
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_org_ids()
    )
    and created_by = auth.uid()
  );

drop policy if exists "Users can update calendar events in their organization"
  on public.calendar_events;
create policy "Users can update calendar events in their organization"
  on public.calendar_events
  for update
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_org_ids()
    )
  );

drop policy if exists "Users can delete calendar events in their organization"
  on public.calendar_events;
create policy "Users can delete calendar events in their organization"
  on public.calendar_events
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

-- Append-only audit trail. Writes come only from the trigger below.
-- Logging errors are swallowed so they never block a normal save.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid,
  actor_name text not null default 'System',
  entity text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_check check (action in ('insert', 'update', 'delete'))
);

create index if not exists audit_log_org_id_created_at_idx
  on public.audit_log (org_id, created_at desc);

create index if not exists audit_log_org_id_entity_idx
  on public.audit_log (org_id, entity);

alter table public.audit_log enable row level security;

revoke all on table public.audit_log from public;
revoke all on table public.audit_log from anon;
revoke all on table public.audit_log from authenticated;
grant select on table public.audit_log to authenticated;

drop policy if exists "Users can view audit log in their organization"
  on public.audit_log;
create policy "Users can view audit log in their organization"
  on public.audit_log
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

create or replace function public.audit_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_org_id uuid;
  v_entity_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  begin
    v_actor_id := auth.uid();

    if v_actor_id is not null then
      select coalesce(
        nullif(users.raw_user_meta_data->>'display_name', ''),
        nullif(users.email, ''),
        'System'
      )
      into v_actor_name
      from auth.users as users
      where users.id = v_actor_id;
    end if;

    v_actor_name := coalesce(nullif(v_actor_name, ''), 'System');

    if tg_op = 'DELETE' then
      v_org_id := old.org_id;
      v_entity_id := old.id;
      v_before := to_jsonb(old);
      v_after := null;
    else
      v_org_id := new.org_id;
      v_entity_id := new.id;
      v_after := to_jsonb(new);
      if tg_op = 'UPDATE' then
        v_before := to_jsonb(old);
      end if;
    end if;

    if v_org_id is not null and v_entity_id is not null then
      insert into public.audit_log (
        org_id,
        actor_id,
        actor_name,
        entity,
        entity_id,
        action,
        before,
        after
      ) values (
        v_org_id,
        v_actor_id,
        v_actor_name,
        tg_table_name,
        v_entity_id,
        lower(tg_op),
        v_before,
        v_after
      );
    end if;
  exception
    when others then
      null;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.audit_log_change() from public;

drop trigger if exists audit_staff_change on public.staff;
create trigger audit_staff_change
  after insert or update or delete on public.staff
  for each row execute function public.audit_log_change();

drop trigger if exists audit_sites_change on public.sites;
create trigger audit_sites_change
  after insert or update or delete on public.sites
  for each row execute function public.audit_log_change();

drop trigger if exists audit_requirement_types_change on public.requirement_types;
create trigger audit_requirement_types_change
  after insert or update or delete on public.requirement_types
  for each row execute function public.audit_log_change();

drop trigger if exists audit_compliance_items_change on public.compliance_items;
create trigger audit_compliance_items_change
  after insert or update or delete on public.compliance_items
  for each row execute function public.audit_log_change();

-- Forms engine (Plus). Core orgs cannot read or write these tables.
create or replace function public.org_has_plan(target_org_id uuid, min_plan text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations as org
    where org.id = target_org_id
      and case org.plan
        when 'pro' then 2
        when 'plus' then 1
        else 0
      end
      >=
      case min_plan
        when 'pro' then 2
        when 'plus' then 1
        else 0
      end
  );
$$;

revoke all on function public.org_has_plan(uuid, text) from public;
grant execute on function public.org_has_plan(uuid, text) to authenticated;

create or replace function public.user_plus_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select members.org_id
  from public.org_members as members
  where members.user_id = auth.uid()
    and public.org_has_plan(members.org_id, 'plus')
$$;

revoke all on function public.user_plus_org_ids() from public;
grant execute on function public.user_plus_org_ids() to authenticated;

create table if not exists public.form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  name text not null,
  archetype text not null,
  schema jsonb not null default '{}'::jsonb,
  reg_ref text,
  description text,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint form_templates_archetype_check
    check (archetype in ('simple', 'register', 'checklist', 'risk_matrix'))
);

create index if not exists form_templates_org_id_idx
  on public.form_templates (org_id);

alter table public.form_templates
  add column if not exists cadence text;

alter table public.form_templates
  add column if not exists scope text not null default 'on_demand';

update public.form_templates
set scope = 'on_demand'
where scope is null
   or scope not in ('all_sites', 'all_staff', 'on_demand');

update public.form_templates
set cadence = null
where cadence is not null
  and cadence not in ('once', 'daily', 'weekly', 'monthly', 'quarterly', 'annual');

alter table public.form_templates
  alter column scope set default 'on_demand';

alter table public.form_templates
  alter column scope set not null;

alter table public.form_templates drop constraint if exists form_templates_cadence_check;
alter table public.form_templates add constraint form_templates_cadence_check
  check (cadence is null or cadence in ('once', 'daily', 'weekly', 'monthly', 'quarterly', 'annual'));

alter table public.form_templates drop constraint if exists form_templates_scope_check;
alter table public.form_templates add constraint form_templates_scope_check
  check (scope in ('all_sites', 'all_staff', 'on_demand'));

create table if not exists public.form_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  target_type text not null,
  target_id uuid,
  target_role text,
  cadence text not null,
  next_due date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint form_assignments_target_type_check
    check (target_type in ('site', 'staff', 'role', 'org')),
  constraint form_assignments_cadence_check
    check (cadence in ('once', 'daily', 'weekly', 'monthly', 'quarterly', 'annual'))
);

create index if not exists form_assignments_org_id_template_id_idx
  on public.form_assignments (org_id, template_id);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid references public.form_assignments (id) on delete set null,
  template_id uuid not null references public.form_templates (id) on delete restrict,
  site_id uuid references public.sites (id) on delete set null,
  staff_id uuid references public.staff (id) on delete set null,
  submitted_by uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  signed_off_by uuid references auth.users (id) on delete set null,
  signed_off_at timestamptz,
  evidence jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint form_submissions_status_check
    check (status in ('draft', 'complete'))
);

alter table public.form_submissions
  add column if not exists for_date date;

alter table public.form_submissions drop constraint if exists form_submissions_status_check;
alter table public.form_submissions add constraint form_submissions_status_check
  check (status in ('draft', 'complete', 'missed'));

update public.form_submissions
set for_date = coalesce(
  (submitted_at at time zone 'Australia/Sydney')::date,
  (created_at at time zone 'Australia/Sydney')::date
)
where status = 'complete'
  and for_date is null;

create index if not exists form_submissions_org_id_template_id_idx
  on public.form_submissions (org_id, template_id);

create index if not exists form_submissions_assignment_id_idx
  on public.form_submissions (assignment_id);

alter table public.form_templates enable row level security;
alter table public.form_assignments enable row level security;
alter table public.form_submissions enable row level security;

drop policy if exists "Plus users can view form templates" on public.form_templates;
create policy "Plus users can view form templates"
  on public.form_templates
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
    or (
      org_id is null
      and exists (
        select 1
        from public.user_plus_org_ids()
      )
    )
  );

drop policy if exists "Plus users can insert their own form templates"
  on public.form_templates;
create policy "Plus users can insert their own form templates"
  on public.form_templates
  for insert
  to authenticated
  with check (
    org_id is not null
    and org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can update their own form templates"
  on public.form_templates;
create policy "Plus users can update their own form templates"
  on public.form_templates
  for update
  to authenticated
  using (
    org_id is not null
    and org_id in (
      select public.user_plus_org_ids()
    )
  )
  with check (
    org_id is not null
    and org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can delete their own form templates"
  on public.form_templates;
create policy "Plus users can delete their own form templates"
  on public.form_templates
  for delete
  to authenticated
  using (
    org_id is not null
    and org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can view form assignments"
  on public.form_assignments;
create policy "Plus users can view form assignments"
  on public.form_assignments
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form assignments"
  on public.form_assignments;
create policy "Plus users can insert form assignments"
  on public.form_assignments
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can update form assignments"
  on public.form_assignments;
create policy "Plus users can update form assignments"
  on public.form_assignments
  for update
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can delete form assignments"
  on public.form_assignments;
create policy "Plus users can delete form assignments"
  on public.form_assignments
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can view form submissions"
  on public.form_submissions;
create policy "Plus users can view form submissions"
  on public.form_submissions
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form submissions"
  on public.form_submissions;
create policy "Plus users can insert form submissions"
  on public.form_submissions
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can update form submissions"
  on public.form_submissions;
create policy "Plus users can update form submissions"
  on public.form_submissions
  for update
  to authenticated
  using (
    status = 'draft'
    and org_id in (
      select public.user_plus_org_ids()
    )
  )
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can delete form submissions"
  on public.form_submissions;
create policy "Plus users can delete form submissions"
  on public.form_submissions
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop trigger if exists audit_form_submissions_change on public.form_submissions;
create trigger audit_form_submissions_change
  after insert or update or delete on public.form_submissions
  for each row execute function public.audit_log_change();

create table if not exists public.form_site_exclusions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint form_site_exclusions_site_template_key unique (site_id, template_id)
);

create index if not exists form_site_exclusions_org_id_idx
  on public.form_site_exclusions (org_id);

alter table public.form_site_exclusions enable row level security;

drop policy if exists "Plus users can view form site exclusions"
  on public.form_site_exclusions;
create policy "Plus users can view form site exclusions"
  on public.form_site_exclusions
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form site exclusions"
  on public.form_site_exclusions;
create policy "Plus users can insert form site exclusions"
  on public.form_site_exclusions
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can delete form site exclusions"
  on public.form_site_exclusions;
create policy "Plus users can delete form site exclusions"
  on public.form_site_exclusions
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

-- Private form signatures and evidence. Object keys: {org_id}/{submission_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-uploads',
  'form-uploads',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  name = excluded.name,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Plus users can view form uploads in their organization"
  on storage.objects;
create policy "Plus users can view form uploads in their organization"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'form-uploads'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_plus_org_ids() as org_id
    )
  );

drop policy if exists "Plus users can upload form files in their organization"
  on storage.objects;
create policy "Plus users can upload form files in their organization"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'form-uploads'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_plus_org_ids() as org_id
    )
  );

drop policy if exists "Plus users can delete form uploads in their organization"
  on storage.objects;
create policy "Plus users can delete form uploads in their organization"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'form-uploads'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_plus_org_ids() as org_id
    )
  );

insert into public.form_templates (
  org_id, name, archetype, schema, is_system, cadence, scope
)
select
  null,
  'Daily Risk Checklist',
  'checklist',
  '{
    "archetype":"checklist",
    "items":[
      {"id":"c_gates","label":"Gates and fences secure","type":"checkbox","required":true,"allowsNote":true},
      {"id":"c_hazards","label":"Outdoor area checked for hazards","type":"checkbox","required":true,"allowsNote":true},
      {"id":"c_firstaid","label":"First aid kit stocked and accessible","type":"checkbox","required":true,"allowsNote":true},
      {"id":"c_exits","label":"Emergency exits clear","type":"checkbox","required":true,"allowsNote":true},
      {"id":"c_chemicals","label":"Chemicals stored securely","type":"checkbox","required":true,"allowsNote":true},
      {"id":"c_temp","label":"Room temperature appropriate","type":"checkbox","required":true,"allowsNote":true}
    ],
    "signoff":{"required":true}
  }'::jsonb,
  true,
  'daily',
  'all_sites'
where not exists (
  select 1
  from public.form_templates
  where is_system
    and org_id is null
    and name = 'Daily Risk Checklist'
);

update public.form_templates
set cadence = 'daily',
    scope = 'all_sites'
where is_system
  and org_id is null
  and name = 'Daily Risk Checklist';
