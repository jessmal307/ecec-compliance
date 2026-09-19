-- Seed a realistic multi-site ECEC dataset for the existing organisation.
-- Does not insert or update requirement_types.
-- Safe to re-run: removes previous rows tagged by this seed first.
-- Run in the Supabase SQL editor.

do $$
declare
  org uuid;
  type_id uuid;
  site_ids uuid[] := '{}';
  staff_ids uuid[] := '{}';
  site_rec record;
  i int;
begin
  select id
  into org
  from public.organizations
  order by created_at asc nulls last
  limit 1;

  if org is null then
    raise exception 'No organisation found';
  end if;

  raise notice 'Seeding organisation %', org;

  delete from public.compliance_items
  where org_id = org
    and (
      staff_id in (select id from public.staff where org_id = org and notes = 'seed:demo')
      or site_id in (
        select id from public.sites
        where org_id = org
          and service_approval_number like 'SEED-%'
      )
    );

  delete from public.staff
  where org_id = org
    and notes = 'seed:demo';

  delete from public.sites
  where org_id = org
    and service_approval_number like 'SEED-%';

  with new_sites as (
    insert into public.sites (
      name,
      address,
      service_approval_number,
      phone,
      nominated_supervisor,
      org_id
    )
    values
      (
        'Little Gum Trees Early Learning',
        '14 Banksia Street, Marrickville NSW 2204',
        'SEED-SE-0001',
        '02 9550 2140',
        'Priya Nair',
        org
      ),
      (
        'Wattle Creek Children''s Centre',
        '88 Wattle Road, Liverpool NSW 2170',
        'SEED-SE-0002',
        '02 9821 4470',
        'Michael Chen',
        org
      ),
      (
        'Harbourview Early Learning Centre',
        '3 Wharf Lane, Rozelle NSW 2039',
        'SEED-SE-0003',
        '02 9810 6622',
        'Sarah O''Brien',
        org
      ),
      (
        'Redgum Community Preschool',
        '27 Redgum Drive, Castle Hill NSW 2154',
        'SEED-SE-0004',
        '02 9634 1188',
        'James Nguyen',
        org
      )
    returning id, service_approval_number
  )
  select coalesce(array_agg(id order by service_approval_number), '{}')
  into site_ids
  from new_sites;

  if array_length(site_ids, 1) is distinct from 4 then
    raise exception 'Expected 4 seed sites, got %', array_length(site_ids, 1);
  end if;

  with roster (sort_order, name, role, employment_status, start_date, email, phone) as (
    values
      (1,  'Priya Nair',              'Nominated Supervisor / Director', 'active',   date '2018-02-12', 'priya.nair@littlegumtrees.example',           '0412 300 101'),
      (2,  'Hannah Blake',            'Early Childhood Teacher',        'active',   date '2021-03-08', 'hannah.blake@littlegumtrees.example',         '0412 300 102'),
      (3,  'Daniel Okonkwo',          'Early Childhood Teacher',        'active',   date '2020-07-20', 'daniel.okonkwo@littlegumtrees.example',       '0412 300 103'),
      (4,  'Mei Ling Zhou',           'Diploma Educator',               'active',   date '2019-11-04', 'mei.zhou@littlegumtrees.example',             '0412 300 104'),
      (5,  'Tomás Alvarez',           'Diploma Educator',               'active',   date '2022-01-17', 'tomas.alvarez@littlegumtrees.example',        '0412 300 105'),
      (6,  'Aisha Rahman',            'Diploma Educator',               'active',   date '2023-05-02', 'aisha.rahman@littlegumtrees.example',         '0412 300 106'),
      (7,  'Ellie Patterson',         'Certificate III Educator',       'active',   date '2024-02-19', 'ellie.patterson@littlegumtrees.example',      '0412 300 107'),
      (8,  'Noah Williams',           'Certificate III Educator',       'active',   date '2023-09-11', 'noah.williams@littlegumtrees.example',        '0412 300 108'),
      (9,  'Maria Rossi',             'Cook',                           'active',   date '2017-06-01', 'maria.rossi@littlegumtrees.example',          '0412 300 109'),
      (10, 'Liam Foster',             'Certificate III Educator',       'inactive', date '2022-08-15', 'liam.foster@littlegumtrees.example',          '0412 300 110'),
      (11, 'Michael Chen',            'Nominated Supervisor / Director', 'active',  date '2016-04-18', 'michael.chen@wattlecreek.example',           '0413 400 201'),
      (12, 'Sophie Tran',             'Early Childhood Teacher',        'active',   date '2021-09-06', 'sophie.tran@wattlecreek.example',            '0413 400 202'),
      (13, 'Ben Cartwright',          'Early Childhood Teacher',        'active',   date '2019-02-25', 'ben.cartwright@wattlecreek.example',         '0413 400 203'),
      (14, 'Fatima El-Sayed',         'Diploma Educator',               'active',   date '2020-10-12', 'fatima.elsayed@wattlecreek.example',         '0413 400 204'),
      (15, 'Jake Morrison',           'Diploma Educator',               'active',   date '2022-06-27', 'jake.morrison@wattlecreek.example',          '0413 400 205'),
      (16, 'Chloe Nguyen',            'Diploma Educator',               'active',   date '2023-01-16', 'chloe.nguyen@wattlecreek.example',           '0413 400 206'),
      (17, 'Riley McKenzie',          'Certificate III Educator',       'active',   date '2024-04-08', 'riley.mckenzie@wattlecreek.example',         '0413 400 207'),
      (18, 'Amelia Brooks',           'Certificate III Educator',       'active',   date '2023-07-31', 'amelia.brooks@wattlecreek.example',          '0413 400 208'),
      (19, 'Giuseppe Bianchi',        'Cook',                           'active',   date '2018-09-03', 'giuseppe.bianchi@wattlecreek.example',       '0413 400 209'),
      (20, 'Grace Holloway',          'Diploma Educator',               'inactive', date '2021-12-01', 'grace.holloway@wattlecreek.example',         '0413 400 210'),
      (21, 'Sarah O''Brien',          'Nominated Supervisor / Director', 'active',  date '2015-08-10', 'sarah.obrien@harbourview.example',           '0414 500 301'),
      (22, 'Luca Moretti',            'Early Childhood Teacher',        'active',   date '2020-03-23', 'luca.moretti@harbourview.example',           '0414 500 302'),
      (23, 'Isla Campbell',           'Early Childhood Teacher',        'active',   date '2022-02-14', 'isla.campbell@harbourview.example',          '0414 500 303'),
      (24, 'Yasmin Haddad',           'Diploma Educator',               'active',   date '2019-05-27', 'yasmin.haddad@harbourview.example',          '0414 500 304'),
      (25, 'Owen Fraser',             'Diploma Educator',               'active',   date '2021-11-08', 'owen.fraser@harbourview.example',            '0414 500 305'),
      (26, 'Nadia Petrov',            'Diploma Educator',               'active',   date '2023-03-20', 'nadia.petrov@harbourview.example',           '0414 500 306'),
      (27, 'Harper Quinn',            'Certificate III Educator',       'active',   date '2024-01-09', 'harper.quinn@harbourview.example',           '0414 500 307'),
      (28, 'Leo Santos',              'Certificate III Educator',       'active',   date '2022-10-17', 'leo.santos@harbourview.example',             '0414 500 308'),
      (29, 'Anh Pham',                'Cook',                           'active',   date '2019-08-05', 'anh.pham@harbourview.example',               '0414 500 309'),
      (30, 'Georgia Walsh',           'Early Childhood Teacher',        'inactive', date '2020-01-13', 'georgia.walsh@harbourview.example',          '0414 500 310'),
      (31, 'James Nguyen',            'Nominated Supervisor / Director', 'active',  date '2017-03-06', 'james.nguyen@redgum.example',                '0415 600 401'),
      (32, 'Emily Hart',              'Early Childhood Teacher',        'active',   date '2021-06-21', 'emily.hart@redgum.example',                  '0415 600 402'),
      (33, 'Ravi Sharma',             'Early Childhood Teacher',        'active',   date '2018-10-29', 'ravi.sharma@redgum.example',                 '0415 600 403'),
      (34, 'Caitlin Byrne',           'Diploma Educator',               'active',   date '2022-04-04', 'caitlin.byrne@redgum.example',               '0415 600 404'),
      (35, 'Samir Khan',              'Diploma Educator',               'active',   date '2020-09-14', 'samir.khan@redgum.example',                  '0415 600 405'),
      (36, 'Holly Pearce',            'Diploma Educator',               'active',   date '2023-08-07', 'holly.pearce@redgum.example',                '0415 600 406'),
      (37, 'Mason Reid',              'Certificate III Educator',       'active',   date '2024-03-18', 'mason.reid@redgum.example',                  '0415 600 407'),
      (38, 'Zara Ahmed',              'Certificate III Educator',       'active',   date '2023-02-27', 'zara.ahmed@redgum.example',                  '0415 600 408'),
      (39, 'Elena Popescu',           'Cook',                           'active',   date '2016-11-22', 'elena.popescu@redgum.example',               '0415 600 409'),
      (40, 'Alex Kim',                'Diploma Educator',               'active',   date '2022-07-11', 'alex.kim@littlegumtrees.example',            '0412 300 140')
  ),
  new_staff as (
    insert into public.staff (
      name,
      role,
      employment_status,
      start_date,
      email,
      phone,
      notes,
      org_id
    )
    select
      roster.name,
      roster.role,
      roster.employment_status,
      roster.start_date,
      roster.email,
      roster.phone,
      'seed:demo',
      org
    from roster
    order by roster.sort_order
    returning id, email
  )
  select coalesce(array_agg(new_staff.id order by roster.sort_order), '{}')
  into staff_ids
  from roster
  join new_staff on new_staff.email = roster.email;

  if array_length(staff_ids, 1) is distinct from 40 then
    raise exception 'Expected 40 seed staff, got %', array_length(staff_ids, 1);
  end if;

  insert into public.staff_sites (staff_id, site_id)
  select staff_ids[n], site_ids[1 + ((n - 1) / 10)]
  from generate_series(1, 40) as n;

  -- Floaters across two sites
  insert into public.staff_sites (staff_id, site_id)
  values
    (staff_ids[5],  site_ids[2]),
    (staff_ids[15], site_ids[3]),
    (staff_ids[25], site_ids[4]),
    (staff_ids[35], site_ids[1]),
    (staff_ids[40], site_ids[3])
  on conflict do nothing;

  -- Current staff items (leave many types blank so they show as missing)
  insert into public.compliance_items (
    org_id,
    requirement_type_id,
    label,
    expiry_date,
    reference_number,
    issued_date,
    issuer,
    status,
    last_verified_date,
    staff_id,
    site_id
  )
  select
    org,
    types.id,
    types.name,
    current_date + ((180 + ((n * 17 + type_rank * 11) % 540))::int),
    case types.name
      when 'WWCC' then 'WWC' || lpad((1200000 + n)::text, 7, '0') || 'E'
      when 'First Aid' then 'FA-' || lpad(n::text, 4, '0')
      when 'CPR' then 'CPR-' || lpad(n::text, 4, '0')
      when 'Qualification' then 'ACECQA-' || lpad((4000 + n)::text, 5, '0')
      when 'Teacher Accreditation' then 'NESA-' || lpad((8000 + n)::text, 5, '0')
      when 'Police Check' then 'NPC-' || lpad((3000 + n)::text, 5, '0')
      else upper(left(types.name, 3)) || '-' || lpad(n::text, 4, '0')
    end,
    current_date - ((90 + ((n * 13) % 400))::int),
    case types.name
      when 'WWCC' then 'Office of the Children''s Guardian'
      when 'First Aid' then 'St John Ambulance'
      when 'CPR' then 'Australian Red Cross'
      when 'Anaphylaxis Management' then 'Allergy & Anaphylaxis Australia'
      when 'Asthma Management' then 'Asthma Australia'
      when 'Child Protection Training' then 'Office of the Children''s Guardian'
      when 'Qualification' then 'ACECQA'
      when 'Teacher Accreditation' then 'NESA'
      when 'Police Check' then 'NSW Police'
      else 'Registered training organisation'
    end,
    'current',
    case
      when types.name = 'WWCC' and n in (2, 12) then current_date - 100
      else null
    end,
    staff_ids[n],
    null
  from generate_series(1, 40) as n
  join lateral (
    select
      t.id,
      t.name,
      row_number() over (order by t.name) as type_rank
    from public.requirement_types as t
    where t.org_id = org
      and t.applies_to = 'staff'
      and lower(public.normalized_requirement_name(t.name)) in (
        'first aid',
        'cpr',
        'wwcc',
        'qualification',
        'teacher accreditation',
        'anaphylaxis management',
        'asthma management',
        'child protection training',
        'police check'
      )
  ) as types on
    (types.name = 'WWCC' and n not in (7, 17, 27, 37, 8, 18, 28, 38, 10, 20, 30))
    or (types.name = 'First Aid' and n in (1,2,3,4,5,6,11,12,13,14,15,16,21,22,23,24,25,31,32,33,34,35,40))
    or (types.name = 'CPR' and n in (1,2,3,4,11,12,13,14,21,22,23,24,31,32,33,34,40))
    or (types.name = 'Qualification' and n in (1,2,3,11,12,13,21,22,23,31,32,33))
    or (types.name = 'Teacher Accreditation' and n in (2,3,12,13,22,32))
    or (types.name = 'Anaphylaxis Management' and n in (1,2,11,12,21,31))
    or (types.name = 'Asthma Management' and n in (1,3,11,13,21,33))
    or (types.name = 'Child Protection Training' and n in (1,11,21,31,2,12))
    or (types.name = 'Police Check' and n in (1,9,11,19,21,29,31,39));

  -- ~8 items inside their type's renewal lead window
  update public.compliance_items as items
  set
    expiry_date = patch.expiry_date,
    status = 'current'
  from (
    values
      (staff_ids[1],  'First Aid',               current_date + 18),
      (staff_ids[12], 'First Aid',               current_date + 32),
      (staff_ids[2],  'CPR',                     current_date + 9),
      (staff_ids[22], 'CPR',                     current_date + 21),
      (staff_ids[3],  'WWCC',                    current_date + 40),
      (staff_ids[11], 'Police Check',            current_date + 12),
      (staff_ids[21], 'Child Protection Training', current_date + 25),
      (staff_ids[31], 'Anaphylaxis Management',  current_date + 14)
  ) as patch(staff_id, type_name, expiry_date)
  join public.requirement_types as types
    on types.org_id = org
   and types.name = patch.type_name
  where items.org_id = org
    and items.staff_id = patch.staff_id
    and items.requirement_type_id = types.id;

  -- ~4 already expired
  update public.compliance_items as items
  set
    expiry_date = patch.expiry_date,
    status = 'expired'
  from (
    values
      (staff_ids[4],  'First Aid', current_date - 22),
      (staff_ids[14], 'CPR',       current_date - 8),
      (staff_ids[23], 'WWCC',      current_date - 46),
      (staff_ids[33], 'First Aid', current_date - 71)
  ) as patch(staff_id, type_name, expiry_date)
  join public.requirement_types as types
    on types.org_id = org
   and types.name = patch.type_name
  where items.org_id = org
    and items.staff_id = patch.staff_id
    and items.requirement_type_id = types.id;

  -- Site-level items: some recorded, many left missing
  insert into public.compliance_items (
    org_id,
    requirement_type_id,
    label,
    expiry_date,
    reference_number,
    issued_date,
    issuer,
    status,
    last_verified_date,
    staff_id,
    site_id
  )
  select
    org,
    types.id,
    types.name,
    current_date + patch.expiry_offset,
    patch.reference_number,
    current_date - patch.issued_ago,
    patch.issuer,
    case when patch.expiry_offset < 0 then 'expired' else 'current' end,
    patch.last_verified,
    null,
    site_ids[patch.site_no]
  from (
    values
      (1, 'Service Approval',              800,  'SEED-SA-0001', 400, 'NSW Department of Education', null),
      (2, 'Service Approval',              720,  'SEED-SA-0002', 380, 'NSW Department of Education', null),
      (3, 'Service Approval',              640,  'SEED-SA-0003', 360, 'NSW Department of Education', null),
      (4, 'Service Approval',              900,  'SEED-SA-0004', 420, 'NSW Department of Education', null),
      (1, 'Fire Safety',                   280,  'FS-LG-2026',   90,  'Fire & Rescue NSW', null),
      (2, 'Fire Safety',                    20,  'FS-WC-2026',   340, 'Fire & Rescue NSW', null),
      (3, 'Fire Safety',                   200,  'FS-HV-2026',   160, 'Fire & Rescue NSW', null),
      (1, 'Public Liability Insurance',    210,  'PL-LG-88421',  140, 'IAG / NRMA Business', null),
      (2, 'Public Liability Insurance',      8,  'PL-WC-77109',  350, 'Allianz', null),
      (4, 'Public Liability Insurance',    300,  'PL-RG-55210',  60,  'QBE', null),
      (1, 'Workers Compensation',          190,  'WC-LG-331',    170, 'icare NSW', null),
      (3, 'Workers Compensation',          250,  'WC-HV-118',    110, 'icare NSW', null),
      (2, 'QIP Review',                    160,  'QIP-WC-2026',  200, 'Service leadership team', null),
      (4, 'QIP Review',                    240,  'QIP-RG-2026',  120, 'Service leadership team', null),
      (1, 'Fire Equipment Servicing',      400,  'FES-LG-19',    100, 'Wormald', current_date - 40),
      (3, 'Fire Equipment Servicing',      500,  'FES-HV-04',    80,  'Chubb Fire', current_date - 20),
      (2, 'Evacuation Drills',             365,  'EVAC-WC-06',   70,  'Centre nominated supervisor', current_date - 20),
      (4, 'Electrical Test & Tag',         200,  'ETT-RG-88',    150, 'Test and Tag NSW', null),
      (1, 'Food Safety Registration',      260,  'FSR-LG-12',    100, 'Inner West Council', null)
  ) as patch(
    site_no,
    type_name,
    expiry_offset,
    reference_number,
    issued_ago,
    issuer,
    last_verified
  )
  join public.requirement_types as types
    on types.org_id = org
   and types.name = patch.type_name;

  raise notice 'Seed complete. sites=%, staff=%, items=%',
    (select count(*) from public.sites where org_id = org and service_approval_number like 'SEED-%'),
    (select count(*) from public.staff where org_id = org and notes = 'seed:demo'),
    (select count(*) from public.compliance_items where org_id = org and (
      staff_id in (select id from public.staff where org_id = org and notes = 'seed:demo')
      or site_id in (select id from public.sites where org_id = org and service_approval_number like 'SEED-%')
    ));
end;
$$;
