import { useEffect, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Select } from './ui/form'
import { PageError, PageMuted } from './ui/page'
import {
  AUDIT_DATE_WINDOWS,
  AUDIT_ENTITIES,
  listAuditLog,
} from '../lib/auditLog'
import { ListPagination, paginateItems } from './ListPagination'

export function ActivityLog({ organizationId }) {
  const [entity, setEntity] = useState('')
  const [days, setDays] = useState('30')
  const [page, setPage] = useState(1)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPage(1)
  }, [entity, days])

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data, error: loadError } = await listAuditLog(organizationId, {
        entity,
        days,
      })
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setEntries([])
        setLoading(false)
        return
      }

      setEntries(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, entity, days])

  const paged = paginateItems(entries, page)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          Who changed staff, sites, requirement types, and compliance records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            aria-label="Filter by record type"
            className="sm:w-52"
          >
            {AUDIT_ENTITIES.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            value={days}
            onChange={(event) => setDays(event.target.value)}
            aria-label="Filter by date"
            className="sm:w-44"
          >
            {AUDIT_DATE_WINDOWS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <PageError>{error}</PageError>

        {!organizationId ? (
          <PageMuted>Sign in to see activity for your organisation.</PageMuted>
        ) : loading ? (
          <PageMuted>Loading activity…</PageMuted>
        ) : entries.length === 0 ? (
          <PageMuted>No activity in this period.</PageMuted>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {paged.items.map((entry) => (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="leading-relaxed">
                    {entry.sentence}
                    <span className="text-muted-foreground">
                      {' '}
                      ·{' '}
                      <time dateTime={entry.created_at}>
                        {entry.relativeTime}
                      </time>
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <ListPagination
              page={paged.page}
              pageCount={paged.pageCount}
              from={paged.from}
              to={paged.to}
              total={paged.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
