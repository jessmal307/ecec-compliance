import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useFormsAccess } from './Forms'
import { FormActionList } from './forms/FormActionList'
import { Field, Select } from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { actionHasOwner, actionIsOverdue } from '../lib/formAnswers'
import { listFormActions } from '../lib/formActions'
import { todayIsoDate } from '../lib/compliance'
import { paths } from '../lib/paths'
import { listSites } from '../lib/sites'
import { listStaff } from '../lib/staff'

export function Actions() {
  const { organizationId } = useAuth()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const [actions, setActions] = useState([])
  const [sites, setSites] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const siteFilter = searchParams.get('site') || ''
  const ownerFilter = searchParams.get('owner') || ''
  const qualityFilter = searchParams.get('qa') || ''
  const overdueOnly = searchParams.get('overdue') === '1'
  const unassignedOnly = searchParams.get('unassigned') === '1'
  const qipOnly = searchParams.get('qip') === '1'

  useEffect(() => {
    if (accessLoading || !allowed || !organizationId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [actionsResult, sitesResult, staffResult] = await Promise.all([
        listFormActions(organizationId, { status: 'open' }),
        listSites(organizationId),
        listStaff(organizationId),
      ])
      if (cancelled) return
      if (actionsResult.error || sitesResult.error || staffResult.error) {
        setError((actionsResult.error || sitesResult.error || staffResult.error).message)
        setLoading(false)
        return
      }
      setActions(actionsResult.data)
      setSites(sitesResult.data ?? [])
      setStaff(staffResult.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, organizationId])

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const today = todayIsoDate()
  const visible = useMemo(() => {
    return actions.filter((action) => {
      if (siteFilter && action.site_id !== siteFilter) return false
      if (ownerFilter && action.owner_staff_id !== ownerFilter) return false
      if (qualityFilter && String(action.quality_area || '') !== qualityFilter) return false
      if (overdueOnly && !actionIsOverdue(action, today)) return false
      if (unassignedOnly && actionHasOwner(action)) return false
      if (qipOnly && !action.added_to_qip) return false
      return true
    })
  }, [actions, siteFilter, ownerFilter, qualityFilter, overdueOnly, unassignedOnly, qipOnly, today])

  if (accessLoading) return <PageMuted>Loading actions…</PageMuted>
  if (!allowed) return <Navigate to={paths.home} replace />

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Actions"
        description="Follow-up actions to do across centres. Mark one as done with a note, or change its owner and due date."
      />
      <PageError>{error}</PageError>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Centre">
          <Select value={siteFilter} onChange={(event) => setFilter('site', event.target.value)}>
            <option value="">All centres</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={ownerFilter} onChange={(event) => setFilter('owner', event.target.value)}>
            <option value="">Anyone</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quality area">
          <Select value={qualityFilter} onChange={(event) => setFilter('qa', event.target.value)}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5, 6, 7].map((area) => (
              <option key={area} value={String(area)}>
                QA {area}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={overdueOnly ? 'default' : 'outline'}
          onClick={() => setFilter('overdue', overdueOnly ? '' : '1')}
        >
          Overdue
        </Button>
        <Button
          type="button"
          size="sm"
          variant={unassignedOnly ? 'default' : 'outline'}
          onClick={() => setFilter('unassigned', unassignedOnly ? '' : '1')}
        >
          No one assigned
        </Button>
        <Button
          type="button"
          size="sm"
          variant={qipOnly ? 'default' : 'outline'}
          onClick={() => setFilter('qip', qipOnly ? '' : '1')}
        >
          Added to QIP
        </Button>
      </div>
      {loading ? (
        <PageMuted>Loading actions…</PageMuted>
      ) : (
        <FormActionList
          actions={visible}
          staff={staff}
          sites={sites}
          showSite
          onError={setError}
          onChanged={(row) =>
            setActions((current) =>
              row.status === 'open'
                ? current.map((item) => (item.id === row.id ? row : item))
                : current.filter((item) => item.id !== row.id),
            )
          }
        />
      )}
    </section>
  )
}
