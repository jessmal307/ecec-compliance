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

-- Backfill runs only when the column is first added, so re-runs never
-- refill an alert_email someone has cleared.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'alert_email'
  ) then
    alter table public.organizations add column alert_email text;

    update public.organizations as org
    set alert_email = users.email
    from auth.users as users
    where org.owner_id = users.id
      and users.email is not null;
  end if;
end
$$;

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
revoke all on function public.user_org_ids() from anon;
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

-- Existing orgs start tracking the day they first get the library (this run's
-- Sydney date). A re-run does not move a date you have backdated. New orgs
-- get the Sydney date they were created; the guard below fills that in.
alter table public.organizations
  add column if not exists audit_tracking_start date;

update public.organizations
set audit_tracking_start = (timezone('Australia/Sydney', now()))::date
where audit_tracking_start is null;

alter table public.organizations
  alter column audit_tracking_start set not null;

-- plan, owner_id, and audit_tracking_start change only via service_role or an
-- admin (SQL editor, SECURITY DEFINER signup trigger). Invoker rights so
-- current_user is the caller.
create or replace function public.guard_organization_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.plan := 'core';
      new.audit_tracking_start := (timezone('Australia/Sydney', coalesce(new.created_at, now())))::date;
    elsif new.plan is distinct from old.plan
       or new.owner_id is distinct from old.owner_id
       or new.audit_tracking_start is distinct from old.audit_tracking_start then
      raise exception 'plan, owner_id, and audit_tracking_start can only be changed by the service role'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.audit_tracking_start is null then
    new.audit_tracking_start := (timezone('Australia/Sydney', coalesce(new.created_at, now())))::date;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_organization_columns on public.organizations;
create trigger guard_organization_columns
  before insert or update on public.organizations
  for each row execute function public.guard_organization_columns();

drop policy if exists "Users can select org members in their organization"
  on public.org_members;
create policy "Users can select org members in their organization"
  on public.org_members
  for select
  to authenticated
  using (org_id in (select public.user_org_ids()));

-- Creates an organization row for every new auth user.
-- This still works when email confirmation is enabled (no session yet).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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
  check (
    operating_days <@ '{1,2,3,4,5,6,7}'::integer[]
    and cardinality(operating_days) > 0
  );

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
set search_path = ''
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
set search_path = ''
as $$
begin
  perform public.cleanup_requirement_types(target_org_id);
end;
$$;

-- Called only by handle_new_user (runs as the function owner) and below.
revoke all on function public.cleanup_requirement_types(uuid) from public;
revoke all on function public.cleanup_requirement_types(uuid) from anon;
revoke all on function public.cleanup_requirement_types(uuid) from authenticated;
revoke all on function public.seed_requirement_types(uuid) from public;
revoke all on function public.seed_requirement_types(uuid) from anon;
revoke all on function public.seed_requirement_types(uuid) from authenticated;

-- Seeds only orgs with no requirement types, so re-runs never touch existing
-- orgs. A default type added to the list above later will NOT reach existing
-- orgs through this block: ship an explicit one-off migration for that.
do $$
declare
  org_record record;
begin
  for org_record in
    select org.id
    from public.organizations as org
    where not exists (
      select 1 from public.requirement_types as types where types.org_id = org.id
    )
  loop
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
  expiry_date date,
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

-- expiry_date = the expiry a renewal/expired alert was sent for (null for
-- recheck). One-time backfill when the column is first added: an alert still
-- matching the certificate's current expiry cycle keeps it (stays suppressed);
-- one whose certificate was renewed in place since stays null (re-arms).
do $$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'alerts'
      and column_name = 'expiry_date'
  ) then
    alter table public.alerts add column expiry_date date;

    update public.alerts as a
    set expiry_date = items.expiry_date
    from public.compliance_items as items
    left join public.requirement_types as types
      on types.id = items.requirement_type_id
    where items.id = a.compliance_item_id
      and a.threshold in ('renewal', 'expired')
      and items.expiry_date is not null
      and not exists (
        select 1
        from public.audit_log as log
        where log.entity = 'compliance_items'
          and log.entity_id = a.compliance_item_id
          and log.action = 'update'
          and log.created_at > a.sent_at
          and (log.before->>'expiry_date') is distinct from (log.after->>'expiry_date')
      )
      and (
        (a.threshold = 'expired' and items.expiry_date <= today)
        or (
          a.threshold = 'renewal'
          and items.expiry_date <= today + coalesce(types.renewal_lead_days, 0)
        )
      );
  end if;
end
$$;

-- recheck alerts repeat by design; renewal/expired are once per expiry cycle.
delete from public.alerts a
using public.alerts b
where a.ctid > b.ctid
  and a.compliance_item_id = b.compliance_item_id
  and a.threshold = b.threshold
  and a.expiry_date is not distinct from b.expiry_date
  and a.expiry_date is not null
  and a.threshold in ('renewal', 'expired');

alter table public.alerts drop constraint if exists alerts_threshold_check;
alter table public.alerts
  add constraint alerts_threshold_check
  check (threshold in ('renewal', 'expired', 'recheck'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.alerts'::regclass
      and conname = 'alerts_compliance_item_id_fkey'
      and contype = 'f'
      and confdeltype = 'c'
  ) then
    alter table public.alerts drop constraint if exists alerts_compliance_item_id_fkey;
    alter table public.alerts
      add constraint alerts_compliance_item_id_fkey
      foreign key (compliance_item_id)
      references public.compliance_items (id)
      on delete cascade;
  end if;
end
$$;

create unique index if not exists alerts_item_threshold_expiry_key
  on public.alerts (compliance_item_id, threshold, expiry_date)
  where threshold in ('renewal', 'expired') and expiry_date is not null;

drop index if exists public.alerts_item_renewal_expired_once_idx;

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

    -- organizations has no org_id column; its own id is the org.
    if tg_op = 'DELETE' then
      v_org_id := coalesce(
        (to_jsonb(old)->>'org_id')::uuid,
        case when tg_table_name = 'organizations' then old.id end
      );
      v_entity_id := old.id;
      v_before := to_jsonb(old);
      v_after := null;
    else
      v_org_id := coalesce(
        (to_jsonb(new)->>'org_id')::uuid,
        case when tg_table_name = 'organizations' then new.id end
      );
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

drop trigger if exists audit_organizations_change on public.organizations;
create trigger audit_organizations_change
  after insert or update or delete on public.organizations
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
      and (
        auth.uid() is null
        or org.id in (
          select members.org_id
          from public.org_members as members
          where members.user_id = auth.uid()
        )
      )
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
revoke all on function public.org_has_plan(uuid, text) from anon;
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
revoke all on function public.user_plus_org_ids() from anon;
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
    check (archetype in ('simple', 'register', 'checklist', 'risk_matrix', 'evidence'))
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
  and cadence not in (
    'once', 'daily', 'weekly', 'monthly', 'quarterly', 'annual',
    'half_yearly', 'annually', 'each_time'
  );

alter table public.form_templates
  alter column scope set default 'on_demand';

alter table public.form_templates
  alter column scope set not null;

alter table public.form_templates drop constraint if exists form_templates_cadence_check;
alter table public.form_templates add constraint form_templates_cadence_check
  check (
    cadence is null
    or cadence in (
      'once', 'daily', 'weekly', 'monthly', 'quarterly', 'annual',
      'half_yearly', 'annually', 'each_time'
    )
  );

alter table public.form_templates drop constraint if exists form_templates_scope_check;
alter table public.form_templates add constraint form_templates_scope_check
  check (scope in ('all_sites', 'all_staff', 'on_demand'));

alter table public.form_templates drop constraint if exists form_templates_archetype_check;
alter table public.form_templates add constraint form_templates_archetype_check
  check (archetype in ('simple', 'register', 'checklist', 'risk_matrix', 'evidence'));

-- Anchor months for half_yearly (two months) and annually (one month).
-- `annual` stays the calendar year and must keep this column null.
alter table public.form_templates
  add column if not exists cadence_months smallint[];

update public.form_templates
set cadence_months = null
where cadence is distinct from 'half_yearly'
  and cadence is distinct from 'annually'
  and cadence_months is not null;

update public.form_templates
set cadence = null,
    cadence_months = null
where cadence in ('half_yearly', 'annually')
  and not (
    (
      cadence = 'half_yearly'
      and cadence_months is not null
      and cardinality(cadence_months) = 2
      and cadence_months[1] between 1 and 12
      and cadence_months[2] between 1 and 12
      and cadence_months[1] <> cadence_months[2]
    )
    or (
      cadence = 'annually'
      and cadence_months is not null
      and cardinality(cadence_months) = 1
      and cadence_months[1] between 1 and 12
    )
  );

alter table public.form_templates drop constraint if exists form_templates_cadence_months_check;
alter table public.form_templates add constraint form_templates_cadence_months_check
  check (
    (
      cadence = 'half_yearly'
      and cadence_months is not null
      and cardinality(cadence_months) = 2
      and cadence_months[1] between 1 and 12
      and cadence_months[2] between 1 and 12
      and cadence_months[1] <> cadence_months[2]
    )
    or (
      cadence = 'annually'
      and cadence_months is not null
      and cardinality(cadence_months) = 1
      and cadence_months[1] between 1 and 12
    )
    or (
      cadence is distinct from 'half_yearly'
      and cadence is distinct from 'annually'
      and cadence_months is null
    )
  );

alter table public.form_templates
  add column if not exists category text;

alter table public.form_templates
  add column if not exists quality_area smallint;

alter table public.form_templates
  add column if not exists nqs_refs text[];

alter table public.form_templates
  add column if not exists completed_by text;

update public.form_templates
set category = null
where category is not null
  and category not in ('audit', 'checklist');

update public.form_templates
set quality_area = null
where quality_area is not null
  and quality_area not between 1 and 7;

update public.form_templates
set nqs_refs = null
where nqs_refs is not null
  and (
    cardinality(nqs_refs) = 0
    or exists (
      select 1
      from unnest(nqs_refs) as ref
      where ref !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    )
  );

update public.form_templates
set completed_by = null
where completed_by is not null
  and btrim(completed_by) = '';

alter table public.form_templates drop constraint if exists form_templates_category_check;
alter table public.form_templates add constraint form_templates_category_check
  check (category is null or category in ('audit', 'checklist'));

alter table public.form_templates drop constraint if exists form_templates_quality_area_check;
alter table public.form_templates add constraint form_templates_quality_area_check
  check (quality_area is null or quality_area between 1 and 7);

alter table public.form_templates drop constraint if exists form_templates_nqs_refs_check;
alter table public.form_templates add constraint form_templates_nqs_refs_check
  check (
    nqs_refs is null
    or nqs_refs::text ~ '^\{([0-9]+\.[0-9]+\.[0-9]+)(,[0-9]+\.[0-9]+\.[0-9]+)*\}$'
  );

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

-- Scheduled complete/missed rows must have for_date. A complete row is left
-- null when its date is already taken by another complete row (unique index).
with candidates as (
  select
    subs.id,
    subs.status,
    subs.site_id,
    subs.template_id,
    (coalesce(subs.submitted_at, subs.created_at) at time zone 'Australia/Sydney')::date
      as local_date,
    coalesce(subs.submitted_at, subs.created_at) as sort_at
  from public.form_submissions as subs
  join public.form_templates as templates
    on templates.id = subs.template_id
  where subs.for_date is null
    and subs.status in ('complete', 'missed')
    and templates.cadence is not null
    and templates.scope = 'all_sites'
),
ranked as (
  select
    candidates.*,
    row_number() over (
      partition by candidates.status, candidates.site_id, candidates.template_id, candidates.local_date
      order by candidates.sort_at desc, candidates.id desc
    ) as rn
  from candidates
)
update public.form_submissions as subs
set for_date = ranked.local_date
from ranked
where subs.id = ranked.id
  and (
    ranked.status = 'missed'
    or (
      ranked.rn = 1
      and not exists (
        select 1
        from public.form_submissions as other
        where other.status = 'complete'
          and other.id <> ranked.id
          and other.site_id is not distinct from ranked.site_id
          and other.template_id = ranked.template_id
          and other.for_date = ranked.local_date
      )
    )
  );

create index if not exists form_submissions_org_id_template_id_idx
  on public.form_submissions (org_id, template_id);

create index if not exists form_submissions_assignment_id_idx
  on public.form_submissions (assignment_id);

update public.form_submissions as older
set for_date = null
from public.form_submissions as kept
where older.status = 'complete'
  and kept.status = 'complete'
  and older.for_date is not null
  and kept.for_date is not null
  and older.site_id is not distinct from kept.site_id
  and older.template_id = kept.template_id
  and older.for_date = kept.for_date
  and older.id <> kept.id
  and (
    coalesce(kept.submitted_at, kept.created_at)
    > coalesce(older.submitted_at, older.created_at)
    or (
      coalesce(kept.submitted_at, kept.created_at)
      = coalesce(older.submitted_at, older.created_at)
      and kept.id > older.id
    )
  );

-- Replace only an older definition that lacked the for_date filter.
do $$
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'form_submissions_site_template_for_date_complete_idx'
      and indexdef not like '%for_date IS NOT NULL%'
  ) then
    drop index public.form_submissions_site_template_for_date_complete_idx;
  end if;
end
$$;

create unique index if not exists form_submissions_site_template_for_date_complete_idx
  on public.form_submissions (site_id, template_id, for_date)
  where status = 'complete' and for_date is not null;

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
    and (
      site_id is null
      or site_id in (
        select site.id from public.sites as site
        where site.org_id = form_submissions.org_id
      )
    )
    and template_id in (
      select template.id from public.form_templates as template
      where template.org_id = form_submissions.org_id
         or template.org_id is null
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
    and (
      site_id is null
      or site_id in (
        select site.id from public.sites as site
        where site.org_id = form_submissions.org_id
      )
    )
    and template_id in (
      select template.id from public.form_templates as template
      where template.org_id = form_submissions.org_id
         or template.org_id is null
    )
  );

drop policy if exists "Plus users can delete form submissions"
  on public.form_submissions;
create policy "Plus users can delete form submissions"
  on public.form_submissions
  for delete
  to authenticated
  using (
    status = 'draft'
    and org_id in (
      select public.user_plus_org_ids()
    )
  );

-- Completion time and signer come from the server, never the client.
-- service_role (site-forms) has no auth.uid(), so its signer stays null.
create or replace function public.stamp_form_submission_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'complete'
     and (tg_op = 'INSERT' or old.status is distinct from 'complete') then
    new.submitted_at := now();
    new.signed_off_at := now();
    new.signed_off_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_form_submission_completion on public.form_submissions;
create trigger stamp_form_submission_completion
  before insert or update on public.form_submissions
  for each row execute function public.stamp_form_submission_completion();

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

-- Per-org on/off and month overrides. cadence_months null uses the template.
create table if not exists public.form_org_schedule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  enabled boolean not null default true,
  cadence_months smallint[],
  created_at timestamptz not null default now(),
  constraint form_org_schedule_org_template_key unique (org_id, template_id)
);

create index if not exists form_org_schedule_org_id_idx
  on public.form_org_schedule (org_id);

update public.form_org_schedule
set cadence_months = null
where cadence_months is not null
  and not (
    (
      cardinality(cadence_months) = 1
      and cadence_months[1] between 1 and 12
    )
    or (
      cardinality(cadence_months) = 2
      and cadence_months[1] between 1 and 12
      and cadence_months[2] between 1 and 12
      and cadence_months[1] <> cadence_months[2]
    )
  );

alter table public.form_org_schedule
  drop constraint if exists form_org_schedule_cadence_months_check;
alter table public.form_org_schedule
  add constraint form_org_schedule_cadence_months_check
  check (
    cadence_months is null
    or (
      cardinality(cadence_months) = 1
      and cadence_months[1] between 1 and 12
    )
    or (
      cardinality(cadence_months) = 2
      and cadence_months[1] between 1 and 12
      and cadence_months[2] between 1 and 12
      and cadence_months[1] <> cadence_months[2]
    )
  );

alter table public.form_org_schedule enable row level security;

drop policy if exists "Plus users can view form org schedule"
  on public.form_org_schedule;
create policy "Plus users can view form org schedule"
  on public.form_org_schedule
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form org schedule"
  on public.form_org_schedule;
create policy "Plus users can insert form org schedule"
  on public.form_org_schedule
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can update form org schedule"
  on public.form_org_schedule;
create policy "Plus users can update form org schedule"
  on public.form_org_schedule
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

drop policy if exists "Plus users can delete form org schedule"
  on public.form_org_schedule;
create policy "Plus users can delete form org schedule"
  on public.form_org_schedule
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop trigger if exists audit_form_org_schedule_change on public.form_org_schedule;
create trigger audit_form_org_schedule_change
  after insert or update or delete on public.form_org_schedule
  for each row execute function public.audit_log_change();

-- Months only override half-yearly (two) and annual (one) templates.
create or replace function public.guard_form_org_schedule_months()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cadence text;
begin
  select templates.cadence
  into v_cadence
  from public.form_templates as templates
  where templates.id = new.template_id;

  if new.cadence_months is null then
    return new;
  end if;

  if v_cadence = 'half_yearly' and cardinality(new.cadence_months) = 2 then
    return new;
  end if;

  if v_cadence = 'annually' and cardinality(new.cadence_months) = 1 then
    return new;
  end if;

  raise exception 'Months can only be set for half-yearly (two months) and annually (one month)'
    using errcode = '23514';
end;
$$;

drop trigger if exists guard_form_org_schedule_months on public.form_org_schedule;
create trigger guard_form_org_schedule_months
  before insert or update on public.form_org_schedule
  for each row execute function public.guard_form_org_schedule_months();

-- New orgs get the daily checklists switched off. Does not change a row
-- the org has already turned on.
create or replace function public.seed_disabled_daily_checklists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.form_org_schedule (org_id, template_id, enabled)
  select new.id, templates.id, false
  from public.form_templates as templates
  where templates.org_id is null
    and templates.is_system
    and templates.category = 'checklist'
    and templates.cadence = 'daily'
  on conflict (org_id, template_id) do nothing;

  return new;
end;
$$;

drop trigger if exists seed_disabled_daily_checklists on public.organizations;
create trigger seed_disabled_daily_checklists
  after insert on public.organizations
  for each row execute function public.seed_disabled_daily_checklists();

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
-- Files of a complete or missed submission are locked. The submission id is
-- segment 2 for in-app paths ({org}/{submission}/...) and segment 3 for floor
-- link paths ({org}/{site}/{submission}/...). No UPDATE policy: no overwrites.
create policy "Plus users can upload form files in their organization"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'form-uploads'
    and split_part(name, '/', 1) in (
      select org_id::text from public.user_plus_org_ids() as org_id
    )
    and not exists (
      select 1
      from public.form_submissions as submissions
      where submissions.org_id::text = split_part(name, '/', 1)
        and submissions.status in ('complete', 'missed')
        and submissions.id::text in (split_part(name, '/', 2), split_part(name, '/', 3))
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
    and not exists (
      select 1
      from public.form_submissions as submissions
      where submissions.org_id::text = split_part(name, '/', 1)
        and submissions.status in ('complete', 'missed')
        and submissions.id::text in (split_part(name, '/', 2), split_part(name, '/', 3))
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

insert into public.form_templates (
  org_id, name, archetype, schema, is_system, cadence, scope
)
select
  null,
  'Incident Record',
  'register',
  '{
    "archetype":"register",
    "fields":[
      {"id":"inc_child_name","label":"Child''s name","type":"text","required":true},
      {"id":"inc_child_age","label":"Child''s age","type":"text","required":true},
      {"id":"inc_date","label":"Date of incident","type":"date","required":true},
      {"id":"inc_time","label":"Time of incident","type":"text","required":true},
      {"id":"inc_location","label":"Location","type":"text","required":true},
      {"id":"inc_type","label":"Type","type":"select","required":true,"options":["Incident","Injury","Trauma","Illness"]},
      {"id":"inc_what","label":"What happened — circumstances, including any object involved","type":"textarea","required":true},
      {"id":"inc_nature","label":"Nature of the injury or illness","type":"textarea","required":true},
      {"id":"inc_first_aid","label":"First aid / action taken","type":"textarea","required":true},
      {"id":"inc_medication","label":"Medication administered (if any)","type":"text"},
      {"id":"inc_services","label":"Medical or emergency services contacted (if any)","type":"text"},
      {"id":"inc_witness","label":"Witnessed by","type":"text"},
      {"id":"inc_parent_name","label":"Parent/guardian notified — name","type":"text","required":true},
      {"id":"inc_parent_date","label":"Parent/guardian notified — date","type":"date","required":true},
      {"id":"inc_parent_time","label":"Parent/guardian notified — time","type":"text","required":true},
      {"id":"inc_parent_how","label":"How they were notified","type":"text"},
      {"id":"inc_recorded_by","label":"Recorded by (name)","type":"text","required":true},
      {"id":"inc_signature","label":"Signature","type":"signature","required":true}
    ]
  }'::jsonb,
  true,
  null,
  'on_demand'
where not exists (
  select 1
  from public.form_templates
  where is_system
    and org_id is null
    and name = 'Incident Record'
);

update public.form_templates
set schema = '{
    "archetype":"register",
    "fields":[
      {"id":"inc_child_name","label":"Child''s name","type":"text","required":true},
      {"id":"inc_child_age","label":"Child''s age","type":"text","required":true},
      {"id":"inc_date","label":"Date of incident","type":"date","required":true},
      {"id":"inc_time","label":"Time of incident","type":"text","required":true},
      {"id":"inc_location","label":"Location","type":"text","required":true},
      {"id":"inc_type","label":"Type","type":"select","required":true,"options":["Incident","Injury","Trauma","Illness"]},
      {"id":"inc_what","label":"What happened — circumstances, including any object involved","type":"textarea","required":true},
      {"id":"inc_nature","label":"Nature of the injury or illness","type":"textarea","required":true},
      {"id":"inc_first_aid","label":"First aid / action taken","type":"textarea","required":true},
      {"id":"inc_medication","label":"Medication administered (if any)","type":"text"},
      {"id":"inc_services","label":"Medical or emergency services contacted (if any)","type":"text"},
      {"id":"inc_witness","label":"Witnessed by","type":"text"},
      {"id":"inc_parent_name","label":"Parent/guardian notified — name","type":"text","required":true},
      {"id":"inc_parent_date","label":"Parent/guardian notified — date","type":"date","required":true},
      {"id":"inc_parent_time","label":"Parent/guardian notified — time","type":"text","required":true},
      {"id":"inc_parent_how","label":"How they were notified","type":"text"},
      {"id":"inc_recorded_by","label":"Recorded by (name)","type":"text","required":true},
      {"id":"inc_signature","label":"Signature","type":"signature","required":true}
    ]
  }'::jsonb,
  cadence = null,
  scope = 'on_demand'
where is_system
  and org_id is null
  and name = 'Incident Record';

insert into public.form_templates (
  org_id, name, archetype, schema, is_system, cadence, scope
)
select
  null,
  'Excursion Risk Assessment',
  'risk_matrix',
  '{
    "archetype":"risk_matrix",
    "likelihood":["Rare","Unlikely","Possible","Likely","Almost certain"],
    "consequence":["Insignificant","Minor","Moderate","Major","Catastrophic"],
    "fields":[
      {"id":"ex_destination","label":"Excursion destination","type":"text","required":true},
      {"id":"ex_route","label":"Proposed route","type":"textarea","required":true},
      {"id":"ex_date","label":"Date of excursion","type":"date","required":true},
      {"id":"ex_times","label":"Departure and return times","type":"text","required":true},
      {"id":"ex_activities","label":"Proposed activities","type":"textarea","required":true},
      {"id":"ex_duration","label":"Expected duration","type":"text","required":true},
      {"id":"ex_transport","label":"Transport arrangements (e.g. walking, bus)","type":"textarea","required":true},
      {"id":"ex_water","label":"Water hazards present?","type":"select","required":true,"options":["None","Present"]},
      {"id":"ex_water_detail","label":"If water hazards present, describe them and controls","type":"textarea"},
      {"id":"ex_items","label":"Items to be taken (first aid kit, medication, mobile phone, etc.)","type":"textarea","required":true},
      {"id":"ex_children","label":"Number of children attending","type":"number","required":true},
      {"id":"ex_educators","label":"Number of educators/adults attending","type":"number","required":true},
      {"id":"ex_ratio","label":"Educator-to-child ratio for this excursion","type":"text","required":true},
      {"id":"ex_skills","label":"Special skills or supervision required","type":"textarea"},
      {"id":"ex_needs","label":"Children with additional or medical needs","type":"textarea"},
      {"id":"ex_comms","label":"Communication arrangements (e.g. mobile phone)","type":"text","required":true}
    ]
  }'::jsonb,
  true,
  null,
  'on_demand'
where not exists (
  select 1
  from public.form_templates
  where is_system
    and org_id is null
    and name = 'Excursion Risk Assessment'
);

update public.form_templates
set schema = '{
    "archetype":"risk_matrix",
    "likelihood":["Rare","Unlikely","Possible","Likely","Almost certain"],
    "consequence":["Insignificant","Minor","Moderate","Major","Catastrophic"],
    "fields":[
      {"id":"ex_destination","label":"Excursion destination","type":"text","required":true},
      {"id":"ex_route","label":"Proposed route","type":"textarea","required":true},
      {"id":"ex_date","label":"Date of excursion","type":"date","required":true},
      {"id":"ex_times","label":"Departure and return times","type":"text","required":true},
      {"id":"ex_activities","label":"Proposed activities","type":"textarea","required":true},
      {"id":"ex_duration","label":"Expected duration","type":"text","required":true},
      {"id":"ex_transport","label":"Transport arrangements (e.g. walking, bus)","type":"textarea","required":true},
      {"id":"ex_water","label":"Water hazards present?","type":"select","required":true,"options":["None","Present"]},
      {"id":"ex_water_detail","label":"If water hazards present, describe them and controls","type":"textarea"},
      {"id":"ex_items","label":"Items to be taken (first aid kit, medication, mobile phone, etc.)","type":"textarea","required":true},
      {"id":"ex_children","label":"Number of children attending","type":"number","required":true},
      {"id":"ex_educators","label":"Number of educators/adults attending","type":"number","required":true},
      {"id":"ex_ratio","label":"Educator-to-child ratio for this excursion","type":"text","required":true},
      {"id":"ex_skills","label":"Special skills or supervision required","type":"textarea"},
      {"id":"ex_needs","label":"Children with additional or medical needs","type":"textarea"},
      {"id":"ex_comms","label":"Communication arrangements (e.g. mobile phone)","type":"text","required":true}
    ]
  }'::jsonb,
  cadence = null,
  scope = 'on_demand'
where is_system
  and org_id is null
  and name = 'Excursion Risk Assessment';

-- Per-site floor tokens. Raw token is never stored — only SHA-256 hex.
create table if not exists public.site_access_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  token_hash text not null,
  label text not null default '',
  status text not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint site_access_tokens_status_check
    check (status in ('active', 'revoked')),
  constraint site_access_tokens_token_hash_key unique (token_hash)
);

create index if not exists site_access_tokens_org_id_idx
  on public.site_access_tokens (org_id);

create index if not exists site_access_tokens_site_active_idx
  on public.site_access_tokens (site_id)
  where status = 'active';

alter table public.site_access_tokens enable row level security;

revoke all on table public.site_access_tokens from public;
revoke all on table public.site_access_tokens from anon;
revoke all on table public.site_access_tokens from authenticated;
grant select, insert, update, delete on table public.site_access_tokens to authenticated;

drop policy if exists "Plus users can view site access tokens"
  on public.site_access_tokens;
create policy "Plus users can view site access tokens"
  on public.site_access_tokens
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert site access tokens"
  on public.site_access_tokens;
create policy "Plus users can insert site access tokens"
  on public.site_access_tokens
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
    and exists (
      select 1
      from public.sites as site
      where site.id = site_id
        and site.org_id = org_id
        and site.archived_at is null
    )
  );

drop policy if exists "Plus users can update site access tokens"
  on public.site_access_tokens;
create policy "Plus users can update site access tokens"
  on public.site_access_tokens
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
    and exists (
      select 1
      from public.sites as site
      where site.id = site_id
        and site.org_id = org_id
    )
  );

drop policy if exists "Plus users can delete site access tokens"
  on public.site_access_tokens;
create policy "Plus users can delete site access tokens"
  on public.site_access_tokens
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop trigger if exists audit_site_access_tokens_change on public.site_access_tokens;
create trigger audit_site_access_tokens_change
  after insert or update or delete on public.site_access_tokens
  for each row execute function public.audit_log_change();

-- Service-role only. Rate limit buckets for site-forms and send-feedback.
-- Rows older than a day are purged by cron (rtc-purge-rate-limits).
create table if not exists public.site_access_rate_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits integer not null default 0
);

alter table public.site_access_rate_limits enable row level security;

revoke all on table public.site_access_rate_limits from public;
revoke all on table public.site_access_rate_limits from anon;
revoke all on table public.site_access_rate_limits from authenticated;

-- Counts one hit and returns the bucket's count in the current window, in one
-- statement: the conflicting row is locked, so concurrent calls never share a count.
create or replace function public.hit_rate_limit(p_bucket text, p_window_seconds integer)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.site_access_rate_limits as limits (bucket_key, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket_key) do update
  set
    window_start = case
      when limits.window_start <= now() - make_interval(secs => p_window_seconds) then now()
      else limits.window_start
    end,
    hits = case
      when limits.window_start <= now() - make_interval(secs => p_window_seconds) then 1
      else limits.hits + 1
    end
  returning hits;
$$;

revoke all on function public.hit_rate_limit(text, integer) from public;
revoke all on function public.hit_rate_limit(text, integer) from anon;
revoke all on function public.hit_rate_limit(text, integer) from authenticated;
grant execute on function public.hit_rate_limit(text, integer) to service_role;

-- Monthly compliance snapshots, written by send-monthly-compliance-report.
-- site_id null = whole-org row. Captured for every org regardless of plan.
create table if not exists public.compliance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  period date not null,
  compliant integer not null default 0,
  expiring integer not null default 0,
  expired integer not null default 0,
  missing integer not null default 0,
  recheck_due integer not null default 0,
  total_required integer not null default 0,
  percent integer,
  created_at timestamptz not null default now()
);

alter table public.compliance_snapshots drop constraint if exists compliance_snapshots_counts_check;
alter table public.compliance_snapshots add constraint compliance_snapshots_counts_check
  check (
    compliant >= 0
    and expiring >= 0
    and expired >= 0
    and missing >= 0
    and recheck_due >= 0
    and total_required >= 0
  );

alter table public.compliance_snapshots drop constraint if exists compliance_snapshots_percent_check;
alter table public.compliance_snapshots add constraint compliance_snapshots_percent_check
  check (percent is null or percent between 0 and 100);

alter table public.compliance_snapshots drop constraint if exists compliance_snapshots_period_check;
alter table public.compliance_snapshots add constraint compliance_snapshots_period_check
  check (extract(day from period) = 1);

create unique index if not exists compliance_snapshots_org_period_key
  on public.compliance_snapshots (org_id, period)
  where site_id is null;

create unique index if not exists compliance_snapshots_org_site_period_key
  on public.compliance_snapshots (org_id, site_id, period)
  where site_id is not null;

alter table public.compliance_snapshots enable row level security;

revoke all on table public.compliance_snapshots from public;
revoke all on table public.compliance_snapshots from anon;
revoke all on table public.compliance_snapshots from authenticated;
grant select on table public.compliance_snapshots to authenticated;

drop policy if exists "Users can view compliance snapshots in their organization"
  on public.compliance_snapshots;
create policy "Users can view compliance snapshots in their organization"
  on public.compliance_snapshots
  for select
  to authenticated
  using (
    org_id in (
      select public.user_org_ids()
    )
  );

-- One org's rows for one month, in one transaction. Re-runs overwrite.
-- p_rows: [{ site_id, compliant, expiring, expired, missing, recheck_due, total_required, percent }]
create or replace function public.upsert_compliance_snapshots(
  p_org_id uuid,
  p_period date,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_count integer := 0;
  site_count integer := 0;
begin
  insert into public.compliance_snapshots as snap (
    org_id, site_id, period,
    compliant, expiring, expired, missing, recheck_due, total_required, percent
  )
  select
    p_org_id, null, p_period,
    r.compliant, r.expiring, r.expired, r.missing,
    r.recheck_due, r.total_required, r.percent
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r (
    site_id uuid,
    compliant integer,
    expiring integer,
    expired integer,
    missing integer,
    recheck_due integer,
    total_required integer,
    percent integer
  )
  where r.site_id is null
  on conflict (org_id, period) where site_id is null
  do update set
    compliant = excluded.compliant,
    expiring = excluded.expiring,
    expired = excluded.expired,
    missing = excluded.missing,
    recheck_due = excluded.recheck_due,
    total_required = excluded.total_required,
    percent = excluded.percent,
    created_at = now();
  get diagnostics org_count = row_count;

  insert into public.compliance_snapshots as snap (
    org_id, site_id, period,
    compliant, expiring, expired, missing, recheck_due, total_required, percent
  )
  select
    p_org_id, r.site_id, p_period,
    r.compliant, r.expiring, r.expired, r.missing,
    r.recheck_due, r.total_required, r.percent
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r (
    site_id uuid,
    compliant integer,
    expiring integer,
    expired integer,
    missing integer,
    recheck_due integer,
    total_required integer,
    percent integer
  )
  join public.sites as sites
    on sites.id = r.site_id
   and sites.org_id = p_org_id
  where r.site_id is not null
  on conflict (org_id, site_id, period) where site_id is not null
  do update set
    compliant = excluded.compliant,
    expiring = excluded.expiring,
    expired = excluded.expired,
    missing = excluded.missing,
    recheck_due = excluded.recheck_due,
    total_required = excluded.total_required,
    percent = excluded.percent,
    created_at = now();
  get diagnostics site_count = row_count;

  return org_count + site_count;
end;
$$;

revoke all on function public.upsert_compliance_snapshots(uuid, date, jsonb) from public;
revoke all on function public.upsert_compliance_snapshots(uuid, date, jsonb) from anon;
revoke all on function public.upsert_compliance_snapshots(uuid, date, jsonb) from authenticated;
grant execute on function public.upsert_compliance_snapshots(uuid, date, jsonb) to service_role;

-- Service-role only. One claim per org per email per period, taken before
-- sending. Deleting a claim (failed send, or stuck in 'sending') cascades to
-- the alert rows recorded with it, so the next run re-sends them.
create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  period date not null,
  status text not null default 'sending',
  item_count integer,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_sends_org_kind_period_key unique (org_id, kind, period)
);

alter table public.email_sends drop constraint if exists email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check
  check (kind in ('alert_digest', 'monthly_report'));

alter table public.email_sends drop constraint if exists email_sends_status_check;
alter table public.email_sends add constraint email_sends_status_check
  check (status in ('sending', 'sent'));

create index if not exists email_sends_kind_status_created_at_idx
  on public.email_sends (kind, status, created_at);

alter table public.email_sends enable row level security;

revoke all on table public.email_sends from public;
revoke all on table public.email_sends from anon;
revoke all on table public.email_sends from authenticated;

alter table public.alerts
  add column if not exists email_send_id uuid
  references public.email_sends (id) on delete cascade;

create index if not exists alerts_email_send_id_idx
  on public.alerts (email_send_id);

-- Floor link staff signing. The staff member who signed a floor-link
-- submission with their PIN. Only site-forms (service role) sets it.
alter table public.form_submissions
  add column if not exists signed_by_staff_id uuid;

alter table public.form_submissions
  drop constraint if exists form_submissions_signed_by_staff_id_fkey;
alter table public.form_submissions
  add constraint form_submissions_signed_by_staff_id_fkey
  foreign key (signed_by_staff_id) references public.staff (id) on delete restrict;

create index if not exists form_submissions_signed_by_staff_id_idx
  on public.form_submissions (signed_by_staff_id)
  where signed_by_staff_id is not null;

-- App users can never set or change the signer; service role passes through.
create or replace function public.guard_form_submission_signer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.signed_by_staff_id := null;
    else
      new.signed_by_staff_id := old.signed_by_staff_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_form_submission_signer on public.form_submissions;
create trigger guard_form_submission_signer
  before insert or update on public.form_submissions
  for each row execute function public.guard_form_submission_signer();

-- Service-role only. PBKDF2-SHA256 of the 4-digit PIN, hashed in the browser.
-- No audit trigger: set_staff_pin logs the event without the hash.
create table if not exists public.staff_pins (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  salt text not null,
  pin_hash text not null,
  iterations integer not null,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);

alter table public.staff_pins drop constraint if exists staff_pins_salt_check;
alter table public.staff_pins add constraint staff_pins_salt_check
  check (salt ~ '^[0-9a-f]{32}$');

alter table public.staff_pins drop constraint if exists staff_pins_pin_hash_check;
alter table public.staff_pins add constraint staff_pins_pin_hash_check
  check (pin_hash ~ '^[0-9a-f]{64}$');

-- The upper bound caps site-forms CPU per PIN check.
alter table public.staff_pins drop constraint if exists staff_pins_iterations_check;
alter table public.staff_pins add constraint staff_pins_iterations_check
  check (iterations between 100000 and 1000000);

create index if not exists staff_pins_org_id_idx on public.staff_pins (org_id);

alter table public.staff_pins enable row level security;

revoke all on table public.staff_pins from public;
revoke all on table public.staff_pins from anon;
revoke all on table public.staff_pins from authenticated;

-- Service-role only. Raw session token is never stored — only SHA-256 hex.
create table if not exists public.floor_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  site_access_token_id uuid not null
    references public.site_access_tokens (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint floor_sessions_token_hash_key unique (token_hash)
);

alter table public.floor_sessions drop constraint if exists floor_sessions_token_hash_check;
alter table public.floor_sessions add constraint floor_sessions_token_hash_check
  check (token_hash ~ '^[0-9a-f]{64}$');

create index if not exists floor_sessions_staff_id_idx on public.floor_sessions (staff_id);
create index if not exists floor_sessions_expires_at_idx on public.floor_sessions (expires_at);

alter table public.floor_sessions enable row level security;

revoke all on table public.floor_sessions from public;
revoke all on table public.floor_sessions from anon;
revoke all on table public.floor_sessions from authenticated;

-- Plus members of the staff member's org only. Ends that person's floor
-- sessions and writes an audit row that never contains the hash.
create or replace function public.set_staff_pin(
  p_staff_id uuid,
  p_salt text,
  p_hash text,
  p_iterations integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_existed boolean;
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_set_at timestamptz := now();
begin
  select staff.org_id
  into v_org_id
  from public.staff as staff
  where staff.id = p_staff_id
    and staff.org_id in (select public.user_plus_org_ids());

  if v_org_id is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if p_salt is null or p_salt !~ '^[0-9a-f]{32}$'
     or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or p_iterations is null or p_iterations not between 100000 and 1000000 then
    raise exception 'Invalid PIN hash.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.staff_pins as pins where pins.staff_id = p_staff_id
  )
  into v_existed;

  insert into public.staff_pins as pins (
    staff_id, org_id, salt, pin_hash, iterations, set_by, set_at
  ) values (
    p_staff_id, v_org_id, p_salt, p_hash, p_iterations, v_actor_id, v_set_at
  )
  on conflict (staff_id) do update
  set
    org_id = excluded.org_id,
    salt = excluded.salt,
    pin_hash = excluded.pin_hash,
    iterations = excluded.iterations,
    set_by = excluded.set_by,
    set_at = excluded.set_at;

  delete from public.floor_sessions as sessions
  where sessions.staff_id = p_staff_id;

  select coalesce(
    nullif(users.raw_user_meta_data->>'display_name', ''),
    nullif(users.email, ''),
    'System'
  )
  into v_actor_name
  from auth.users as users
  where users.id = v_actor_id;

  insert into public.audit_log (
    org_id, actor_id, actor_name, entity, entity_id, action, before, after
  ) values (
    v_org_id,
    v_actor_id,
    coalesce(nullif(v_actor_name, ''), 'System'),
    'staff_pins',
    p_staff_id,
    case when v_existed then 'update' else 'insert' end,
    null,
    jsonb_build_object('pin', case when v_existed then 'reset' else 'set' end)
  );

  return v_set_at;
end;
$$;

revoke all on function public.set_staff_pin(uuid, text, text, integer) from public;
revoke all on function public.set_staff_pin(uuid, text, text, integer) from anon;
grant execute on function public.set_staff_pin(uuid, text, text, integer) to authenticated;

-- When the PIN was last set, or null (no PIN, or not a Plus member of the org).
create or replace function public.staff_pin_status(p_staff_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pins.set_at
  from public.staff_pins as pins
  join public.staff as staff
    on staff.id = pins.staff_id
  where pins.staff_id = p_staff_id
    and staff.org_id in (select public.user_plus_org_ids())
$$;

revoke all on function public.staff_pin_status(uuid) from public;
revoke all on function public.staff_pin_status(uuid) from anon;
grant execute on function public.staff_pin_status(uuid) to authenticated;

-- Due-by times (Sydney local) for daily scheduled forms.
-- form_templates.default_due_by is the product default; orgs can't edit
-- shared templates, so their own times live in form_site_due_times.
alter table public.form_templates
  add column if not exists default_due_by time;

update public.form_templates
set default_due_by = null
where default_due_by is not null
  and (
    cadence is distinct from 'daily'
    or scope is distinct from 'all_sites'
    or extract(second from default_due_by) <> 0
  );

update public.form_templates
set default_due_by = '09:00'
where is_system
  and org_id is null
  and name = 'Daily Risk Checklist'
  and default_due_by is null;

alter table public.form_templates
  drop constraint if exists form_templates_default_due_by_check;
alter table public.form_templates
  add constraint form_templates_default_due_by_check
  check (
    default_due_by is null
    or (
      cadence = 'daily'
      and scope = 'all_sites'
      and extract(second from default_due_by) = 0
    )
  );

-- site_id null = the org's time for all its sites. A site row wins over it.
create table if not exists public.form_site_due_times (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  due_by time not null,
  created_at timestamptz not null default now()
);

alter table public.form_site_due_times
  drop constraint if exists form_site_due_times_org_site_template_key;
alter table public.form_site_due_times
  add constraint form_site_due_times_org_site_template_key
  unique nulls not distinct (org_id, site_id, template_id);

alter table public.form_site_due_times
  drop constraint if exists form_site_due_times_due_by_check;
alter table public.form_site_due_times
  add constraint form_site_due_times_due_by_check
  check (extract(second from due_by) = 0);

create index if not exists form_site_due_times_template_id_idx
  on public.form_site_due_times (template_id);
create index if not exists form_site_due_times_site_id_idx
  on public.form_site_due_times (site_id);

alter table public.form_site_due_times enable row level security;

drop policy if exists "Plus users can view form due times"
  on public.form_site_due_times;
create policy "Plus users can view form due times"
  on public.form_site_due_times
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form due times"
  on public.form_site_due_times;
create policy "Plus users can insert form due times"
  on public.form_site_due_times
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
    and (
      site_id is null
      or site_id in (
        select site.id from public.sites as site
        where site.org_id = form_site_due_times.org_id
      )
    )
    and template_id in (
      select template.id from public.form_templates as template
      where (template.org_id = form_site_due_times.org_id or template.org_id is null)
        and template.cadence = 'daily'
        and template.scope = 'all_sites'
    )
  );

drop policy if exists "Plus users can update form due times"
  on public.form_site_due_times;
create policy "Plus users can update form due times"
  on public.form_site_due_times
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
    and (
      site_id is null
      or site_id in (
        select site.id from public.sites as site
        where site.org_id = form_site_due_times.org_id
      )
    )
    and template_id in (
      select template.id from public.form_templates as template
      where (template.org_id = form_site_due_times.org_id or template.org_id is null)
        and template.cadence = 'daily'
        and template.scope = 'all_sites'
    )
  );

drop policy if exists "Plus users can delete form due times"
  on public.form_site_due_times;
create policy "Plus users can delete form due times"
  on public.form_site_due_times
  for delete
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop trigger if exists audit_form_site_due_times_change on public.form_site_due_times;
create trigger audit_form_site_due_times_change
  after insert or update or delete on public.form_site_due_times
  for each row execute function public.audit_log_change();

-- The due-by a submission was held to, frozen when it's completed, so later
-- changes to due-by times never change whether an old record was late.
alter table public.form_submissions
  add column if not exists due_by time;

-- Site time, else the org's all-sites time, else the template default.
-- Null for anything but a daily scheduled template the org can use.
-- App users only get answers for their own Plus orgs; service role has no uid.
create or replace function public.form_effective_due_by(
  p_org_id uuid,
  p_site_id uuid,
  p_template_id uuid
)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select times.due_by
      from public.form_site_due_times as times
      where times.org_id = p_org_id
        and times.site_id = p_site_id
        and times.template_id = p_template_id
    ),
    (
      select times.due_by
      from public.form_site_due_times as times
      where times.org_id = p_org_id
        and times.site_id is null
        and times.template_id = p_template_id
    ),
    template.default_due_by
  )
  from public.form_templates as template
  where template.id = p_template_id
    and template.cadence = 'daily'
    and template.scope = 'all_sites'
    and (template.org_id is null or template.org_id = p_org_id)
    and (
      auth.uid() is null
      or p_org_id in (select public.user_plus_org_ids())
    )
$$;

revoke all on function public.form_effective_due_by(uuid, uuid, uuid) from public;
revoke all on function public.form_effective_due_by(uuid, uuid, uuid) from anon;
grant execute on function public.form_effective_due_by(uuid, uuid, uuid) to authenticated;
grant execute on function public.form_effective_due_by(uuid, uuid, uuid) to service_role;

-- Same as the earlier definition, plus due_by. A failed lookup leaves due_by
-- null (the date-only late rule) rather than blocking the completion.
create or replace function public.stamp_form_submission_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'complete'
     and (tg_op = 'INSERT' or old.status is distinct from 'complete') then
    new.submitted_at := now();
    new.signed_off_at := now();
    new.signed_off_by := auth.uid();
    new.due_by := null;
    if new.for_date is not null then
      begin
        new.due_by := public.form_effective_due_by(
          new.org_id,
          new.site_id,
          new.template_id
        );
      exception
        when others then
          new.due_by := null;
      end;
    end if;
  elsif tg_op = 'UPDATE' then
    new.due_by := old.due_by;
  else
    new.due_by := null;
  end if;
  return new;
end;
$$;

-- Same-day centre alerts. sites.alert_email is the first recipient; the
-- organisation alert email is the fallback. Existing site audit trigger
-- records changes. form_overdue_alerts is the claim-before-send ledger
-- (one row per site + template + day).
alter table public.sites
  add column if not exists alert_email text;

create table if not exists public.form_overdue_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  for_date date not null,
  status text not null default 'sending',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.form_overdue_alerts
  drop constraint if exists form_overdue_alerts_site_template_date_key;
alter table public.form_overdue_alerts
  add constraint form_overdue_alerts_site_template_date_key
  unique (site_id, template_id, for_date);

alter table public.form_overdue_alerts drop constraint if exists form_overdue_alerts_status_check;
alter table public.form_overdue_alerts add constraint form_overdue_alerts_status_check
  check (status in ('sending', 'sent'));

create index if not exists form_overdue_alerts_status_created_at_idx
  on public.form_overdue_alerts (status, created_at);

alter table public.form_overdue_alerts enable row level security;

revoke all on table public.form_overdue_alerts from public;
revoke all on table public.form_overdue_alerts from anon;
revoke all on table public.form_overdue_alerts from authenticated;

-- Head-office digest: each missed form (site + template + period) is mailed once.
-- Service role only. Claim status 'sending' before the digest send; 'sent' after.
create table if not exists public.form_digest_misses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  template_id uuid not null references public.form_templates (id) on delete cascade,
  for_date date not null,
  status text not null default 'sending',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.form_digest_misses
  drop constraint if exists form_digest_misses_site_template_date_key;
alter table public.form_digest_misses
  add constraint form_digest_misses_site_template_date_key
  unique (site_id, template_id, for_date);

alter table public.form_digest_misses drop constraint if exists form_digest_misses_status_check;
alter table public.form_digest_misses add constraint form_digest_misses_status_check
  check (status in ('sending', 'sent'));

create index if not exists form_digest_misses_status_created_at_idx
  on public.form_digest_misses (status, created_at);

alter table public.form_digest_misses enable row level security;

revoke all on table public.form_digest_misses from public;
revoke all on table public.form_digest_misses from anon;
revoke all on table public.form_digest_misses from authenticated;

revoke all on function public.guard_form_org_schedule_months() from public;
revoke all on function public.guard_form_org_schedule_months() from anon;
revoke all on function public.seed_disabled_daily_checklists() from public;
revoke all on function public.seed_disabled_daily_checklists() from anon;

-- Audit library. Idempotent by system name. Refreshes the system row only;
-- form_org_schedule (on/off and month overrides) is insert-if-missing.
do $$
declare
  seed record;
  library_description text := 'Adapt this to your service; last reviewed 26 Sep 2026';
begin
  for seed in
    select *
    from (
      values
        ('Assessment and Planning Cycle Audit', 'audit', 'evidence', 1::smallint, array['1.3.1']::text[], null::text, 'monthly', null::smallint[]),
        ('Family Newsletter', 'audit', 'evidence', 6::smallint, array['6.1.1']::text[], null::text, 'monthly', null::smallint[]),
        ('Monthly Team Meeting', 'audit', 'evidence', 4::smallint, array['4.2.1']::text[], null::text, 'monthly', null::smallint[]),
        ('Monthly Policy Review', 'audit', 'evidence', 7::smallint, array['7.1.2']::text[], null::text, 'monthly', null::smallint[]),
        ('Quality Improvement Plan Review', 'audit', 'evidence', 7::smallint, array['7.1.2', '7.2.1']::text[], null::text, 'monthly', null::smallint[]),
        ('Management Programming Audit', 'audit', 'evidence', 1::smallint, array['1.3.2']::text[], null::text, 'half_yearly', array[4, 10]::smallint[]),
        ('Supervision Audit', 'audit', 'evidence', 2::smallint, array['2.2.1']::text[], null::text, 'half_yearly', array[4, 10]::smallint[]),
        ('Behaviour Guidance Audit', 'audit', 'evidence', 5::smallint, array['5.2.2']::text[], null::text, 'half_yearly', array[4, 10]::smallint[]),
        ('Inclusive Audit', 'audit', 'evidence', 5::smallint, array['1.1.2', '5.1.1', '5.1.2']::text[], null::text, 'half_yearly', array[4, 10]::smallint[]),
        ('Emergency Management Audit', 'audit', 'evidence', 2::smallint, array['2.2.2']::text[], null::text, 'half_yearly', array[5, 11]::smallint[]),
        ('Poison Safety Audit', 'audit', 'evidence', 2::smallint, array['2.2.1']::text[], null::text, 'half_yearly', array[5, 11]::smallint[]),
        ('Outdoor Environment and Playground Safety Audit', 'audit', 'evidence', 3::smallint, array['3.1.2']::text[], null::text, 'half_yearly', array[5, 11]::smallint[]),
        ('Communication Audit', 'audit', 'evidence', 5::smallint, array['5.1.1']::text[], null::text, 'half_yearly', array[5, 11]::smallint[]),
        ('Medication Audit', 'audit', 'evidence', 2::smallint, array['2.1.2', '2.2.1']::text[], null::text, 'half_yearly', array[6, 12]::smallint[]),
        ('Physical Environment and Parent Journey Audit', 'audit', 'evidence', 3::smallint, array['3.1.1', '3.1.2', '6.1.1']::text[], null::text, 'half_yearly', array[6, 12]::smallint[]),
        ('Professional Development Audit', 'audit', 'evidence', 7::smallint, array['7.2.3']::text[], null::text, 'half_yearly', array[6, 12]::smallint[]),
        ('Clean, Maintenance and Risk Audit', 'audit', 'evidence', 2::smallint, array['2.1.2']::text[], null::text, 'half_yearly', array[1, 7]::smallint[]),
        ('Safe Sleep and Rest Audit', 'audit', 'evidence', 2::smallint, array['2.1.1', '2.2.1', '2.2.2']::text[], null::text, 'half_yearly', array[1, 7]::smallint[]),
        ('Teamwork Audit', 'audit', 'evidence', 5::smallint, array['4.1.2', '4.2.1']::text[], null::text, 'half_yearly', array[1, 7]::smallint[]),
        ('Kitchen and Nutritional Practices Audit', 'audit', 'evidence', 2::smallint, array['2.1.2', '2.1.3']::text[], null::text, 'half_yearly', array[2, 8]::smallint[]),
        ('Equipment and Resource Audit', 'audit', 'evidence', 3::smallint, array['3.2.2']::text[], null::text, 'half_yearly', array[2, 8]::smallint[]),
        ('Building Relationships with Families Audit', 'audit', 'evidence', 6::smallint, array['6.1.2']::text[], null::text, 'half_yearly', array[2, 8]::smallint[]),
        ('Bathroom Safety Audit', 'audit', 'evidence', 2::smallint, array['2.1.2']::text[], null::text, 'half_yearly', array[3, 9]::smallint[]),
        ('Effective Hygiene Audit', 'audit', 'evidence', 2::smallint, array['2.1.2']::text[], null::text, 'half_yearly', array[3, 9]::smallint[]),
        ('Physical Environment Audit', 'audit', 'evidence', 3::smallint, array['3.1.1', '3.1.2']::text[], null::text, 'half_yearly', array[3, 9]::smallint[]),
        ('Interaction Audit', 'audit', 'evidence', 5::smallint, array['5.1.1']::text[], null::text, 'half_yearly', array[3, 9]::smallint[]),
        ('Philosophy Review', 'audit', 'evidence', 7::smallint, array['7.1.1']::text[], null::text, 'annually', array[1]::smallint[]),
        ('Medical Conditions Review', 'audit', 'evidence', 2::smallint, array['2.1.2', '2.2.1']::text[], null::text, 'annually', array[2]::smallint[]),
        ('HR Management Review Audit', 'audit', 'evidence', 7::smallint, array['7.1.2']::text[], null::text, 'annually', array[3]::smallint[]),
        ('Child Safe Standards Checklist', 'audit', 'evidence', 2::smallint, array['2.2.3']::text[], null::text, 'annually', array[4]::smallint[]),
        ('Sustainability Audit', 'audit', 'evidence', 3::smallint, array['3.2.3']::text[], null::text, 'annually', array[5]::smallint[]),
        ('Sustainability Commitment Review', 'audit', 'evidence', 3::smallint, array['3.2.3']::text[], null::text, 'annually', array[6]::smallint[]),
        ('Risk Assessment Review', 'audit', 'evidence', 2::smallint, array['2.2.1', '2.2.2']::text[], null::text, 'annually', array[6]::smallint[]),
        ('Privacy Audit', 'audit', 'evidence', 7::smallint, array['7.1.2']::text[], null::text, 'annually', array[7]::smallint[]),
        ('Enrolment Resources Review', 'audit', 'evidence', 7::smallint, array['7.1.2']::text[], null::text, 'annually', array[8]::smallint[]),
        ('Work Health and Safety Audit', 'audit', 'evidence', 2::smallint, array['2.2.1']::text[], null::text, 'annually', array[9]::smallint[]),
        ('Staff Performance Review', 'audit', 'evidence', 7::smallint, array['7.2.3']::text[], null::text, 'annually', array[10]::smallint[]),
        ('Special Days and Events Calendar Review', 'audit', 'evidence', 1::smallint, array['1.3.3']::text[], null::text, 'annually', array[11]::smallint[]),
        ('Record Keeping Audit', 'audit', 'evidence', 7::smallint, array['7.1.2']::text[], null::text, 'annually', array[12]::smallint[]),
        ('Bottle Preparation Audit', 'audit', 'evidence', 2::smallint, array['2.1.2']::text[], null::text, 'each_time', null::smallint[]),
        ('Nappy Change Audit', 'audit', 'evidence', 2::smallint, array['2.1.1', '2.1.2']::text[], null::text, 'each_time', null::smallint[]),
        ('Car Park Safety Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Approved provider or nominated supervisor', 'monthly', null::smallint[]),
        ('First Aid Kit Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'First aid officer', 'half_yearly', array[1, 7]::smallint[]),
        ('Emergency Evacuation Kit Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Appointed person', 'half_yearly', array[2, 8]::smallint[]),
        ('Fire and Safety Equipment Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Appointed person', 'half_yearly', array[3, 9]::smallint[]),
        ('Spill Kit Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Appointed person', 'half_yearly', array[4, 10]::smallint[]),
        ('Menu Planning Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Kitchen staff / educator', 'half_yearly', array[5, 11]::smallint[]),
        ('Compliance Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[1]::smallint[]),
        ('CCS Compliance Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[2]::smallint[]),
        ('Document Organisation Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[3]::smallint[]),
        ('Information and Display Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[4]::smallint[]),
        ('Policy and Procedure Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[5]::smallint[]),
        ('End of Year Checklist', 'checklist', 'evidence', 7::smallint, null::text[], 'Approved provider or nominated supervisor', 'annually', array[12]::smallint[]),
        ('Transportation Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Appointed person', 'each_time', null::smallint[]),
        ('Bomb Threat Checklist', 'checklist', 'evidence', 2::smallint, null::text[], 'Person who takes the call', 'each_time', null::smallint[]),
        ('Opening and Closing Checklist', 'checklist', 'checklist', 3::smallint, null::text[], 'Educator', 'daily', null::smallint[]),
        ('Bathroom and Nappy Change Cleaning Checklist', 'checklist', 'checklist', 2::smallint, null::text[], 'Educator', 'daily', null::smallint[]),
        ('Indoor Cleaning Checklist', 'checklist', 'checklist', 2::smallint, null::text[], 'Educator', 'daily', null::smallint[]),
        ('Outdoor Cleaning and Safety Checklist', 'checklist', 'checklist', 3::smallint, null::text[], 'Educator', 'daily', null::smallint[]),
        ('Daily Kitchen Checklist', 'checklist', 'checklist', 2::smallint, null::text[], 'Kitchen staff / educator', 'daily', null::smallint[]),
        ('Kitchen Cleaning Checklist', 'checklist', 'checklist', 2::smallint, null::text[], 'Kitchen staff / educator', 'daily', null::smallint[])
    ) as library (
      name, category, archetype, quality_area, nqs_refs, completed_by, cadence, cadence_months
    )
  loop
    if not exists (
      select 1
      from public.form_templates as existing
      where existing.is_system
        and existing.org_id is null
        and existing.name = seed.name
    ) then
      insert into public.form_templates (
        org_id, name, archetype, schema, is_system, cadence, scope,
        category, quality_area, nqs_refs, completed_by, cadence_months, description
      ) values (
        null,
        seed.name,
        seed.archetype,
        case
          when seed.archetype = 'checklist' then jsonb_build_object(
            'archetype', 'checklist',
            'items', jsonb_build_array(jsonb_build_object(
              'id', 'done',
              'label', 'The ' || seed.name || ' has been completed as per the centre''s checklist',
              'type', 'checkbox',
              'required', true
            )),
            'signoff', jsonb_build_object('required', true)
          )
          else '{}'::jsonb
        end,
        true,
        seed.cadence,
        'all_sites',
        seed.category,
        seed.quality_area,
        seed.nqs_refs,
        seed.completed_by,
        seed.cadence_months,
        library_description
      );
    end if;

    update public.form_templates as templates
    set
      archetype = seed.archetype,
      category = seed.category,
      quality_area = seed.quality_area,
      nqs_refs = seed.nqs_refs,
      completed_by = seed.completed_by,
      cadence = seed.cadence,
      cadence_months = seed.cadence_months,
      scope = 'all_sites',
      description = library_description,
      schema = case
        when seed.archetype = 'checklist' then jsonb_build_object(
          'archetype', 'checklist',
          'items', jsonb_build_array(jsonb_build_object(
            'id', 'done',
            'label', 'The ' || seed.name || ' has been completed as per the centre''s checklist',
            'type', 'checkbox',
            'required', true
          )),
          'signoff', jsonb_build_object('required', true)
        )
        else '{}'::jsonb
      end
    where templates.is_system
      and templates.org_id is null
      and templates.name = seed.name;
  end loop;
end
$$;

insert into public.form_org_schedule (org_id, template_id, enabled)
select orgs.id, templates.id, false
from public.organizations as orgs
join public.form_templates as templates
  on templates.org_id is null
 and templates.is_system
 and templates.category = 'checklist'
 and templates.cadence = 'daily'
on conflict (org_id, template_id) do nothing;

-- Follow-up actions. Separate from the locked submission: closing, reassigning,
-- and changing the due date update this table only.
create table if not exists public.form_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  submission_id uuid references public.form_submissions (id) on delete cascade,
  template_id uuid references public.form_templates (id) on delete set null,
  source_item_id text,
  description text not null,
  action_required text not null default '',
  quality_area smallint,
  owner_staff_id uuid references public.staff (id) on delete set null,
  owner_name text,
  due_date date,
  status text not null default 'open',
  added_to_qip boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  closed_note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_by_staff_id uuid references public.staff (id) on delete set null
);

alter table public.form_actions
  add column if not exists submission_id uuid references public.form_submissions (id) on delete cascade;
alter table public.form_actions
  add column if not exists template_id uuid references public.form_templates (id) on delete set null;
alter table public.form_actions
  add column if not exists source_item_id text;
alter table public.form_actions
  add column if not exists action_required text;
alter table public.form_actions
  add column if not exists quality_area smallint;
alter table public.form_actions
  add column if not exists owner_staff_id uuid references public.staff (id) on delete set null;
alter table public.form_actions
  add column if not exists owner_name text;
alter table public.form_actions
  add column if not exists due_date date;
alter table public.form_actions
  add column if not exists status text;
alter table public.form_actions
  add column if not exists added_to_qip boolean;
alter table public.form_actions
  add column if not exists closed_at timestamptz;
alter table public.form_actions
  add column if not exists closed_by uuid references auth.users (id) on delete set null;
alter table public.form_actions
  add column if not exists closed_note text;
alter table public.form_actions
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.form_actions
  add column if not exists created_by_staff_id uuid references public.staff (id) on delete set null;

update public.form_actions
set action_required = ''
where action_required is null;

update public.form_actions
set status = 'open'
where status is null
   or status not in ('open', 'closed');

update public.form_actions
set added_to_qip = false
where added_to_qip is null;

update public.form_actions
set quality_area = null
where quality_area is not null
  and quality_area not between 1 and 7;

update public.form_actions
set owner_name = null
where owner_name is not null
  and btrim(owner_name) = '';

update public.form_actions
set closed_at = null,
    closed_by = null,
    closed_note = null
where status = 'open';

update public.form_actions
set status = 'open',
    closed_at = null,
    closed_by = null,
    closed_note = null
where status = 'closed'
  and (
    closed_at is null
    or closed_note is null
    or btrim(closed_note) = ''
  );

alter table public.form_actions
  alter column action_required set default '';
alter table public.form_actions
  alter column action_required set not null;
alter table public.form_actions
  alter column status set default 'open';
alter table public.form_actions
  alter column status set not null;
alter table public.form_actions
  alter column added_to_qip set default false;
alter table public.form_actions
  alter column added_to_qip set not null;

alter table public.form_actions drop constraint if exists form_actions_status_check;
alter table public.form_actions add constraint form_actions_status_check
  check (status in ('open', 'closed'));

alter table public.form_actions drop constraint if exists form_actions_description_check;
alter table public.form_actions add constraint form_actions_description_check
  check (length(btrim(description)) > 0);

alter table public.form_actions drop constraint if exists form_actions_quality_area_check;
alter table public.form_actions add constraint form_actions_quality_area_check
  check (quality_area is null or quality_area between 1 and 7);

alter table public.form_actions drop constraint if exists form_actions_closed_check;
alter table public.form_actions add constraint form_actions_closed_check
  check (
    (
      status = 'open'
      and closed_at is null
      and closed_by is null
      and closed_note is null
    )
    or (
      status = 'closed'
      and closed_at is not null
      and length(btrim(closed_note)) > 0
    )
  );

create index if not exists form_actions_org_id_idx
  on public.form_actions (org_id);
create index if not exists form_actions_site_id_idx
  on public.form_actions (site_id);
create index if not exists form_actions_submission_id_idx
  on public.form_actions (submission_id);
create index if not exists form_actions_org_status_idx
  on public.form_actions (org_id, status);

drop index if exists public.form_actions_submission_item_key;
create unique index form_actions_submission_item_key
  on public.form_actions (submission_id, source_item_id)
  where submission_id is not null
    and source_item_id is not null;

alter table public.form_actions enable row level security;

revoke all on table public.form_actions from public;
revoke all on table public.form_actions from anon;
grant select, insert, update on table public.form_actions to authenticated;

drop policy if exists "Plus users can view form actions" on public.form_actions;
create policy "Plus users can view form actions"
  on public.form_actions
  for select
  to authenticated
  using (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can insert form actions" on public.form_actions;
create policy "Plus users can insert form actions"
  on public.form_actions
  for insert
  to authenticated
  with check (
    org_id in (
      select public.user_plus_org_ids()
    )
  );

drop policy if exists "Plus users can update form actions" on public.form_actions;
create policy "Plus users can update form actions"
  on public.form_actions
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

drop trigger if exists audit_form_actions_change on public.form_actions;
create trigger audit_form_actions_change
  after insert or update or delete on public.form_actions
  for each row execute function public.audit_log_change();

-- Site, submission, template, and staff must belong to the action's org.
-- Authenticated callers cannot spoof the creator or reopen a closed action.
create or replace function public.guard_form_action()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_site_org uuid;
  v_sub_org uuid;
  v_sub_site uuid;
  v_template_org uuid;
  v_staff_org uuid;
begin
  select sites.org_id
  into v_site_org
  from public.sites as sites
  where sites.id = new.site_id;

  if v_site_org is distinct from new.org_id then
    raise exception 'site does not belong to this organisation'
      using errcode = '23514';
  end if;

  if new.submission_id is not null then
    select submissions.org_id, submissions.site_id
    into v_sub_org, v_sub_site
    from public.form_submissions as submissions
    where submissions.id = new.submission_id;

    if v_sub_org is distinct from new.org_id or v_sub_site is distinct from new.site_id then
      raise exception 'submission does not belong to this site'
        using errcode = '23514';
    end if;
  end if;

  if new.template_id is not null then
    select templates.org_id
    into v_template_org
    from public.form_templates as templates
    where templates.id = new.template_id;

    if v_template_org is not null and v_template_org is distinct from new.org_id then
      raise exception 'template does not belong to this organisation'
        using errcode = '23514';
    end if;
  end if;

  if new.owner_staff_id is not null then
    select staff.org_id
    into v_staff_org
    from public.staff as staff
    where staff.id = new.owner_staff_id;

    if v_staff_org is distinct from new.org_id then
      raise exception 'owner does not belong to this organisation'
        using errcode = '23514';
    end if;
  end if;

  if new.created_by_staff_id is not null then
    select staff.org_id
    into v_staff_org
    from public.staff as staff
    where staff.id = new.created_by_staff_id;

    if v_staff_org is distinct from new.org_id then
      raise exception 'creator does not belong to this organisation'
        using errcode = '23514';
    end if;
  end if;

  if new.owner_name is not null and btrim(new.owner_name) = '' then
    new.owner_name := null;
  end if;

  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_by_staff_id := null;
      new.status := 'open';
      new.closed_at := null;
      new.closed_by := null;
      new.closed_note := null;
    else
      new.org_id := old.org_id;
      new.site_id := old.site_id;
      new.submission_id := old.submission_id;
      new.template_id := old.template_id;
      new.source_item_id := old.source_item_id;
      new.created_by := old.created_by;
      new.created_by_staff_id := old.created_by_staff_id;
      new.created_at := old.created_at;

      if old.status = 'closed' then
        new.status := 'closed';
        new.closed_at := old.closed_at;
        new.closed_by := old.closed_by;
        new.closed_note := old.closed_note;
      elsif new.status = 'closed' then
        if length(btrim(coalesce(new.closed_note, ''))) = 0 then
          raise exception 'Enter a note to close this action'
            using errcode = '23514';
        end if;
        new.closed_by := auth.uid();
        new.closed_at := now();
      else
        new.status := 'open';
        new.closed_at := null;
        new.closed_by := null;
        new.closed_note := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_form_action on public.form_actions;
create trigger guard_form_action
  before insert or update on public.form_actions
  for each row execute function public.guard_form_action();

-- A completed checklist "No" becomes an action, due 7 days after the
-- submission unless the form already set a date. Evidence audits copy the
-- action rows the director added. Same transaction as completion.
create or replace function public.raise_form_actions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archetype text;
  v_schema jsonb;
  v_quality smallint;
  v_item jsonb;
  v_action jsonb;
  v_item_id text;
  v_value text;
  v_note text;
  v_due_text text;
  v_due date;
  v_default_due date;
  v_owner_text text;
  v_owner uuid;
  v_owner_name text;
  v_description text;
begin
  if new.status is distinct from 'complete' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'complete' then
    return new;
  end if;

  select templates.archetype, templates.schema, templates.quality_area
  into v_archetype, v_schema, v_quality
  from public.form_templates as templates
  where templates.id = new.template_id;

  if v_archetype is null then
    return new;
  end if;

  v_default_due := (timezone('Australia/Sydney', coalesce(new.submitted_at, now())))::date + 7;

  if v_archetype = 'checklist' then
    for v_item in
      select elem
      from jsonb_array_elements(coalesce(v_schema->'items', '[]'::jsonb)) as elem
    loop
      if coalesce(v_item->>'answers', '') is distinct from 'yes_no_na' then
        continue;
      end if;

      v_item_id := nullif(btrim(coalesce(v_item->>'id', '')), '');
      if v_item_id is null then
        continue;
      end if;

      v_value := coalesce(
        new.data->'values'->>v_item_id,
        new.data->'fields'->>v_item_id,
        ''
      );
      if v_value is distinct from 'no' then
        continue;
      end if;

      v_note := btrim(coalesce(new.data->'notes'->>v_item_id, ''));
      if v_note = '' then
        raise exception 'Enter the action taken for %', coalesce(v_item->>'label', 'this item')
          using errcode = '23514';
      end if;

      v_due_text := btrim(coalesce(new.data #>> array['action_details', v_item_id, 'due_date'], ''));
      if v_due_text ~ '^\d{4}-\d{2}-\d{2}$' then
        v_due := v_due_text::date;
      else
        v_due := v_default_due;
      end if;

      v_owner_text := btrim(coalesce(new.data #>> array['action_details', v_item_id, 'owner_staff_id'], ''));
      v_owner := null;
      if v_owner_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_owner := v_owner_text::uuid;
      end if;
      v_owner_name := nullif(btrim(coalesce(new.data #>> array['action_details', v_item_id, 'owner_name'], '')), '');
      v_description := nullif(btrim(coalesce(v_item->>'label', '')), '');

      insert into public.form_actions (
        org_id, site_id, submission_id, template_id, source_item_id,
        description, action_required, quality_area,
        owner_staff_id, owner_name, due_date,
        created_by, created_by_staff_id
      ) values (
        new.org_id,
        new.site_id,
        new.id,
        new.template_id,
        v_item_id,
        coalesce(v_description, 'Action'),
        v_note,
        v_quality,
        v_owner,
        v_owner_name,
        v_due,
        auth.uid(),
        new.signed_by_staff_id
      )
      on conflict (submission_id, source_item_id)
        where submission_id is not null and source_item_id is not null
        do nothing;
    end loop;
  elsif v_archetype = 'evidence' then
    for v_action in
      select elem
      from jsonb_array_elements(coalesce(new.data->'actions', '[]'::jsonb)) as elem
    loop
      v_description := nullif(btrim(coalesce(v_action->>'description', '')), '');
      if v_description is null then
        continue;
      end if;

      v_due_text := btrim(coalesce(v_action->>'due_date', ''));
      v_due := null;
      if v_due_text ~ '^\d{4}-\d{2}-\d{2}$' then
        v_due := v_due_text::date;
      end if;

      v_owner_text := btrim(coalesce(v_action->>'owner_staff_id', ''));
      v_owner := null;
      if v_owner_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_owner := v_owner_text::uuid;
      end if;

      insert into public.form_actions (
        org_id, site_id, submission_id, template_id,
        description, action_required, quality_area,
        owner_staff_id, owner_name, due_date, added_to_qip,
        created_by, created_by_staff_id
      ) values (
        new.org_id,
        new.site_id,
        new.id,
        new.template_id,
        v_description,
        btrim(coalesce(v_action->>'action_required', '')),
        v_quality,
        v_owner,
        nullif(btrim(coalesce(v_action->>'owner_name', '')), ''),
        v_due,
        coalesce(v_action->>'added_to_qip', '') = 'true',
        auth.uid(),
        new.signed_by_staff_id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists raise_form_actions on public.form_submissions;
create trigger raise_form_actions
  after insert or update on public.form_submissions
  for each row execute function public.raise_form_actions();

-- Overdue actions in the morning digest: one claim per action per due date.
-- A changed due date can be reported once more. Service role only.
create table if not exists public.form_action_digest (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_id uuid not null references public.form_actions (id) on delete cascade,
  due_date date not null,
  status text not null default 'sending',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.form_action_digest
  drop constraint if exists form_action_digest_action_date_key;
alter table public.form_action_digest
  add constraint form_action_digest_action_date_key
  unique (action_id, due_date);

alter table public.form_action_digest drop constraint if exists form_action_digest_status_check;
alter table public.form_action_digest add constraint form_action_digest_status_check
  check (status in ('sending', 'sent'));

create index if not exists form_action_digest_status_created_at_idx
  on public.form_action_digest (status, created_at);

alter table public.form_action_digest enable row level security;

revoke all on table public.form_action_digest from public;
revoke all on table public.form_action_digest from anon;
revoke all on table public.form_action_digest from authenticated;

revoke all on function public.guard_form_action() from public;
revoke all on function public.guard_form_action() from anon;
revoke all on function public.raise_form_actions() from public;
revoke all on function public.raise_form_actions() from anon;
