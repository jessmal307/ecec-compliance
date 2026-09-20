import { createClient } from 'npm:@supabase/supabase-js@2'

const ALERT_TIME_ZONE = 'Australia/Sydney'
const EXPIRY_KINDS = ['renewal', 'expired'] as const

type AlertKind = 'renewal' | 'expired' | 'recheck'

type ComplianceItemRow = {
  id: string
  expiry_date: string
  last_verified_date: string | null
  created_at: string | null
  org_id: string
  label: string
  staff_id: string | null
  site_id: string | null
  archived_at: string | null
  requirement_types: {
    name: string
    renewal_lead_days: number | null
    recheck_interval_days: number | null
  } | null
  staff: { name: string; archived_at: string | null } | null
  sites: { name: string; archived_at: string | null } | null
}

type OrganizationRow = {
  id: string
  name: string
  owner_id: string
  alert_email: string | null
}

type PendingAlert = {
  item: ComplianceItemRow
  kind: AlertKind
  leadDays?: number
  recheckDays?: number
}

type StaffSite = {
  id: string
  name: string
}

type DigestSection = {
  key: string
  name: string
  entries: PendingAlert[]
}

function isArchived(value: string | null | undefined): boolean {
  return value != null && value !== ''
}

function isAlertableItem(item: ComplianceItemRow): boolean {
  if (isArchived(item.archived_at)) return false
  if (isArchived(item.staff?.archived_at)) return false
  if (isArchived(item.sites?.archived_at)) return false
  return true
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  return dateInTimeZone(new Date(), ALERT_TIME_ZONE)
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: ALERT_TIME_ZONE,
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function asNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const days = Number(value)
  if (!Number.isInteger(days) || days < 0) return null
  return days
}

function renewalLeadDays(item: ComplianceItemRow): number | null {
  return asNonNegativeInt(item.requirement_types?.renewal_lead_days)
}

function recheckIntervalDays(item: ComplianceItemRow): number | null {
  return asNonNegativeInt(item.requirement_types?.recheck_interval_days)
}

function dueExpiryKinds(item: ComplianceItemRow, today: string, leadDays: number): AlertKind[] {
  const kinds: AlertKind[] = []
  if (item.expiry_date <= addDays(today, leadDays)) {
    kinds.push('renewal')
  }
  if (item.expiry_date <= today) {
    kinds.push('expired')
  }
  return kinds
}

function recheckBaseDate(item: ComplianceItemRow): string | null {
  if (item.last_verified_date) return item.last_verified_date
  if (item.created_at) return timestampDate(item.created_at)
  return null
}

function isRecheckDue(item: ComplianceItemRow, today: string, intervalDays: number): boolean {
  const baseDate = recheckBaseDate(item)
  if (!baseDate) return false
  return today >= addDays(baseDate, intervalDays)
}

function timestampDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return dateInTimeZone(date, ALERT_TIME_ZONE)
}

function kindLabel(kind: AlertKind): string {
  if (kind === 'expired') return 'Expired'
  if (kind === 'recheck') return 'Recheck due'
  return 'Renewal due'
}

function ownerName(item: ComplianceItemRow): string {
  return item.staff?.name ?? item.sites?.name ?? 'Unknown'
}

function requirementName(item: ComplianceItemRow): string {
  return item.requirement_types?.name ?? item.label ?? 'Requirement'
}

function itemDetail(entry: PendingAlert): string {
  if (entry.kind === 'recheck') {
    const verifiedOn = entry.item.last_verified_date
      ? `Last verified ${formatDate(entry.item.last_verified_date)}`
      : entry.item.created_at
        ? `Recorded ${formatDate(timestampDate(entry.item.created_at))}`
        : 'Not yet verified'
    return `${verifiedOn}. Recheck interval is ${entry.recheckDays} days.`
  }

  if (entry.kind === 'expired') {
    return `Expired ${formatDate(entry.item.expiry_date)}.`
  }

  return `Expires ${formatDate(entry.item.expiry_date)} (within the ${entry.leadDays}-day renewal window).`
}

function sortEntries(entries: PendingAlert[]): PendingAlert[] {
  return [...entries].sort((a, b) => {
    const aExpired = a.kind === 'expired' ? 0 : 1
    const bExpired = b.kind === 'expired' ? 0 : 1
    if (aExpired !== bExpired) return aExpired - bExpired
    const dateDiff = a.item.expiry_date.localeCompare(b.item.expiry_date)
    if (dateDiff !== 0) return dateDiff
    const requirementDiff = requirementName(a.item).localeCompare(requirementName(b.item))
    if (requirementDiff !== 0) return requirementDiff
    return ownerName(a.item).localeCompare(ownerName(b.item))
  })
}

function groupEntriesBySite(
  entries: PendingAlert[],
  sitesByStaffId: Map<string, StaffSite[]>,
): DigestSection[] {
  const sections = new Map<string, DigestSection>()

  function addToSection(key: string, name: string, entry: PendingAlert) {
    const current = sections.get(key) ?? { key, name, entries: [] }
    current.entries.push(entry)
    sections.set(key, current)
  }

  for (const entry of entries) {
    if (entry.item.site_id) {
      addToSection(entry.item.site_id, entry.item.sites?.name ?? 'Unknown', entry)
      continue
    }

    const assigned = entry.item.staff_id
      ? (sitesByStaffId.get(entry.item.staff_id) ?? [])
      : []
    if (assigned.length === 0) {
      addToSection('unassigned', 'Unassigned staff', entry)
      continue
    }

    for (const site of assigned) {
      addToSection(site.id, site.name, entry)
    }
  }

  const named = [...sections.values()]
    .filter((section) => section.key !== 'unassigned')
    .sort((a, b) => a.name.localeCompare(b.name))
  const unassigned = sections.get('unassigned')
  return unassigned ? [...named, unassigned] : named
}

function renderEntry(entry: PendingAlert): string {
  const status = escapeHtml(kindLabel(entry.kind))
  const requirement = escapeHtml(requirementName(entry.item))
  const detail = escapeHtml(itemDetail(entry))
  const staffName = entry.item.staff_id
    ? `${escapeHtml(ownerName(entry.item))} — `
    : ''
  return `<li><strong>${status}:</strong> ${staffName}${requirement} — ${detail}</li>`
}

function digestHtml(
  orgName: string,
  entries: PendingAlert[],
  sitesByStaffId: Map<string, StaffSite[]>,
): string {
  const count = entries.length
  const itemWord = count === 1 ? 'item' : 'items'
  const sections = groupEntriesBySite(entries, sitesByStaffId)
    .map((section) => {
      const rows = sortEntries(section.entries).map(renderEntry).join('')
      return `<h2>${escapeHtml(section.name)}</h2><ul>${rows}</ul>`
    })
    .join('')

  return `
    <p>${escapeHtml(String(count))} compliance ${itemWord} newly need attention for ${escapeHtml(orgName)}.</p>
    ${sections}
  `
}

function alertKey(itemId: string, kind: AlertKind) {
  return `${itemId}:${kind}`
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
  const today = todaySydney()
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

  const { data: items, error: itemsError } = await supabase
    .from('compliance_items')
    .select(
      `
      id,
      expiry_date,
      last_verified_date,
      created_at,
      org_id,
      label,
      staff_id,
      site_id,
      archived_at,
      requirement_types ( name, renewal_lead_days, recheck_interval_days ),
      staff ( name, archived_at ),
      sites ( name, archived_at )
    `,
    )
    .is('archived_at', null)

  if (itemsError) {
    return json({ error: `Failed to load compliance items: ${itemsError.message}` }, 500)
  }

  const allItems = ((items ?? []) as ComplianceItemRow[]).filter(isAlertableItem)
  const pending: PendingAlert[] = []

  const expiryEligible: { item: ComplianceItemRow; leadDays: number; kinds: AlertKind[] }[] = []
  for (const item of allItems) {
    const leadDays = renewalLeadDays(item)
    if (leadDays === null) continue
    const kinds = dueExpiryKinds(item, today, leadDays)
    if (kinds.length === 0) continue
    expiryEligible.push({ item, leadDays, kinds })
  }

  if (expiryEligible.length > 0) {
    const expiryItemIds = [...new Set(expiryEligible.map((entry) => entry.item.id))]
    const { data: existingExpiryAlerts, error: expiryAlertsError } = await supabase
      .from('alerts')
      .select('compliance_item_id, threshold')
      .in('compliance_item_id', expiryItemIds)
      .in('threshold', EXPIRY_KINDS)

    if (expiryAlertsError) {
      return json({ error: `Failed to load expiry alerts: ${expiryAlertsError.message}` }, 500)
    }

    const alreadySentExpiry = new Set(
      (existingExpiryAlerts ?? []).map(
        (row: { compliance_item_id: string; threshold: AlertKind }) =>
          alertKey(row.compliance_item_id, row.threshold),
      ),
    )

    for (const entry of expiryEligible) {
      for (const kind of entry.kinds) {
        if (alreadySentExpiry.has(alertKey(entry.item.id, kind))) {
          summary.skipped += 1
          continue
        }
        pending.push({ item: entry.item, kind, leadDays: entry.leadDays })
      }
    }
  }

  const recheckEligible: { item: ComplianceItemRow; recheckDays: number }[] = []
  for (const item of allItems) {
    const intervalDays = recheckIntervalDays(item)
    if (intervalDays === null) continue
    if (!isRecheckDue(item, today, intervalDays)) continue
    recheckEligible.push({ item, recheckDays: intervalDays })
  }

  if (recheckEligible.length > 0) {
    const recheckItemIds = [...new Set(recheckEligible.map((entry) => entry.item.id))]
    const { data: existingRecheckAlerts, error: recheckAlertsError } = await supabase
      .from('alerts')
      .select('compliance_item_id, threshold, sent_at')
      .in('compliance_item_id', recheckItemIds)
      .eq('threshold', 'recheck')

    if (recheckAlertsError) {
      return json({ error: `Failed to load recheck alerts: ${recheckAlertsError.message}` }, 500)
    }

    for (const entry of recheckEligible) {
      const baseDate = recheckBaseDate(entry.item)
      const alreadySentSinceVerified = (existingRecheckAlerts ?? []).some(
        (row: { compliance_item_id: string; sent_at: string | null }) =>
          row.compliance_item_id === entry.item.id &&
          Boolean(baseDate) &&
          timestampDate(row.sent_at) >= baseDate,
      )

      if (alreadySentSinceVerified) {
        summary.skipped += 1
        continue
      }

      pending.push({ item: entry.item, kind: 'recheck', recheckDays: entry.recheckDays })
    }
  }

  if (pending.length === 0) {
    return json(summary)
  }

  const staffIds = [
    ...new Set(
      pending
        .map((entry) => entry.item.staff_id)
        .filter((staffId): staffId is string => Boolean(staffId)),
    ),
  ]
  const sitesByStaffId = new Map<string, StaffSite[]>()

  if (staffIds.length > 0) {
    const { data: staffSites, error: staffSitesError } = await supabase
      .from('staff_sites')
      .select('staff_id, site_id, sites ( name, archived_at )')
      .in('staff_id', staffIds)

    if (staffSitesError) {
      return json({ error: `Failed to load staff sites: ${staffSitesError.message}` }, 500)
    }

    for (const row of (staffSites ?? []) as {
      staff_id: string
      site_id: string
      sites: { name: string; archived_at: string | null } | null
    }[]) {
      if (isArchived(row.sites?.archived_at)) continue
      const assigned = sitesByStaffId.get(row.staff_id) ?? []
      if (assigned.some((site) => site.id === row.site_id)) continue
      assigned.push({ id: row.site_id, name: row.sites?.name ?? 'Unknown' })
      sitesByStaffId.set(row.staff_id, assigned)
    }
  }

  const orgIds = [...new Set(pending.map((entry) => entry.item.org_id))]
  const { data: organizations, error: orgsError } = await supabase
    .from('organizations')
    .select('id, name, owner_id, alert_email')
    .in('id', orgIds)

  if (orgsError) {
    return json({ error: `Failed to load organizations: ${orgsError.message}` }, 500)
  }

  const orgById = new Map(
    ((organizations ?? []) as OrganizationRow[]).map((org) => [org.id, org]),
  )

  const pendingByOrg = new Map<string, PendingAlert[]>()
  for (const entry of pending) {
    const current = pendingByOrg.get(entry.item.org_id) ?? []
    current.push(entry)
    pendingByOrg.set(entry.item.org_id, current)
  }

  for (const [orgId, entries] of pendingByOrg) {
    const org = orgById.get(orgId)
    if (!org?.owner_id) {
      summary.errors.push(`No organization owner for org ${orgId}`)
      continue
    }

    const configuredAlertEmail = org.alert_email?.trim()
    const to = configuredAlertEmail || (await ownerEmail(org.owner_id))
    if (!to) {
      summary.errors.push(`No alert email for org ${orgId}`)
      continue
    }

    const count = entries.length
    const itemWord = count === 1 ? 'item' : 'items'
    const subject = `Compliance digest: ${count} ${itemWord} need attention — ${org.name}`

    const { error: sendError } = await sendResendEmail({
      apiKey: resendApiKey,
      from: fromEmail,
      to,
      subject,
      html: digestHtml(org.name, entries, sitesByStaffId),
    })

    if (sendError) {
      summary.errors.push(`Failed to email digest for org ${orgId}: ${sendError.message}`)
      continue
    }

    const sentAt = new Date().toISOString()
    const { error: insertError } = await supabase.from('alerts').insert(
      entries.map((entry) => ({
        compliance_item_id: entry.item.id,
        threshold: entry.kind,
        sent_at: sentAt,
      })),
    )

    if (insertError) {
      summary.errors.push(
        `Sent digest but failed to record alerts for org ${orgId}: ${insertError.message}`,
      )
      continue
    }

    summary.sent += 1
  }

  return json(summary)
})
