import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { selectAllPages, selectInBatches } from '../_shared/batch.ts'
import { hasCronSecretKey } from '../_shared/cronAuth.ts'
import { dueByFor, dueStatusAt, templateTakesDueBy } from '../_shared/formDueTimes.js'
import { scheduleEnabled } from '../_shared/formSchedule.js'
import { ownerLoginEmail } from '../_shared/ownerEmail.ts'
import { retryOnJwtSkew } from '../_shared/retry.ts'
import { isSiteOpenOn } from '../_shared/siteOpen.js'
import {
  formatTimeOfDay,
  sydneyMinutesOfDay,
  sydneyToday,
} from '../_shared/sydneyTime.js'

// Scheduled by supabase/cron_jobs.sql (rtc-form-overdue-alerts).
// Same-day centre email when a daily form passes its due-by.

const STALE_CLAIM_MINUTES = 10
const FIRST_MINUTE = 5 * 60
const LAST_MINUTE = 22 * 60

// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any, any, any>

type StaleClaim = { id: string; org_id: string; site_id: string; created_at: string }

export function insideAlertHours(now = new Date()) {
  const minutes = sydneyMinutesOfDay(now)
  return minutes != null && minutes >= FIRST_MINUTE && minutes <= LAST_MINUTE
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sameId(left: unknown, right: unknown) {
  return left != null && right != null && String(left) === String(right)
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function lineFor(formName: string, siteName: string, dueBy: string) {
  return `${formName} at ${siteName} is not done — it was due at ${formatTimeOfDay(dueBy)}. Open RoadToComply on the centre tablet (the floor link) to complete it.`
}

function emailHtml(lines: string[]) {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
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
    return { error: new Error(payload?.message ?? `Resend request failed (${response.status})`) }
  }
  return { error: null }
}

async function clearStaleClaims(supabase: Supabase) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString()
  const { data, error } = await retryOnJwtSkew(
    () =>
      supabase
        .from('form_overdue_alerts')
        .select('id, org_id, site_id, created_at')
        .eq('status', 'sending')
        .lt('created_at', cutoff),
    'stale form_overdue_alerts',
  )
  if (error) return { cleared: [] as StaleClaim[], error: error.message ?? 'unknown error' }

  const rows = (data ?? []) as StaleClaim[]
  if (!rows.length) return { cleared: [] as StaleClaim[], error: null as string | null }

  const { error: deleteError } = await supabase
    .from('form_overdue_alerts')
    .delete()
    .in(
      'id',
      rows.map((row) => row.id),
    )
  if (deleteError) return { cleared: [] as StaleClaim[], error: deleteError.message ?? 'unknown error' }
  return { cleared: rows, error: null as string | null }
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

  if (!resendApiKey) {
    return json({ error: 'Missing RESEND_API_KEY' }, 500)
  }

  if (!fromEmail) {
    return json({ error: 'Missing RESEND_FROM_EMAIL' }, 500)
  }

  const now = new Date()
  if (!insideAlertHours(now)) {
    return json({ skipped: 'outside_hours' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const today = sydneyToday()
  if (!today) return json({ error: 'Could not resolve today’s date.' }, 500)

  const summary = {
    sent: 0,
    skipped: 0,
    already_sent: [] as string[],
    stale_claims_cleared: [] as StaleClaim[],
    errors: [] as string[],
  }

  const stale = await clearStaleClaims(supabase)
  summary.stale_claims_cleared = stale.cleared
  if (stale.error) summary.errors.push(`Failed to clear stale claims: ${stale.error}`)

  const orgsResult = await retryOnJwtSkew(
    () =>
      supabase
        .from('organizations')
        .select('id, name, alert_email, plan, owner_id')
        .in('plan', ['plus', 'pro']),
    'plus orgs',
  )
  if (orgsResult.error) {
    return json({ error: orgsResult.error.message ?? 'Failed to load organisations' }, 500)
  }
  const orgs = orgsResult.data ?? []
  if (!orgs.length) return json(summary)

  const orgIds = orgs.map((org) => org.id as string)
  const orgById = new Map(orgs.map((org) => [org.id as string, org]))

  const [sitesResult, templatesResult] = await Promise.all([
    selectInBatches(
      orgIds,
      (batch) =>
        supabase
          .from('sites')
          .select('id, name, org_id, alert_email, operating_days, archived_at')
          .in('org_id', batch)
          .is('archived_at', null),
      'sites',
    ),
    retryOnJwtSkew(
      () =>
        supabase
          .from('form_templates')
          .select('id, name, cadence, category, scope, default_due_by, archived_at')
          .is('archived_at', null)
          .eq('cadence', 'daily')
          .eq('scope', 'all_sites'),
      'daily templates',
    ),
  ])
  if (sitesResult.error) {
    return json({ error: sitesResult.error.message ?? 'Failed to load sites' }, 500)
  }
  if (templatesResult.error) {
    return json({ error: templatesResult.error.message ?? 'Failed to load templates' }, 500)
  }

  const sites = sitesResult.data ?? []
  const templates = (templatesResult.data ?? []).filter(templateTakesDueBy)
  if (!sites.length || !templates.length) return json(summary)

  const siteIds = sites.map((site) => site.id as string)
  const templateIds = templates.map((template) => template.id as string)

  const [exclusionsResult, closuresResult, submissionsResult, dueTimesResult, claimsResult, schedulesResult] =
    await Promise.all([
      selectInBatches(
        orgIds,
        (batch) =>
          supabase
            .from('form_site_exclusions')
            .select('site_id, template_id')
            .in('org_id', batch),
        'exclusions',
      ),
      selectInBatches(
        siteIds,
        (batch) =>
          supabase
            .from('site_closures')
            .select('site_id, closure_date')
            .in('site_id', batch)
            .eq('closure_date', today),
        'closures',
      ),
      (async () => {
        const rows: { site_id: string; template_id: string }[] = []
        for (let index = 0; index < siteIds.length; index += 100) {
          const batch = siteIds.slice(index, index + 100)
          const page = await selectAllPages(
            (from, to) =>
              supabase
                .from('form_submissions')
                .select('id, site_id, template_id, status, for_date')
                .in('site_id', batch)
                .in('template_id', templateIds)
                .in('status', ['complete', 'missed'])
                .eq('for_date', today)
                .order('id', { ascending: true })
                .range(from, to),
            'today submissions',
          )
          if (page.error) return { data: null, error: page.error }
          rows.push(...(page.data ?? []))
        }
        return { data: rows, error: null }
      })(),
      selectInBatches(
        orgIds,
        (batch) =>
          supabase
            .from('form_site_due_times')
            .select('org_id, site_id, template_id, due_by')
            .in('org_id', batch),
        'due times',
      ),
      selectInBatches(
        siteIds,
        (batch) =>
          supabase
            .from('form_overdue_alerts')
            .select('site_id, template_id, for_date')
            .in('site_id', batch)
            .eq('for_date', today),
        'existing claims',
      ),
      selectInBatches(
        orgIds,
        (batch) =>
          supabase
            .from('form_org_schedule')
            .select('org_id, template_id, enabled')
            .in('org_id', batch),
        'org schedule',
      ),
    ])

  const loadError =
    exclusionsResult.error ||
    closuresResult.error ||
    submissionsResult.error ||
    dueTimesResult.error ||
    claimsResult.error ||
    schedulesResult.error
  if (loadError) {
    return json({ error: loadError.message ?? 'Failed to load overdue forms' }, 500)
  }

  const exclusions = exclusionsResult.data ?? []
  const closures = (closuresResult.data ?? []).map((row) => ({
    site_id: row.site_id as string,
    closure_date: String(row.closure_date).slice(0, 10),
  }))
  const doneToday = new Set(
    (submissionsResult.data ?? []).map(
      (row) => `${row.site_id}:${row.template_id}`,
    ),
  )
  const alreadyClaimed = new Set(
    (claimsResult.data ?? []).map((row) => `${row.site_id}:${row.template_id}`),
  )
  const dueTimes = dueTimesResult.data ?? []
  const scheduleByOrgTemplate = new Map(
    (schedulesResult.data ?? []).map((row) => [`${row.org_id}:${row.template_id}`, row]),
  )

  const ownerEmails = new Map<string, string | null>()
  for (const org of orgs) {
    const ownerId = org.owner_id as string | null
    if (!ownerId) continue
    const needsOwner = sites.some(
      (site) =>
        sameId(site.org_id, org.id) &&
        !String(site.alert_email || '').trim() &&
        !String(org.alert_email || '').trim(),
    )
    if (!needsOwner) continue
    const lookedUp = await retryOnJwtSkew(
      () => ownerLoginEmail(supabase, ownerId),
      'owner lookup',
    )
    ownerEmails.set(org.id as string, lookedUp.error ? null : lookedUp.email)
  }

  type OverdueItem = {
    orgId: string
    siteId: string
    siteName: string
    templateId: string
    templateName: string
    dueBy: string
    to: string
  }

  const bySite = new Map<string, OverdueItem[]>()
  for (const site of sites) {
    const org = orgById.get(site.org_id as string)
    if (!org) continue
    if (
      !isSiteOpenOn({
        operatingDays: site.operating_days,
        closures,
        siteId: site.id as string,
        day: today,
      })
    ) {
      continue
    }

    const to = String(
      site.alert_email || org.alert_email || ownerEmails.get(org.id as string) || '',
    ).trim()
    const orgDueTimes = dueTimes.filter((row) => sameId(row.org_id, site.org_id))

    for (const template of templates) {
      if (
        !scheduleEnabled(
          template,
          scheduleByOrgTemplate.get(`${site.org_id}:${template.id}`),
        )
      ) {
        continue
      }
      if (
        exclusions.some(
          (row) =>
            sameId(row.site_id, site.id) && sameId(row.template_id, template.id),
        )
      ) {
        continue
      }
      const key = `${site.id}:${template.id}`
      if (doneToday.has(key) || alreadyClaimed.has(key)) continue
      const dueBy = dueByFor(template, site.id, orgDueTimes).dueBy
      if (!dueBy) continue
      if (dueStatusAt({ status: 'due', dueBy, forDate: today, now }) !== 'overdue') continue
      if (!to) {
        summary.skipped += 1
        summary.errors.push(`No alert email for site ${site.id}`)
        continue
      }
      const list = bySite.get(site.id as string) ?? []
      list.push({
        orgId: site.org_id as string,
        siteId: site.id as string,
        siteName: String(site.name || 'Site'),
        templateId: template.id as string,
        templateName: String(template.name || 'Form'),
        dueBy,
        to,
      })
      bySite.set(site.id as string, list)
    }
  }

  for (const items of bySite.values()) {
    const claimed: { id: string; item: OverdueItem }[] = []
    for (const item of items) {
      const { data, error } = await supabase
        .from('form_overdue_alerts')
        .insert({
          org_id: item.orgId,
          site_id: item.siteId,
          template_id: item.templateId,
          for_date: today,
          status: 'sending',
        })
        .select('id')
        .single()
      if (error?.code === '23505') {
        summary.already_sent.push(`${item.siteId}:${item.templateId}`)
        continue
      }
      if (error || !data?.id) {
        summary.errors.push(
          `Failed to claim ${item.templateName} at ${item.siteName}: ${error?.message ?? 'no id'}`,
        )
        continue
      }
      claimed.push({ id: data.id as string, item })
    }

    if (!claimed.length) continue

    const first = claimed[0].item
    const lines = claimed.map(({ item }) => lineFor(item.templateName, item.siteName, item.dueBy))
    const subject =
      claimed.length === 1
        ? `${first.templateName} at ${first.siteName} is overdue`
        : `${claimed.length} forms overdue at ${first.siteName}`

    let sendError: Error | null
    try {
      ;({ error: sendError } = await sendResendEmail({
        apiKey: resendApiKey,
        from: fromEmail,
        to: first.to,
        subject,
        html: emailHtml(lines),
      }))
    } catch (error) {
      sendError = new Error(errorMessage(error))
    }

    if (sendError) {
      const { error: releaseError } = await supabase
        .from('form_overdue_alerts')
        .delete()
        .in(
          'id',
          claimed.map((row) => row.id),
        )
      summary.errors.push(
        `Failed to email ${first.siteName}: ${sendError.message}` +
          (releaseError ? ` (release failed: ${releaseError.message})` : ''),
      )
      continue
    }

    const sentAt = new Date().toISOString()
    const { error: markError } = await supabase
      .from('form_overdue_alerts')
      .update({ status: 'sent', sent_at: sentAt })
      .in(
        'id',
        claimed.map((row) => row.id),
      )
    if (markError) {
      summary.errors.push(`Sent ${first.siteName} but failed to mark it sent: ${markError.message}`)
    }
    summary.sent += 1
  }

  return json(summary)
})
