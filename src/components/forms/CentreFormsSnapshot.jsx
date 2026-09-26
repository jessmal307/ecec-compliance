import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageError } from '../ui/page'
import { listFormActions } from '../../lib/formActions'
import { computeDueForms, computeOverdueForms, listFormTemplates } from '../../lib/forms'
import { formatDate } from '../../lib/format'
import { loadCentreAuditCompliance } from '../../lib/loadCentreAuditCompliance'
import { firstError } from '../../lib/query'
import { todayIsoDate } from '../../lib/compliance'
import { paths } from '../../lib/paths'
import { formatTimeOfDay } from '../../lib/sydneyTime'

function overdueKey(row) {
  return `${row.template_id}:${row.for_date || row.period_start || ''}`
}

function nextOutstanding(rows) {
  const open = rows.filter((row) => row.status === 'due' || row.status === 'overdue')
  open.sort((left, right) => {
    if (left.status !== right.status) return left.status === 'overdue' ? -1 : 1
    return String(left.for_date || '').localeCompare(String(right.for_date || ''))
  })
  return open[0] ?? null
}

function whenLabel(row) {
  if (row.status === 'overdue') return 'Overdue'
  const date = row.for_date ? formatDate(row.for_date) : 'Due'
  return row.due_by ? `${date} · due by ${formatTimeOfDay(row.due_by)}` : date
}

function Figure({ label, value, onClick }) {
  const className = 'rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left'
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </>
  )
  if (!onClick) return <div className={className}>{body}</div>
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  )
}

export function CentreFormsSnapshot({
  organizationId,
  site,
  requirementPercent,
  onOpenRequirements,
  onOpenForms,
  onOpenActions,
}) {
  const [auditPercent, setAuditPercent] = useState(null)
  const [overdueAudits, setOverdueAudits] = useState(0)
  const [openActions, setOpenActions] = useState(0)
  const [nextDue, setNextDue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId || !site?.id) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const today = todayIsoDate()
      const [auditResult, dueResult, overdueResult, actionsResult, templatesResult] =
        await Promise.all([
          loadCentreAuditCompliance(organizationId, site, today),
          computeDueForms(organizationId, today),
          computeOverdueForms(organizationId, today),
          listFormActions(organizationId, { siteId: site.id, status: 'open' }),
          listFormTemplates(),
        ])
      if (cancelled) return
      const loadError = firstError(auditResult, dueResult, overdueResult, actionsResult, templatesResult)
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }
      const auditIds = new Set(
        (templatesResult.data ?? [])
          .filter((template) => template.category === 'audit')
          .map((template) => template.id),
      )
      const seen = new Set()
      let overdueCount = 0
      for (const row of [...(dueResult.data ?? []), ...(overdueResult.data ?? [])]) {
        if (String(row.site_id) !== String(site.id)) continue
        if (!auditIds.has(row.template_id)) continue
        if (row.status && row.status !== 'overdue') continue
        const key = overdueKey(row)
        if (seen.has(key)) continue
        seen.add(key)
        overdueCount += 1
      }
      const actions = actionsResult.data ?? []
      setAuditPercent(auditResult.data?.percent ?? null)
      setOverdueAudits(overdueCount)
      setOpenActions(actions.length)
      setNextDue(
        nextOutstanding((dueResult.data ?? []).filter((row) => String(row.site_id) === String(site.id))),
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [organizationId, site])

  return (
    <div className="flex flex-col gap-3">
      <PageError>{error}</PageError>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure
          label="Requirements"
          value={`${requirementPercent}%`}
          onClick={onOpenRequirements}
        />
        <Figure label="Audits" value={loading ? '…' : auditPercent == null ? '—' : `${auditPercent}%`} />
        <Figure
          label="Audits overdue"
          value={loading ? '…' : String(overdueAudits)}
          onClick={onOpenForms}
        />
        <Figure
          label="Open actions"
          value={loading ? '…' : String(openActions)}
          onClick={onOpenActions}
        />
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Next due</p>
          {loading ? (
            <p className="mt-1 text-2xl font-semibold">…</p>
          ) : nextDue ? (
            <p className="mt-1 text-sm">
              <Link
                to={`${paths.formComplete(nextDue.template_id)}?site=${site.id}${
                  nextDue.for_date ? `&date=${nextDue.for_date}` : ''
                }`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {nextDue.template_name}
              </Link>
              <span className="mt-0.5 block text-muted-foreground">{whenLabel(nextDue)}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nothing outstanding</p>
          )}
        </div>
      </div>
    </div>
  )
}
