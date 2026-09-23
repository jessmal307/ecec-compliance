import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildProviderComplianceReport } from '../_shared/dashboardCompliance.js'

// Cron (UTC): 0 14 1 * *
// That's 00:00 on the 1st in AEST (UTC+10) / 01:00 AEDT (UTC+11) — Australia/Sydney.
// Dashboard → Edge Functions → send-monthly-compliance-report → Schedules
// or run supabase/cron_monthly_compliance_report.sql

const TIME_ZONE = 'Australia/Sydney'

type OrganizationRow = {
  id: string
  name: string
  owner_id: string
  alert_email: string | null
}

type StaffSite = { id: string; name: string; archived_at: string | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isArchived(value: string | null | undefined) {
  return value != null && value !== ''
}

function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function todaySydney(): string {
  return dateInTimeZone(new Date(), TIME_ZONE)
}

function monthLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  return date.toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const date = new Date(`${String(isoDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return String(isoDate)
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function percentLabel(percent: number | null) {
  return percent == null ? '—' : `${percent}%`
}

function totalsLine(section: {
  currentCount: number
  expiringCount: number
  expiredCount: number
  missingCount: number
}) {
  return `${section.currentCount} current · ${section.expiringCount} expiring · ${section.expiredCount} expired · ${section.missingCount} missing`
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  const payload = await response.json()
  if (!response.ok) {
    return {
      error: new Error(payload?.message ?? `Resend request failed (${response.status})`),
    }
  }

  return { error: null }
}

function attentionLine(item: {
  status: string
  ownerName: string
  typeName: string
  expiryDate: string | null
}) {
  const bits = [item.status, item.ownerName, item.typeName]
  if (item.expiryDate) bits.push(formatDate(item.expiryDate))
  return bits.map((bit) => escapeHtml(String(bit))).join(' — ')
}

function sectionHtml(section: {
  name: string
  percent: number | null
  currentCount: number
  expiringCount: number
  expiredCount: number
  missingCount: number
  attention: {
    status: string
    ownerName: string
    typeName: string
    expiryDate: string | null
  }[]
}) {
  const attention =
    section.attention.length === 0
      ? '<p>All required items are current.</p>'
      : `<ul>${section.attention
          .map((item) => `<li>${attentionLine(item)}</li>`)
          .join('')}</ul>`

  return `
    <h2>${escapeHtml(section.name)} — ${escapeHtml(percentLabel(section.percent))}</h2>
    <p>${escapeHtml(totalsLine(section))}</p>
    ${attention}
  `
}

function reportHtml(
  orgName: string,
  month: string,
  report: ReturnType<typeof buildProviderComplianceReport>,
) {
  const siteSections = report.sites
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(sectionHtml)
    .join('')
  const unassigned = report.hasUnassigned ? sectionHtml(report.unassigned) : ''

  return `
    <h1>Monthly compliance report — ${escapeHtml(orgName)}</h1>
    <p>${escapeHtml(month)}</p>
    <p><strong>Overall: ${escapeHtml(percentLabel(report.org.percent))}</strong></p>
    <p>${escapeHtml(totalsLine(report.org))}</p>
    ${siteSections || '<p>No sites yet.</p>'}
    ${unassigned}
  `
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail =
    Deno.env.get('RESEND_FROM_EMAIL') ?? 'ECEC Alerts <onboarding@resend.dev>'

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  if (!resendApiKey) {
    return json({ error: 'Missing RESEND_API_KEY' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const todayIso = todaySydney()
  const month = monthLabel(todayIso)
  const ownerEmailCache = new Map<string, string | null>()

  const summary = {
    sent: 0,
    skipped: 0,
    errors: [] as string[],
  }

  async function ownerEmail(ownerId: string): Promise<string | null> {
    if (ownerEmailCache.has(ownerId)) {
      return ownerEmailCache.get(ownerId) ?? null
    }

    const { data, error } = await supabase.auth.admin.getUserById(ownerId)
    if (error) {
      summary.errors.push(`Failed to load owner ${ownerId}: ${error.message}`)
      ownerEmailCache.set(ownerId, null)
      return null
    }

    const email = data.user?.email ?? null
    ownerEmailCache.set(ownerId, email)
    return email
  }

  const [
    orgsResult,
    sitesResult,
    staffResult,
    typesResult,
    itemsResult,
    staffExclusionsResult,
    siteExclusionsResult,
  ] = await Promise.all([
    supabase.from('organizations').select('id, name, owner_id, alert_email'),
    supabase
      .from('sites')
      .select('id, name, org_id, archived_at')
      .is('archived_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('staff')
      .select(
        `
        id, name, employment_status, org_id, archived_at,
        staff_sites (
          site_id,
          sites ( id, name, archived_at )
        )
      `,
      )
      .is('archived_at', null),
    supabase
      .from('requirement_types')
      .select('id, name, org_id, mandatory, applies_to, perpetual, archived_at')
      .is('archived_at', null),
    supabase
      .from('compliance_items')
      .select(
        `
        id, org_id, staff_id, site_id, requirement_type_id, expiry_date, archived_at,
        document_url, working_towards, last_verified_date, issued_date, created_at,
        requirement_types ( name, archived_at ),
        staff ( name, employment_status, archived_at ),
        sites ( name, archived_at )
      `,
      )
      .is('archived_at', null),
    supabase.from('staff_requirement_exclusions').select('staff_id, requirement_type_id'),
    supabase.from('site_requirement_exclusions').select('site_id, requirement_type_id'),
  ])

  for (const [label, result] of [
    ['organizations', orgsResult],
    ['sites', sitesResult],
    ['staff', staffResult],
    ['requirement types', typesResult],
    ['compliance items', itemsResult],
    ['staff exclusions', staffExclusionsResult],
    ['site exclusions', siteExclusionsResult],
  ] as const) {
    if (result.error) {
      return json({ error: `Failed to load ${label}: ${result.error.message}` }, 500)
    }
  }

  const organizations = (orgsResult.data ?? []) as OrganizationRow[]
  const sitesByOrg = new Map<string, { id: string; name: string }[]>()
  for (const site of sitesResult.data ?? []) {
    const list = sitesByOrg.get(site.org_id) ?? []
    list.push({ id: site.id, name: site.name })
    sitesByOrg.set(site.org_id, list)
  }

  const staffByOrg = new Map<
    string,
    {
      id: string
      name: string
      employment_status: string
      sites: StaffSite[]
    }[]
  >()
  for (const row of staffResult.data ?? []) {
    const sites = ((row.staff_sites ?? []) as { sites: StaffSite | null }[])
      .map((link) => link.sites)
      .filter((site): site is StaffSite => Boolean(site) && !isArchived(site.archived_at))
    const list = staffByOrg.get(row.org_id) ?? []
    list.push({
      id: row.id,
      name: row.name,
      employment_status: row.employment_status ?? 'active',
      sites,
    })
    staffByOrg.set(row.org_id, list)
  }

  const typesByOrg = new Map<string, typeof typesResult.data>()
  for (const type of typesResult.data ?? []) {
    const list = typesByOrg.get(type.org_id) ?? []
    list.push(type)
    typesByOrg.set(type.org_id, list)
  }

  const itemsByOrg = new Map<string, Record<string, unknown>[]>()
  for (const row of itemsResult.data ?? []) {
    if (isArchived(row.archived_at)) continue
    if (isArchived(row.staff?.archived_at)) continue
    if (isArchived(row.sites?.archived_at)) continue
    if (isArchived(row.requirement_types?.archived_at)) continue
    const list = itemsByOrg.get(row.org_id) ?? []
    list.push({
      id: row.id,
      staff_id: row.staff_id,
      site_id: row.site_id,
      requirement_type_id: row.requirement_type_id,
      expiry_date: row.expiry_date,
      document_url: row.document_url,
      working_towards: row.working_towards,
      last_verified_date: row.last_verified_date,
      issued_date: row.issued_date,
      created_at: row.created_at,
      typeName: row.requirement_types?.name ?? 'Unknown',
    })
    itemsByOrg.set(row.org_id, list)
  }

  const staffIdsByOrg = new Map<string, Set<string>>()
  for (const [orgId, members] of staffByOrg) {
    staffIdsByOrg.set(orgId, new Set(members.map((member) => member.id)))
  }
  const siteIdsByOrg = new Map<string, Set<string>>()
  for (const [orgId, orgSites] of sitesByOrg) {
    siteIdsByOrg.set(orgId, new Set(orgSites.map((site) => site.id)))
  }

  const staffExclusionsByOrg = new Map<
    string,
    { staff_id: string; requirement_type_id: string }[]
  >()
  for (const row of staffExclusionsResult.data ?? []) {
    for (const [orgId, ids] of staffIdsByOrg) {
      if (!ids.has(row.staff_id)) continue
      const list = staffExclusionsByOrg.get(orgId) ?? []
      list.push(row)
      staffExclusionsByOrg.set(orgId, list)
      break
    }
  }

  const siteExclusionsByOrg = new Map<
    string,
    { site_id: string; requirement_type_id: string }[]
  >()
  for (const row of siteExclusionsResult.data ?? []) {
    for (const [orgId, ids] of siteIdsByOrg) {
      if (!ids.has(row.site_id)) continue
      const list = siteExclusionsByOrg.get(orgId) ?? []
      list.push(row)
      siteExclusionsByOrg.set(orgId, list)
      break
    }
  }

  for (const org of organizations) {
    const to =
      org.alert_email?.trim() ||
      (org.owner_id ? await ownerEmail(org.owner_id) : null)
    if (!to) {
      summary.skipped += 1
      summary.errors.push(`No alert email for org ${org.id}`)
      continue
    }

    const report = buildProviderComplianceReport({
      staff: staffByOrg.get(org.id) ?? [],
      sites: sitesByOrg.get(org.id) ?? [],
      items: itemsByOrg.get(org.id) ?? [],
      requirementTypes: typesByOrg.get(org.id) ?? [],
      exclusions: staffExclusionsByOrg.get(org.id) ?? [],
      siteExclusions: siteExclusionsByOrg.get(org.id) ?? [],
      todayIso,
    })

    const { error: sendError } = await sendResendEmail({
      apiKey: resendApiKey,
      from: fromEmail,
      to,
      subject: `Monthly compliance report — ${org.name} — ${month}`,
      html: reportHtml(org.name, month, report),
    })

    if (sendError) {
      summary.errors.push(`Failed to email ${org.name}: ${sendError.message}`)
      continue
    }

    summary.sent += 1
  }

  return json(summary)
})
