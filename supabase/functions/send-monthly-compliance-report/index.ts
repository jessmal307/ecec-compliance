import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildProviderComplianceReport } from '../_shared/dashboardCompliance.js'
import { hasCronSecretKey } from '../_shared/cronAuth.ts'
import { claimSend, clearStaleClaims, markSent, releaseClaim, type StaleClaim } from '../_shared/emailSends.ts'
import { retryOnJwtSkew } from '../_shared/retry.ts'

// Scheduled by supabase/cron_jobs.sql (rtc-monthly-report).

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

function asAtLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
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
    ${siteSections || '<p>No centres yet.</p>'}
    ${unassigned}
  `
}

async function requestMode(req: Request) {
  const fromQuery = new URL(req.url).searchParams.get('mode')
  if (fromQuery) return fromQuery
  if (req.method !== 'POST') return ''
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && typeof body.mode === 'string' ? body.mode : ''
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function monthPeriod(todayIso: string) {
  return `${todayIso.slice(0, 7)}-01`
}

function snapshotRow(
  siteId: string | null,
  section: {
    requiredCount: number
    compliantCount: number
    expiringCount: number
    expiredCount: number
    missingCount: number
    percent: number | null
  },
) {
  return {
    site_id: siteId,
    compliant: section.compliantCount,
    expiring: section.expiringCount,
    expired: section.expiredCount,
    missing: section.missingCount,
    // Every slot is Valid, Expiring soon, Expired, Missing, or Recheck due.
    recheck_due:
      section.requiredCount -
      section.compliantCount -
      section.expiringCount -
      section.expiredCount -
      section.missingCount,
    total_required: section.requiredCount,
    percent: section.percent,
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  if (!hasCronSecretKey(req)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const mode = await requestMode(req)
  if (mode && mode !== 'snapshot_only') {
    return json({ error: `Unknown mode: ${mode}` }, 400)
  }
  const snapshotOnly = mode === 'snapshot_only'

  if (!snapshotOnly && !resendApiKey) {
    return json({ error: 'Missing RESEND_API_KEY' }, 500)
  }

  if (!snapshotOnly && !fromEmail) {
    return json({ error: 'Missing RESEND_FROM_EMAIL' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const todayIso = todaySydney()
  const month = monthLabel(todayIso)
  const asAt = asAtLabel(todayIso)
  const period = monthPeriod(todayIso)
  const ownerEmailCache = new Map<string, string | null>()

  const summary = {
    mode: snapshotOnly ? 'snapshot_only' : 'report',
    period,
    sent: 0,
    skipped: 0,
    snapshots: 0,
    already_sent: [] as string[],
    stale_claims_cleared: [] as StaleClaim[],
    errors: [] as string[],
    snapshot_errors: [] as string[],
  }

  if (!snapshotOnly) {
    const staleClaims = await clearStaleClaims(supabase, 'monthly_report')
    summary.stale_claims_cleared = staleClaims.cleared
    if (staleClaims.error) {
      summary.errors.push(`Failed to clear stale report claims: ${staleClaims.error}`)
    }
  }

  async function ownerEmail(ownerId: string): Promise<string | null> {
    if (ownerEmailCache.has(ownerId)) {
      return ownerEmailCache.get(ownerId) ?? null
    }

    const { data, error } = await retryOnJwtSkew(
      () => supabase.auth.admin.getUserById(ownerId),
      'owner lookup',
    )
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
    retryOnJwtSkew(
      () => supabase.from('organizations').select('id, name, owner_id, alert_email'),
      'organizations',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('sites')
          .select('id, name, org_id, archived_at')
          .is('archived_at', null)
          .order('name', { ascending: true }),
      'sites',
    ),
    retryOnJwtSkew(
      () =>
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
      'staff',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('requirement_types')
          .select('id, name, org_id, mandatory, applies_to, perpetual, archived_at')
          .is('archived_at', null),
      'requirement_types',
    ),
    retryOnJwtSkew(
      () =>
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
      'compliance_items',
    ),
    retryOnJwtSkew(
      () => supabase.from('staff_requirement_exclusions').select('staff_id, requirement_type_id'),
      'staff_requirement_exclusions',
    ),
    retryOnJwtSkew(
      () => supabase.from('site_requirement_exclusions').select('site_id, requirement_type_id'),
      'site_requirement_exclusions',
    ),
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
    let report: ReturnType<typeof buildProviderComplianceReport>
    try {
      report = buildProviderComplianceReport({
        staff: staffByOrg.get(org.id) ?? [],
        sites: sitesByOrg.get(org.id) ?? [],
        items: itemsByOrg.get(org.id) ?? [],
        requirementTypes: typesByOrg.get(org.id) ?? [],
        exclusions: staffExclusionsByOrg.get(org.id) ?? [],
        siteExclusions: siteExclusionsByOrg.get(org.id) ?? [],
        todayIso,
      })
    } catch (error) {
      const message = errorMessage(error)
      summary.errors.push(`Failed to build report for org ${org.id}: ${message}`)
      summary.snapshot_errors.push(`Failed to build report for org ${org.id}: ${message}`)
      continue
    }

    try {
      const rows = [
        snapshotRow(null, report.org),
        ...report.sites.map((section) => snapshotRow(section.id, section)),
      ]
      const { error: snapshotError } = await supabase.rpc('upsert_compliance_snapshots', {
        p_org_id: org.id,
        p_period: period,
        p_rows: rows,
      })
      if (snapshotError) throw snapshotError
      summary.snapshots += 1
    } catch (error) {
      const message = errorMessage(error)
      summary.snapshot_errors.push(`Failed to snapshot org ${org.id}: ${message}`)
    }

    if (snapshotOnly) continue

    let claimId: string | null = null
    try {
      const to =
        org.alert_email?.trim() ||
        (org.owner_id ? await ownerEmail(org.owner_id) : null)
      if (!to) {
        summary.skipped += 1
        summary.errors.push(`No alert email for org ${org.id}`)
        continue
      }

      const claim = await claimSend(supabase, { orgId: org.id, kind: 'monthly_report', period })
      if (claim.alreadyClaimed) {
        summary.already_sent.push(org.id)
        continue
      }
      if (!claim.id) {
        summary.errors.push(`Failed to claim report for ${org.name}: ${claim.error}`)
        continue
      }
      claimId = claim.id

      const { error: sendError } = await sendResendEmail({
        apiKey: resendApiKey as string,
        from: fromEmail as string,
        to,
        subject: `Monthly compliance report — ${org.name} — as at ${asAt}`,
        html: reportHtml(org.name, month, report),
      })

      if (sendError) {
        const releaseError = await releaseClaim(supabase, claimId)
        claimId = null
        summary.errors.push(
          `Failed to email ${org.name}: ${sendError.message}` +
            (releaseError ? ` (release failed: ${releaseError})` : ''),
        )
        continue
      }

      const sentClaimId = claimId
      claimId = null
      const markError = await markSent(supabase, sentClaimId)
      if (markError) {
        summary.errors.push(`Sent report but failed to mark it sent for ${org.name}: ${markError}`)
      }

      summary.sent += 1
    } catch (error) {
      const message = errorMessage(error)
      const releaseError = claimId ? await releaseClaim(supabase, claimId) : null
      summary.errors.push(
        `Failed to email ${org.name}: ${message}` +
          (releaseError ? ` (release failed: ${releaseError})` : ''),
      )
    }
  }

  return json(summary)
})
