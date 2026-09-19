import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { listRequirementTypes } from '../lib/compliance'

export function Requirements() {
  const { organizationId } = useAuth()
  const [types, setTypes] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data, error: typesError } = await listRequirementTypes(organizationId)
      if (cancelled) return
      if (typesError) {
        setError(typesError.message)
        setLoading(false)
        return
      }

      setTypes(data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Requirements"
        description="Requirement types used for staff and site compliance checks."
      />

      <PageError>{error}</PageError>

      <Card>
        <CardHeader>
          <CardTitle>Types</CardTitle>
          <CardDescription>
            Mandatory types appear as gaps on Overview when missing.
          </CardDescription>
          <CardAction>
            <span className="text-sm tabular-nums text-muted-foreground">
              {types.length}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <PageMuted>Loading requirements…</PageMuted>
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : types.length === 0 ? (
            <PageMuted>No requirement types yet.</PageMuted>
          ) : (
            <Table>
              <THead>
                <Th>Name</Th>
                <Th>Applies to</Th>
                <Th>Mandatory</Th>
                <Th>Validity</Th>
                <Th>Renewal lead</Th>
                <Th>Recheck</Th>
              </THead>
              <tbody>
                {types.map((type) => (
                  <Tr key={type.id} className="hover:bg-muted/40">
                    <Td slot="label" className="font-medium text-card-foreground">
                      {type.name}
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground md:hidden">
                        {type.applies_to === 'site' ? 'Site' : 'Staff'}
                      </p>
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {type.applies_to === 'site' ? 'Site' : 'Staff'}
                    </Td>
                    <Td slot="status">
                      {type.mandatory ? (
                        <Badge className="border-transparent bg-status-valid text-status-valid-foreground">
                          Mandatory
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Optional</Badge>
                      )}
                    </Td>
                    <Td
                      slot="expiry"
                      label="Validity"
                      className="text-muted-foreground"
                    >
                      {type.validity_months
                        ? `${type.validity_months} months`
                        : '—'}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {type.renewal_lead_days
                        ? `${type.renewal_lead_days} days`
                        : '—'}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {type.recheck_interval_days
                        ? `${type.recheck_interval_days} days`
                        : '—'}
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
