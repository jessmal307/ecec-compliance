import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ConfirmDeleteDialog,
  SITE_DELETE_WARNING,
  siteDeleteTitle,
} from './ConfirmDeleteDialog'
import { ListFilters, matchesQuery, normalizeQuery } from './ListFilters'
import { ListTableSkeleton } from './PageSkeletons'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { Field, FieldGrid, FormActions, FormSection, Input } from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import { createSite, deleteSite, listSites } from '../lib/sites'

const EMPTY_SITE_FORM = {
  name: '',
  address: '',
  serviceApprovalNumber: '',
  phone: '',
  nominatedSupervisor: '',
}

export function Sites() {
  const { organizationId } = useAuth()
  const [form, setForm] = useState(EMPTY_SITE_FORM)
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [query, setQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const creating = searchParams.get('new') === '1'

  function setFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function loadSites() {
      setLoading(true)
      setError('')
      const { data, error: selectError } = await listSites(organizationId)
      if (cancelled) return

      if (selectError) {
        setError(selectError.message)
        setLoading(false)
        return
      }

      setSites(data)
      setLoading(false)
    }

    loadSites()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  async function refreshSites() {
    const { data, error: selectError } = await listSites(organizationId)
    if (selectError) {
      return { error: selectError }
    }
    setSites(data)
    return { error: null }
  }

  function resetForm() {
    setForm(EMPTY_SITE_FORM)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!organizationId) return

    setError('')
    setSaving(true)

    const { error: insertError } = await createSite({
      name: form.name.trim(),
      orgId: organizationId,
      address: form.address,
      serviceApprovalNumber: form.serviceApprovalNumber,
      phone: form.phone,
      nominatedSupervisor: form.nominatedSupervisor,
    })
    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    const { error: selectError } = await refreshSites()
    if (selectError) {
      setError(selectError.message)
      setSaving(false)
      return
    }

    resetForm()
    setSaving(false)
  }

  async function handleDelete() {
    if (!pendingDelete) return

    setError('')
    setDeletingId(pendingDelete.id)

    const { error: deleteError } = await deleteSite(pendingDelete.id)
    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    setPendingDelete(null)
    const { error: selectError } = await refreshSites()
    if (selectError) {
      setError(selectError.message)
    }
    setDeletingId(null)
  }

  const filteredSites = useMemo(() => {
    const normalized = normalizeQuery(query)
    return sites.filter((site) => matchesQuery(site.name, normalized))
  }, [sites, query])

  const busy = !organizationId || saving
  const filtering = Boolean(query.trim())

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Sites"
        description="Open a site to view its profile. Use New site to create one."
        actions={
          creating ? null : (
            <Button
              type="button"
              onClick={() => {
                setSearchParams({ new: '1' })
                setError('')
              }}
              disabled={!organizationId}
            >
              New site
            </Button>
          )
        }
      />

      <PageError>{error}</PageError>

      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>New site</CardTitle>
            <CardDescription>Service details and contact information.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <FormSection title="Details">
                <FieldGrid>
                  <Field label="Site name">
                    <Input
                      type="text"
                      name="name"
                      value={form.name}
                      onChange={(event) => setFormField('name', event.target.value)}
                      required
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Address">
                    <Input
                      type="text"
                      name="address"
                      value={form.address}
                      onChange={(event) =>
                        setFormField('address', event.target.value)
                      }
                      disabled={busy}
                    />
                  </Field>
                </FieldGrid>
              </FormSection>

              <FormSection title="Contact">
                <FieldGrid>
                  <Field label="Phone">
                    <Input
                      type="tel"
                      name="phone"
                      value={form.phone}
                      onChange={(event) => setFormField('phone', event.target.value)}
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Nominated supervisor">
                    <Input
                      type="text"
                      name="nominated_supervisor"
                      value={form.nominatedSupervisor}
                      onChange={(event) =>
                        setFormField('nominatedSupervisor', event.target.value)
                      }
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Service approval number" className="col-span-full">
                    <Input
                      type="text"
                      name="service_approval_number"
                      value={form.serviceApprovalNumber}
                      onChange={(event) =>
                        setFormField('serviceApprovalNumber', event.target.value)
                      }
                      disabled={busy}
                    />
                  </Field>
                </FieldGrid>
              </FormSection>

              <FormActions>
                <Button type="submit" disabled={busy}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </FormActions>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <CardDescription>Sites in your organisation.</CardDescription>
          <CardAction>
            <span className="text-sm tabular-nums text-muted-foreground">
              {sites.length === 0 || !filtering
                ? sites.length
                : `${filteredSites.length} of ${sites.length}`}
            </span>
          </CardAction>
        </CardHeader>
        {sites.length > 0 ? (
          <ListFilters query={query} onQueryChange={setQuery} />
        ) : null}
        <CardContent className="px-0">
          {loading ? (
            <ListTableSkeleton rows={5} columns={5} />
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : sites.length === 0 ? (
            <PageMuted>No sites yet.</PageMuted>
          ) : filteredSites.length === 0 ? (
            <PageMuted>No matching sites.</PageMuted>
          ) : (
            <Table>
              <THead>
                <Th>Name</Th>
                <Th>Address</Th>
                <Th>Phone</Th>
                <Th>Nominated supervisor</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <tbody>
                {filteredSites.map((site) => (
                  <Tr key={site.id} className="hover:bg-muted/40">
                    <Td slot="label">
                      <Link
                        to={paths.siteProfile(site.id)}
                        className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                      >
                        {site.name}
                      </Link>
                      {site.address ? (
                        <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                          {site.address}
                        </p>
                      ) : null}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {site.address || '—'}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {site.phone || '—'}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {site.nominated_supervisor || '—'}
                    </Td>
                    <Td slot="action" className="text-right">
                      <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                        <Button asChild size="sm" className="md:hidden">
                          <Link to={paths.siteProfile(site.id)}>View</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setPendingDelete(site)}
                          disabled={deletingId === site.id}
                        >
                          {deletingId === site.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingDelete ? siteDeleteTitle(pendingDelete.name) : 'Delete site?'}
        description={SITE_DELETE_WARNING}
        confirming={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onConfirm={handleDelete}
      />
    </section>
  )
}
