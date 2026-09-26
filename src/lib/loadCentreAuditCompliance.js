import { supabase } from './supabase'
import { todayIsoDate } from './compliance'
import { auditCompliancePercent } from './formMetrics'
import {
  isFormSiteExcluded,
  isScheduledAllSitesTemplate,
  listFormOrgSchedules,
  listFormSiteExclusions,
  listFormTemplates,
} from './forms'
import { effectiveCadenceMonths, scheduleEnabled } from './formSchedule'
import { fetchAllPages, firstError } from './query'
import { listSiteClosuresForSites } from './sites'

function yearOf(today) {
  return today.slice(0, 4)
}

async function completeSubmissionsForTemplates(orgId, siteId, templateIds, from, to) {
  const rows = []
  for (let index = 0; index < templateIds.length; index += 100) {
    const batch = templateIds.slice(index, index + 100)
    const page = await fetchAllPages(() =>
      supabase
        .from('form_submissions')
        .select('id, site_id, template_id, status, for_date, submitted_at')
        .eq('org_id', orgId)
        .eq('site_id', siteId)
        .eq('status', 'complete')
        .in('template_id', batch)
        .gte('for_date', from)
        .lte('for_date', to),
    )
    if (page.error) return page
    rows.push(...(page.data ?? []))
  }
  return { data: rows, error: null }
}

export async function loadCentreAuditCompliance(orgId, site, today = todayIsoDate()) {
  if (!orgId || !site?.id) return { data: { owed: 0, onTime: 0, percent: null }, error: null }

  const [templatesResult, schedulesResult, exclusionsResult, orgResult, closuresResult] =
    await Promise.all([
      listFormTemplates(),
      listFormOrgSchedules(orgId),
      listFormSiteExclusions(orgId),
      supabase.from('organizations').select('audit_tracking_start').eq('id', orgId).maybeSingle(),
      listSiteClosuresForSites([site.id], { from: `${yearOf(today)}-01-01`, to: today }),
    ])
  const setupError = firstError(
    templatesResult,
    schedulesResult,
    exclusionsResult,
    orgResult,
    closuresResult,
  )
  if (setupError) return { data: null, error: setupError }

  const scheduleByTemplate = new Map(
    (schedulesResult.data ?? []).map((row) => [String(row.template_id), row]),
  )
  const exclusions = exclusionsResult.data ?? []
  const templates = (templatesResult.data ?? [])
    .filter((template) => template.category === 'audit')
    .filter(isScheduledAllSitesTemplate)
    .filter((template) => scheduleEnabled(template, scheduleByTemplate.get(String(template.id))))
    .filter((template) => !isFormSiteExcluded(exclusions, site.id, template.id))
    .map((template) => ({
      ...template,
      cadence_months: effectiveCadenceMonths(template, scheduleByTemplate.get(String(template.id))),
    }))

  const trackingStart = orgResult.data?.audit_tracking_start
    ? String(orgResult.data.audit_tracking_start).slice(0, 10)
    : null
  const yearStart = `${yearOf(today)}-01-01`
  const submissionResult = templates.length
    ? await completeSubmissionsForTemplates(
        orgId,
        site.id,
        templates.map((template) => template.id),
        yearStart,
        today,
      )
    : { data: [], error: null }
  if (submissionResult.error) return { data: null, error: submissionResult.error }

  return {
    data: auditCompliancePercent({
      site,
      templates,
      trackingStart,
      closures: closuresResult.data ?? [],
      submissions: submissionResult.data ?? [],
      today,
    }),
    error: null,
  }
}
