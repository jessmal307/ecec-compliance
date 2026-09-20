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

create index if not exists sites_org_id_archived_at_idx
  on public.sites (org_id, archived_at);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  employment_status text not null default 'active',
  start_date date,
  email text,
  phone text,
  notes text,
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint staff_employment_status_check check (
    employment_status in ('active', 'inactive')
  )
);

alter table public.staff
  add column if not exists employment_status text not null default 'active';

alter table public.staff
  add column if not exists start_date date;

alter table public.staff
  add column if not exists email text;

alter table public.staff
  add column if not exists phone text;

alter table public.staff
  add column if not exists notes text;

alter table public.staff
  add column if not exists archived_at timestamptz;

alter table public.staff drop constraint if exists staff_employment_status_check;
alter table public.staff add constraint staff_employment_status_check
  check (employment_status in ('active', 'inactive'));

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
  recheck_interval_months integer,
  recheck_interval_days integer,
  validity_months integer,
  renewal_lead_days integer,
  applies_to text not null default 'staff',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists requirement_types_org_id_idx on public.requirement_types (org_id);

alter table public.requirement_types
  add column if not exists mandatory boolean not null default true;

alter table public.requirement_types
  add column if not exists recheck_interval_months integer;

alter table public.requirement_types
  add column if not exists recheck_interval_days integer;

alter table public.requirement_types
  add column if not exists validity_months integer;

alter table public.requirement_types
  add column if not exists renewal_lead_days integer;

alter table public.requirement_types
  add column if not exists applies_to text not null default 'staff';

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
    where id = rec.loser_id;
  end loop;

  update public.requirement_types as types
  set name = public.normalized_requirement_name(types.name)
  where types.org_id = target_org_id
    and types.name is distinct from public.normalized_requirement_name(types.name);

  insert into public.requirement_types (
    org_id,
    name,
    mandatory,
    recheck_interval_months,
    recheck_interval_days,
    validity_months,
    renewal_lead_days,
    applies_to
  )
  select
    target_org_id,
    seed.name,
    seed.mandatory,
    null,
    seed.recheck_interval_days,
    seed.validity_months,
    seed.renewal_lead_days,
    seed.applies_to
  from (
    values
      ('First Aid', 'staff', 36, 45, null::integer, true),
      ('CPR', 'staff', 12, 30, null::integer, true),
      ('Anaphylaxis Management', 'staff', 36, 45, null::integer, true),
      ('Asthma Management', 'staff', 36, 45, null::integer, true),
      ('WWCC', 'staff', 60, 90, 90, true),
      ('Child Protection Training', 'staff', null::integer, 60, null::integer, true),
      ('Qualification', 'staff', null::integer, null::integer, null::integer, true),
      ('Teacher Accreditation', 'staff', null::integer, null::integer, null::integer, false),
      ('Police Check', 'staff', 36, 30, null::integer, true),
      ('Other', 'staff', null::integer, null::integer, null::integer, false),
      ('Fire Safety', 'site', 12, 45, null::integer, true),
      ('Public Liability Insurance', 'site', 12, 30, null::integer, true),
      ('Workers Compensation', 'site', 12, 30, null::integer, true),
      ('Service Approval', 'site', null::integer, null::integer, null::integer, true),
      ('QIP Review', 'site', 12, 30, null::integer, true),
      ('Fire Equipment Servicing', 'site', null::integer, 30, 180, true),
      ('Evacuation Drills', 'site', null::integer, null::integer, 90, true),
      ('Electrical Test & Tag', 'site', 12, 30, null::integer, true),
      ('Food Safety Registration', 'site', 12, 30, null::integer, false)
  ) as seed(
    name,
    applies_to,
    validity_months,
    renewal_lead_days,
    recheck_interval_days,
    mandatory
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
    recheck_interval_months = null,
    mandatory = seed.mandatory
  from (
    values
      ('First Aid', 'staff', 36, 45, null::integer, true),
      ('CPR', 'staff', 12, 30, null::integer, true),
      ('Anaphylaxis Management', 'staff', 36, 45, null::integer, true),
      ('Asthma Management', 'staff', 36, 45, null::integer, true),
      ('WWCC', 'staff', 60, 90, 90, true),
      ('Child Protection Training', 'staff', null::integer, 60, null::integer, true),
      ('Qualification', 'staff', null::integer, null::integer, null::integer, true),
      ('Teacher Accreditation', 'staff', null::integer, null::integer, null::integer, false),
      ('Police Check', 'staff', 36, 30, null::integer, true),
      ('Other', 'staff', null::integer, null::integer, null::integer, false),
      ('Fire Safety', 'site', 12, 45, null::integer, true),
      ('Public Liability Insurance', 'site', 12, 30, null::integer, true),
      ('Workers Compensation', 'site', 12, 30, null::integer, true),
      ('Service Approval', 'site', null::integer, null::integer, null::integer, true),
      ('QIP Review', 'site', 12, 30, null::integer, true),
      ('Fire Equipment Servicing', 'site', null::integer, 30, 180, true),
      ('Evacuation Drills', 'site', null::integer, null::integer, 90, true),
      ('Electrical Test & Tag', 'site', 12, 30, null::integer, true),
      ('Food Safety Registration', 'site', 12, 30, null::integer, false)
  ) as seed(
    name,
    applies_to,
    validity_months,
    renewal_lead_days,
    recheck_interval_days,
    mandatory
  )
  where types.org_id = target_org_id
    and lower(public.normalized_requirement_name(types.name)) = lower(seed.name);

  update public.compliance_items as items
  set requirement_type_id = kept.id
  from public.requirement_types as obsolete
  join public.requirement_types as kept
    on kept.org_id = obsolete.org_id
   and lower(public.normalized_requirement_name(kept.name)) = 'anaphylaxis management'
  where obsolete.org_id = target_org_id
    and items.requirement_type_id = obsolete.id
    and lower(public.normalized_requirement_name(obsolete.name)) = 'anaphylaxis';

  insert into public.staff_requirement_exclusions (staff_id, requirement_type_id)
  select exclusions.staff_id, kept.id
  from public.staff_requirement_exclusions as exclusions
  join public.requirement_types as obsolete
    on obsolete.id = exclusions.requirement_type_id
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
  join public.requirement_types as kept
    on kept.org_id = obsolete.org_id
   and lower(public.normalized_requirement_name(kept.name)) = 'anaphylaxis management'
  where obsolete.org_id = target_org_id
    and lower(public.normalized_requirement_name(obsolete.name)) = 'anaphylaxis'
  on conflict do nothing;

  delete from public.compliance_items as items
  using public.requirement_types as types
  where items.requirement_type_id = types.id
    and types.org_id = target_org_id
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
    );

  delete from public.requirement_types as types
  where types.org_id = target_org_id
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
  expiry_date date not null,
  reference_number text,
  issued_date date,
  issuer text,
  status text not null default 'current',
  last_verified_date date,
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
  add column if not exists reference_number text,
  add column if not exists issued_date date,
  add column if not exists issuer text,
  add column if not exists status text not null default 'current',
  add column if not exists last_verified_date date,
  add column if not exists document_url text,
  add column if not exists archived_at timestamptz;

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
