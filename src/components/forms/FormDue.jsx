import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageError, PageMuted } from '../ui/page'
import { cadenceLabel, computeDueForms } from '../../lib/forms'
import { dueStatusAt } from '../../lib/formDueTimes'
import { formatDate } from '../../lib/format'
import { todayIsoDate } from '../../lib/compliance'
import { paths } from '../../lib/paths'
import { formatTimeOfDay } from '../../lib/sydneyTime'
import { useMinuteClock } from '../../hooks/useMinuteClock'

function statusBadgeLabel(status) {
  if (status === 'done') return 'Done'
  if (status === 'missed') return 'Missed'
  if (status === 'overdue') return 'Overdue'
  return 'Due'
}

export function FormDue({ organizationId }) {
  const today = todayIsoDate()
  const now = useMinuteClock()
  const [searchParams] = useSearchParams()
  const siteFilter = searchParams.get('site') || ''
  const [loadedRows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const rows = useMemo(
    () =>
      loadedRows.map((row) => ({
        ...row,
        status: dueStatusAt({ status: row.status, dueBy: row.due_by, forDate: row.for_date, now }),
      })),
    [loadedRows, now],
  )

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await computeDueForms(organizationId, today)
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setRows([])
        setLoading(false)
        return
      }
      setRows(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, today])

  const groups = useMemo(() => {
    const bySite = new Map()
    for (const row of rows) {
      const existing = bySite.get(row.site_id)
      if (existing) existing.rows.push(row)
      else bySite.set(row.site_id, { site_id: row.site_id, site_name: row.site_name, rows: [row] })
    }
    const groups = [...bySite.values()]
    if (!siteFilter) return groups
    return groups.filter((group) => String(group.site_id) === String(siteFilter))
  }, [rows, siteFilter])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Current period as of {formatDate(today)}. Scheduled forms only — due, overdue, done, or missed.
      </p>
      <PageError>{error}</PageError>
      {loading ? (
        <PageMuted>Loading due forms…</PageMuted>
      ) : groups.length === 0 ? (
        <PageMuted>Nothing applicable today. Closed days and excluded centres are omitted.</PageMuted>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {groups.map((group) => (
            <li key={group.site_id}>
              <Card>
                <CardHeader>
                  <CardTitle>{group.site_name}</CardTitle>
                  <CardDescription>
                    {group.rows.filter((row) => row.status === 'due').length} due
                    {' · '}
                    {group.rows.some((row) => row.status === 'overdue') ? (
                      <>
                        {group.rows.filter((row) => row.status === 'overdue').length} overdue
                        {' · '}
                      </>
                    ) : null}
                    {group.rows.filter((row) => row.status === 'done').length} done
                    {' · '}
                    {group.rows.filter((row) => row.status === 'missed').length} missed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {group.rows.map((row) => (
                      <li
                        key={`${row.site_id}-${row.template_id}-${row.for_date}-${row.status}`}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{row.template_name}</span>
                          <Badge variant="outline">{cadenceLabel(row.cadence)}</Badge>
                          <Badge
                            variant={
                              row.status === 'done'
                                ? 'secondary'
                                : row.status === 'missed'
                                  ? 'outline'
                                  : row.status === 'overdue'
                                    ? 'destructive'
                                    : 'default'
                            }
                          >
                            {statusBadgeLabel(row.status)}
                          </Badge>
                          {row.status === 'due' && row.due_by ? (
                            <Badge variant="outline">Due by {formatTimeOfDay(row.due_by)}</Badge>
                          ) : null}
                          {row.late ? <Badge variant="outline">Late</Badge> : null}
                        </div>
                        {row.status === 'due' || row.status === 'overdue' ? (
                          <Button asChild size="sm">
                            <Link
                              to={`${paths.formComplete(row.template_id)}?site=${row.site_id}${
                                row.for_date ? `&date=${row.for_date}` : ''
                              }`}
                            >
                              Complete
                            </Link>
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
