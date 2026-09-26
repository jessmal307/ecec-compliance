import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  TYPE_ARCHIVE_WARNING,
  typeArchiveTitle,
} from './ConfirmDeleteDialog'
import {
  ARCHIVE_VIEW_FILTERS,
  ListFilters,
  matchesQuery,
  normalizeQuery,
} from './ListFilters'
import { StatusBadge } from './StatusBadge'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import {
  Choice,
  Field,
  FieldGrid,
  FormActions,
  Input,
  Select,
} from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { isArchived } from '../lib/archive'
import {
  archiveRequirementType,
  countComplianceItemsForRequirementType,
  createRequirementType,
  listRequirementTypes,
  restoreRequirementType,
  updateRequirementType,
} from '../lib/compliance'
import { formatTimestamp } from '../lib/format'

function valuesFromType(type) {
  return {
    name: type?.name ?? '',
    applies_to: type?.applies_to === 'site' ? 'site' : 'staff',
    mandatory: Boolean(type?.mandatory),
    validity_months: type?.validity_months ?? '',
    renewal_lead_days: type?.renewal_lead_days ?? '',
    recheck_interval_days: type?.recheck_interval_days ?? '',
    perpetual: Boolean(type?.perpetual),
  }
}

function levelLabel(appliesTo) {
  return appliesTo === 'site' ? 'Centre' : 'Staff'
}

function TypeFormFields({ values, setValues, saving, allowLevel = true }) {
  return (
    <FieldGrid>
      <Field label="Name">
        <Input
          value={values.name}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          required
          disabled={saving}
        />
      </Field>
      {allowLevel ? (
        <Field label="Level">
          <Select
            value={values.applies_to}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                applies_to: event.target.value,
              }))
            }
            disabled={saving}
            aria-label="Level"
          >
            <option value="staff">Staff</option>
            <option value="site">Centre</option>
          </Select>
        </Field>
      ) : null}
      <NumberPhraseField
        prefix="Valid for"
        suffix="months"
        ariaLabel="Valid for months"
        value={values.validity_months}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            validity_months: event.target.value,
          }))
        }
        disabled={saving || values.perpetual}
      />
      <NumberPhraseField
        prefix="Remind me"
        suffix="days before expiry"
        ariaLabel="Remind me days before expiry"
        value={values.renewal_lead_days}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            renewal_lead_days: event.target.value,
          }))
        }
        disabled={saving || values.perpetual}
      />
      <NumberPhraseField
        prefix="Re-check every"
        suffix="days"
        ariaLabel="Re-check every days"
        value={values.recheck_interval_days}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            recheck_interval_days: event.target.value,
          }))
        }
        disabled={saving}
      />
      <Choice
        type="checkbox"
        checked={values.mandatory}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            mandatory: event.target.checked,
          }))
        }
        disabled={saving}
      >
        Required
      </Choice>
      <Choice
        type="checkbox"
        checked={values.perpetual}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            perpetual: event.target.checked,
            ...(event.target.checked
              ? { validity_months: '', renewal_lead_days: '' }
              : {}),
          }))
        }
        disabled={saving}
      >
        No expiry
      </Choice>
    </FieldGrid>
  )
}

function NumberPhraseField({
  prefix,
  suffix,
  value,
  onChange,
  disabled,
  ariaLabel,
}) {
  return (
    <label className="flex min-h-11 flex-wrap items-center gap-2 text-base font-medium text-card-foreground">
      {prefix ? <span>{prefix}</span> : null}
      <Input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="w-24"
      />
      {suffix ? (
        <span className="font-normal text-muted-foreground">{suffix}</span>
      ) : null}
    </label>
  )
}

export function Requirements({ embedded = false }) {
  const { organizationId } = useAuth()
  const [types, setTypes] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [viewFilter, setViewFilter] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editValues, setEditValues] = useState(valuesFromType(null))
  const [adding, setAdding] = useState(false)
  const [addValues, setAddValues] = useState(valuesFromType(null))
  const [saving, setSaving] = useState(false)
  const [pendingLevelChange, setPendingLevelChange] = useState(null)
  const [pendingArchive, setPendingArchive] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const archivedOnly = viewFilter === 'archived'

  async function loadTypes() {
    const { data, error: typesError } = await listRequirementTypes(
      organizationId,
      { archivedOnly },
    )
    if (typesError) {
      return { error: typesError }
    }
    setTypes(data ?? [])
    return { error: null }
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      setEditingId(null)

      const { data, error: typesError } = await listRequirementTypes(
        organizationId,
        { archivedOnly },
      )
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
  }, [organizationId, archivedOnly])

  const filteredTypes = useMemo(() => {
    const normalized = normalizeQuery(query)
    return types.filter((type) => matchesQuery(type.name, normalized))
  }, [types, query])

  function startEdit(type) {
    setAdding(false)
    setEditingId(type.id)
    setEditValues(valuesFromType(type))
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValues(valuesFromType(null))
    setPendingLevelChange(null)
  }

  function startAdd() {
    setAdding(true)
    setAddValues(valuesFromType(null))
    setEditingId(null)
    setError('')
  }

  function cancelAdd() {
    setAdding(false)
    setAddValues(valuesFromType(null))
  }

  async function saveType(type, values) {
    setSaving(true)
    setError('')

    const { error: saveError } = await updateRequirementType(type.id, values)
    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    const { error: reloadError } = await loadTypes()
    if (reloadError) {
      setError(reloadError.message)
      setSaving(false)
      return
    }

    cancelEdit()
    setSaving(false)
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!addValues.name.trim()) {
      setError('Name is required.')
      return
    }

    setSaving(true)
    setError('')

    const { error: createError } = await createRequirementType(
      organizationId,
      addValues,
    )
    if (createError) {
      setError(createError.message)
      setSaving(false)
      return
    }

    const { error: reloadError } = await loadTypes()
    if (reloadError) {
      setError(reloadError.message)
      setSaving(false)
      return
    }

    cancelAdd()
    setSaving(false)
  }

  async function handleSave(event, type) {
    event.preventDefault()
    if (!editValues.name.trim()) {
      setError('Name is required.')
      return
    }

    if (editValues.applies_to !== type.applies_to) {
      const { count, error: countError } =
        await countComplianceItemsForRequirementType(type.id)
      if (countError) {
        setError(countError.message)
        return
      }
      if (count > 0) {
        setPendingLevelChange({ type, count, values: { ...editValues } })
        return
      }
    }

    await saveType(type, editValues)
  }

  async function handleArchive() {
    if (!pendingArchive) return
    setBusyId(pendingArchive.id)
    setError('')

    const { error: archiveError } = await archiveRequirementType(
      pendingArchive.id,
    )
    if (archiveError) {
      setError(archiveError.message)
      setBusyId(null)
      return
    }

    if (editingId === pendingArchive.id) cancelEdit()
    setPendingArchive(null)
    const { error: reloadError } = await loadTypes()
    if (reloadError) setError(reloadError.message)
    setBusyId(null)
  }

  async function handleRestore(type) {
    setBusyId(type.id)
    setError('')

    const { error: restoreError } = await restoreRequirementType(type.id)
    if (restoreError) {
      setError(restoreError.message)
      setBusyId(null)
      return
    }

    const { error: reloadError } = await loadTypes()
    if (reloadError) setError(reloadError.message)
    setBusyId(null)
  }

  const editingType = types.find((type) => type.id === editingId) ?? null

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      {embedded ? null : (
        <PageHeader
          title="Requirements"
          description={
            archivedOnly
              ? 'Archived types are hidden from add-requirement pickers and gaps. Restore to use them again.'
              : 'Requirement types used for staff and centre compliance checks.'
          }
        />
      )}

      <PageError>{error}</PageError>

      <Card>
        <CardHeader>
          <CardTitle>Types</CardTitle>
          <CardDescription>
            {archivedOnly
              ? 'Archived types stay on existing records. Restore to offer them again when adding items.'
              : 'Required types appear as gaps on Overview when missing. Delete archives a type — existing items stay.'}
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {archivedOnly ? null : (
                <Button
                  type="button"
                  size="sm"
                  onClick={startAdd}
                  disabled={saving || adding}
                >
                  Add type
                </Button>
              )}
              <span className="text-sm tabular-nums text-muted-foreground">
                {types.length === 0 || !query.trim()
                  ? types.length
                  : `${filteredTypes.length} of ${types.length}`}
              </span>
            </div>
          </CardAction>
        </CardHeader>
        {!loading && organizationId ? (
          <ListFilters
            query={query}
            onQueryChange={setQuery}
            queryPlaceholder="Search by name"
            status={viewFilter}
            onStatusChange={setViewFilter}
            statusOptions={ARCHIVE_VIEW_FILTERS}
            statusLabel="Current or archived"
          />
        ) : null}
        <CardContent className="px-0">
          {loading ? (
            <PageMuted>Loading requirements…</PageMuted>
          ) : !organizationId ? (
            <PageMuted>
              No organization yet. Sign out and back in if this persists.
            </PageMuted>
          ) : types.length === 0 ? (
            <PageMuted>
              {archivedOnly
                ? 'No archived requirement types.'
                : 'No requirement types yet.'}
            </PageMuted>
          ) : filteredTypes.length === 0 ? (
            <PageMuted>No matching requirement types.</PageMuted>
          ) : (
            <Table>
              <THead>
                <Th>Name</Th>
                <Th>Applies to</Th>
                <Th>Required</Th>
                <Th>Valid for</Th>
                <Th>Remind me</Th>
                <Th>Re-check every</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <tbody>
                {filteredTypes.map((type) => (
                  <Tr key={type.id} className="hover:bg-muted/40">
                    <Td slot="label" className="font-medium text-card-foreground">
                      {type.name}
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground md:hidden">
                        {levelLabel(type.applies_to)}
                      </p>
                      {isArchived(type) ? (
                        <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                          Archived {formatTimestamp(type.archived_at)}
                        </p>
                      ) : null}
                    </Td>
                    <Td slot="extra" className="text-muted-foreground">
                      {levelLabel(type.applies_to)}
                    </Td>
                    <Td slot="status">
                      {isArchived(type) ? (
                        <StatusBadge status="Archived" />
                      ) : type.mandatory ? (
                        <Badge className="border-transparent bg-status-valid text-status-valid-foreground">
                          Required
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Optional</Badge>
                      )}
                    </Td>
                    <Td
                      slot="expiry"
                      label="Valid for"
                      className="text-muted-foreground"
                    >
                      {type.perpetual
                        ? 'No expiry'
                        : type.validity_months
                          ? `${type.validity_months} months`
                          : '—'}
                    </Td>
                    <Td slot="extra" label="Remind me" className="text-muted-foreground">
                      {type.renewal_lead_days
                        ? `${type.renewal_lead_days} days before expiry`
                        : '—'}
                    </Td>
                    <Td
                      slot="extra"
                      label="Re-check every"
                      className="text-muted-foreground"
                    >
                      {type.recheck_interval_days
                        ? `${type.recheck_interval_days} days`
                        : '—'}
                    </Td>
                    <Td slot="action">
                      <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                        {archivedOnly ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleRestore(type)}
                            disabled={busyId === type.id}
                          >
                            {busyId === type.id ? 'Restoring…' : 'Restore'}
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(type)}
                              disabled={saving || busyId === type.id}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPendingArchive(type)}
                              disabled={saving || busyId === type.id}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {adding && !archivedOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Add type</CardTitle>
            <CardDescription>
              Custom types are kept when the default catalog is re-seeded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleCreate}>
              <TypeFormFields
                values={addValues}
                setValues={setAddValues}
                saving={saving}
              />
              <FormActions>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Add type'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelAdd}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </FormActions>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {editingType && !archivedOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit {editingType.name}</CardTitle>
            <CardDescription>
              Changing the level on a type that already has records needs
              confirmation first. Saving a default type marks it customized so
              seed will not overwrite it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(event) => handleSave(event, editingType)}
            >
              <TypeFormFields
                values={editValues}
                setValues={setEditValues}
                saving={saving}
              />
              <FormActions>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </FormActions>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDeleteDialog
        open={Boolean(pendingLevelChange)}
        onOpenChange={(open) => {
          if (!open) setPendingLevelChange(null)
        }}
        title={`Change ${pendingLevelChange?.type.name ?? 'this type'} to ${levelLabel(pendingLevelChange?.values.applies_to)}?`}
        description={
          pendingLevelChange
            ? `This type already has ${pendingLevelChange.count} recorded ${pendingLevelChange.count === 1 ? 'item' : 'items'}. Changing the level does not move those records — they stay on their current staff or centre.`
            : ''
        }
        confirming={saving}
        onConfirm={() => {
          const pending = pendingLevelChange
          if (!pending) return
          setPendingLevelChange(null)
          return saveType(pending.type, pending.values)
        }}
        confirmLabel="Change level"
        confirmingLabel="Saving…"
        variant="default"
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null)
        }}
        title={
          pendingArchive
            ? typeArchiveTitle(pendingArchive.name)
            : 'Archive type?'
        }
        description={TYPE_ARCHIVE_WARNING}
        confirming={Boolean(pendingArchive && busyId === pendingArchive.id)}
        onConfirm={handleArchive}
        confirmLabel="Archive"
        confirmingLabel="Archiving…"
      />

    </section>
  )
}
