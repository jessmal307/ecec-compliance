import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { GapCategories } from './GapCategories'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  isRequirementExcluded,
  isSiteRequirementExcluded,
  listStaffRequirementExclusions,
  listSiteRequirementExclusions,
} from '../lib/exclusions'
import { listComplianceItems, listRequirementTypes } from '../lib/compliance'
import { buildOwnerGaps } from '../lib/gaps'
import { paths } from '../lib/paths'
import { listSites } from '../lib/sites'
import { isActiveStaff, listStaff } from '../lib/staff'

export function Gaps() {
  const { organizationId } = useAuth()
  const [items, setItems] = useState([])
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [requirementTypes, setRequirementTypes] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [siteExclusions, setSiteExclusions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data: itemRows, error: itemsError } =
        await listComplianceItems(organizationId)
      if (cancelled) return
      if (itemsError) {
        setError(itemsError.message)
        setLoading(false)
        return
      }

      const { data: staffRows, error: staffError } = await listStaff(organizationId)
      if (cancelled) return
      if (staffError) {
        setError(staffError.message)
        setLoading(false)
        return
      }

      const { data: siteRows, error: sitesError } = await listSites(organizationId)
      if (cancelled) return
      if (sitesError) {
        setError(sitesError.message)
        setLoading(false)
        return
      }

      const { data: typeRows, error: typesError } =
        await listRequirementTypes(organizationId)
      if (cancelled) return
      if (typesError) {
        setError(typesError.message)
        setLoading(false)
        return
      }

      const { data: exclusionRows, error: exclusionsError } =
        await listStaffRequirementExclusions(staffRows.map((member) => member.id))
      if (cancelled) return
      if (exclusionsError) {
        setError(exclusionsError.message)
        setLoading(false)
        return
      }

      const { data: siteExclusionRows, error: siteExclusionsError } =
        await listSiteRequirementExclusions(siteRows.map((site) => site.id))
      if (cancelled) return
      if (siteExclusionsError) {
        setError(siteExclusionsError.message)
        setLoading(false)
        return
      }

      setItems(itemRows)
      setStaff(staffRows)
      setSites(siteRows)
      setRequirementTypes(typeRows)
      setExclusions(exclusionRows)
      setSiteExclusions(siteExclusionRows)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  const gaps = useMemo(() => {
    const activeStaff = staff.filter(isActiveStaff)
    const activeStaffIds = new Set(activeStaff.map((member) => member.id))
    const visibleItems = items.filter((item) => {
      if (item.site_id) {
        return !isSiteRequirementExcluded(
          siteExclusions,
          item.site_id,
          item.requirement_type_id,
        )
      }
      if (!item.staff_id) return true
      if (!activeStaffIds.has(item.staff_id)) return false
      return !isRequirementExcluded(exclusions, item.staff_id, item.requirement_type_id)
    })

    return buildOwnerGaps({
      activeStaff,
      sites,
      visibleItems,
      requirementTypes,
      exclusions,
      siteExclusions,
    })
  }, [items, staff, sites, requirementTypes, exclusions, siteExclusions])

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Compliance gaps"
        description="Staff and centres with missing or expired required items, ordered by how many need attention."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={paths.home}>Back to overview</Link>
          </Button>
        }
      />

      <PageError>{error}</PageError>

      <Card>
        <CardHeader>
          <CardTitle>All gaps</CardTitle>
          <CardDescription>
            One row per person or centre. Open a profile to fill in missing or expired items.
          </CardDescription>
          <CardAction>
            <span className="text-sm tabular-nums text-muted-foreground">
              {gaps.length}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <PageMuted>Loading gaps…</PageMuted>
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : gaps.length === 0 ? (
            <PageMuted>Nothing missing or expired.</PageMuted>
          ) : (
            <Table>
              <THead>
                <Th>Owner</Th>
                <Th>Type</Th>
                <Th>Needs attention</Th>
              </THead>
              <tbody>
                {gaps.map((row) => (
                  <Tr key={`${row.kind}-${row.id}`} className="hover:bg-muted/40">
                    <Td slot="label">
                      <Link
                        to={row.href}
                        className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                      >
                        {row.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                        {row.kind === 'staff' ? 'Staff' : 'Centre'}
                        {row.detail ? ` · ${row.detail}` : ''}
                      </p>
                      {row.detail ? (
                        <p className="hidden text-xs text-muted-foreground md:block">
                          {row.detail}
                        </p>
                      ) : null}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {row.kind === 'staff' ? 'Staff' : 'Centre'}
                    </Td>
                    <Td slot="meta">
                      <GapCategories
                        missing={row.missing.length}
                        expired={row.expired.length}
                      />
                    </Td>
                    <Td slot="action" className="md:hidden">
                      <Button asChild size="sm">
                        <Link to={row.href}>View</Link>
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
