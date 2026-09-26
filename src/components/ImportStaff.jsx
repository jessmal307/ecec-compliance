import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FileDropZone } from './FileDropZone'
import { Table, Td, Th, THead, Tr } from './ui/data-table'
import { Choice, Field, Select } from './ui/form'
import { PageError, PageHeader, PageMuted, PageSuccess } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  isStaffRequirementType,
  listRequirementTypes,
  suggestedExpiryFromIssuedDate,
  todayIsoDate,
} from '../lib/compliance'
import { maxReasonableDate } from '../lib/dates'
import { paths } from '../lib/paths'
import { listSites } from '../lib/sites'
import { sydneyToday } from '../lib/sydneyTime'
import {
  buildStaffImportPreview,
  detectHeaderRowIndex,
  emptyStaffMapping,
  guessStaffImportColumns,
  importRowWillSave,
  pickDefaultSheetName,
  readStaffImportWorkbook,
  rowIssues,
  skippedRowsCsv,
  staffImportTemplateCsv,
  validateStaffImport,
} from '../lib/staffImport'
import {
  listStaffForImportMatch,
  saveStaffImport,
} from '../lib/staffImportSave'

function rowLabel(row, index) {
  const sample = (row ?? [])
    .map((cell) => String(cell ?? '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
  return sample ? `Row ${index + 1} — ${sample}` : `Row ${index + 1}`
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function blankCertificates(types) {
  return Object.fromEntries(
    (types ?? []).map((type) => [
      type.id,
      { expiry: '', issued: '', number: '' },
    ]),
  )
}

function previewStatus(row, importDuplicates, siteReady) {
  if (!importRowWillSave(row, { importDuplicates, siteReady })) return 'error'
  const duplicate = row.errors.some((error) => error.code === 'duplicate')
  if (row.warnings.length || duplicate) return 'warning'
  return 'ok'
}

const STATUS_LABEL = { ok: 'OK', warning: 'Warning', error: 'Error' }

function statusClassName(status) {
  if (status === 'error') return 'text-status-expired'
  if (status === 'warning') return 'text-status-soon'
  return 'text-status-valid'
}

function ColumnSelect({ label, value, columns, onChange }) {
  return (
    <Field label={label}>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        <option value="">Don’t import</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function ImportStaff() {
  const { organizationId } = useAuth()
  const [inputKey, setInputKey] = useState(0)
  const [fileName, setFileName] = useState('')
  const [workbook, setWorkbook] = useState(null)
  const [sheetNames, setSheetNames] = useState([])
  const [sheetName, setSheetName] = useState('')
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [sites, setSites] = useState([])
  const [staffTypes, setStaffTypes] = useState([])
  const [typesLoaded, setTypesLoaded] = useState(false)
  const [existingStaff, setExistingStaff] = useState(null)
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [siteMode, setSiteMode] = useState('one')
  const [columnMap, setColumnMap] = useState({
    fields: emptyStaffMapping(),
    siteColumn: '',
    certificates: {},
  })
  const [importDuplicates, setImportDuplicates] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  const columns = preview?.columns ?? []
  const records = preview?.records ?? []
  const rawRows = preview?.rawRows ?? []
  const columnKey = columns.join('\0')
  const typeKey = staffTypes.map((type) => `${type.id}:${type.name}`).join('|')

  function applyPreview(nextWorkbook, nextSheetName, nextHeaderIndex) {
    const next = buildStaffImportPreview(
      nextWorkbook,
      nextSheetName,
      nextHeaderIndex,
    )
    setPreview(next)
    setHeaderRowIndex(next.headerRowIndex)
    setError(next.error ?? '')
    setResult(null)
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      const [sitesResult, typesResult, staffResult] = await Promise.all([
        listSites(organizationId),
        listRequirementTypes(organizationId),
        listStaffForImportMatch(organizationId),
      ])
      if (cancelled) return
      if (sitesResult.error || typesResult.error || staffResult.error) {
        setError(
          sitesResult.error?.message ||
            typesResult.error?.message ||
            staffResult.error?.message,
        )
        return
      }
      const siteRows = sitesResult.data ?? []
      setSites(siteRows)
      setSelectedSiteId((current) => current || siteRows[0]?.id || '')
      setStaffTypes(
        (typesResult.data ?? []).filter((type) => isStaffRequirementType(type)),
      )
      setTypesLoaded(true)
      setExistingStaff(staffResult.data ?? [])
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!columnKey) return
    const guessed = guessStaffImportColumns(columnKey.split('\0'), staffTypes)
    setColumnMap({
      fields: guessed.mapping,
      siteColumn: guessed.siteColumn,
      certificates: {
        ...blankCertificates(staffTypes),
        ...guessed.certificates,
      },
    })
    setSiteMode(guessed.siteColumn ? 'column' : 'one')
    setResult(null)
  }, [columnKey, typeKey, staffTypes])

  function takeColumn(column, apply) {
    setColumnMap((current) => {
      const next = {
        fields: { ...current.fields },
        siteColumn: current.siteColumn,
        certificates: Object.fromEntries(
          Object.entries(current.certificates).map(([typeId, mapped]) => [
            typeId,
            { ...mapped },
          ]),
        ),
      }
      if (column) {
        for (const key of Object.keys(next.fields)) {
          if (next.fields[key] === column) next.fields[key] = ''
        }
        if (next.siteColumn === column) next.siteColumn = ''
        for (const mapped of Object.values(next.certificates)) {
          if (mapped.expiry === column) mapped.expiry = ''
          if (mapped.issued === column) mapped.issued = ''
          if (mapped.number === column) mapped.number = ''
        }
      }
      apply(next)
      return next
    })
    setResult(null)
  }

  async function handleFile(file) {
    setError('')
    setPreview(null)
    setWorkbook(null)
    setSheetNames([])
    setSheetName('')
    setFileName(file?.name ?? '')
    setResult(null)

    if (!file) return

    setReading(true)
    const { data, error: readError } = await readStaffImportWorkbook(file)
    setReading(false)

    if (readError || !data) {
      setError(readError)
      return
    }

    const nextSheet = pickDefaultSheetName(data.sheetNames)
    setWorkbook(data.workbook)
    setSheetNames(data.sheetNames)
    setSheetName(nextSheet)
    try {
      const rows = buildStaffImportPreview(data.workbook, nextSheet, 0)
      applyPreview(
        data.workbook,
        nextSheet,
        rows.rawRows?.length ? detectHeaderRowIndex(rows.rawRows) : 0,
      )
    } catch {
      setError("Couldn't read this file")
    }
  }

  function handleSheetChange(nextSheet) {
    setSheetName(nextSheet)
    if (!workbook) return
    try {
      const next = buildStaffImportPreview(workbook, nextSheet, 0)
      applyPreview(
        workbook,
        nextSheet,
        next.rawRows?.length ? detectHeaderRowIndex(next.rawRows) : 0,
      )
    } catch {
      setError("Couldn't read this file")
    }
  }

  function handleHeaderChange(nextIndex) {
    if (!workbook) return
    try {
      applyPreview(workbook, sheetName, nextIndex)
    } catch {
      setError("Couldn't read this file")
    }
  }

  function resetImport() {
    setFileName('')
    setWorkbook(null)
    setSheetNames([])
    setSheetName('')
    setHeaderRowIndex(0)
    setPreview(null)
    setError('')
    setResult(null)
    setProgress(null)
    setImportDuplicates(false)
    setInputKey((current) => current + 1)
  }

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null
  const siteReady = siteMode === 'column' ? Boolean(columnMap.siteColumn) : Boolean(selectedSite)
  const today = todayIsoDate()
  const validated = useMemo(
    () =>
      validateStaffImport({
        records,
        columns,
        mapping: columnMap.fields,
        siteMode,
        siteColumn: columnMap.siteColumn,
        selectedSite: siteMode === 'one' ? selectedSite : null,
        sites,
        certificateColumns: columnMap.certificates,
        requirementTypes: staffTypes,
        existingStaff: existingStaff ?? [],
        today,
        maxStartDate: maxReasonableDate(today),
        suggestExpiry: suggestedExpiryFromIssuedDate,
      }),
    [
      records,
      columns,
      columnMap,
      siteMode,
      selectedSite,
      sites,
      staffTypes,
      existingStaff,
      today,
    ],
  )

  const importable = validated.filter((row) =>
    importRowWillSave(row, { importDuplicates, siteReady }),
  )
  const hasDuplicates = validated.some((row) =>
    row.errors.some((issue) => issue.code === 'duplicate'),
  )
  const headerChoices = rawRows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ index }) => index < 20 || index === headerRowIndex,
    )

  async function handleImport() {
    if (!organizationId || importable.length === 0) return
    setSaving(true)
    setError('')
    setProgress({ done: 0, total: importable.length })
    const saved = await saveStaffImport({
      orgId: organizationId,
      rows: importable,
      onProgress: setProgress,
    })
    const skippedPreview = validated
      .filter((row) => !importRowWillSave(row, { importDuplicates, siteReady }))
      .map((row) => ({
        rowNumber: row.rowNumber,
        raw: row.raw,
        reason: row.errors.map((issue) => issue.message).join(' '),
      }))
    setResult({
      created: saved.created,
      skipped: [...skippedPreview, ...saved.failed],
    })
    setSaving(false)
    setProgress(null)
    const refreshed = await listStaffForImportMatch(organizationId)
    if (!refreshed.error) setExistingStaff(refreshed.data ?? [])
  }

  function handleTemplate() {
    downloadCsv(staffImportTemplateCsv(staffTypes), 'staff-import-template.csv')
  }

  function handleSkippedCsv() {
    downloadCsv(
      skippedRowsCsv(columns, result?.skipped ?? []),
      `staff-import-skipped-${sydneyToday()}.csv`,
    )
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Import staff"
        description="Map the columns, check each row, then import. Nothing is saved until you choose Import."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTemplate}
              disabled={!typesLoaded}
            >
              Download template
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={paths.staff}>Back to staff</Link>
            </Button>
          </>
        }
      />

      <PageError>{error}</PageError>

      <Card>
        <CardHeader>
          <CardTitle>File</CardTitle>
          <CardDescription>
            CSV or Excel (.xlsx). The file stays in this browser and is not
            uploaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropZone
            key={inputKey}
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={reading}
            inputLabel="Staff spreadsheet"
            label={
              reading
                ? 'Reading file…'
                : 'Drop a CSV or Excel file here, or click to browse'
            }
            hint=".csv or .xlsx"
            fileName={fileName}
            onFile={handleFile}
          />
          {fileName ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetImport}
              disabled={reading || saving}
            >
              Clear
            </Button>
          ) : null}

          {sheetNames.length > 1 ? (
            <Field label="Sheet">
              <Select
                value={sheetName}
                onChange={(event) => handleSheetChange(event.target.value)}
                aria-label="Sheet"
              >
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {rawRows.length > 0 ? (
            <Field label="Header row">
              <Select
                value={String(headerRowIndex)}
                onChange={(event) =>
                  handleHeaderChange(Number(event.target.value))
                }
                aria-label="Header row"
              >
                {headerChoices.map(({ row, index }) => (
                  <option key={index} value={String(index)}>
                    {rowLabel(row, index)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      {preview && !preview.error ? (
        <Card>
          <CardHeader>
            <CardTitle>Columns</CardTitle>
            <CardDescription>
              {preview.emptyData
                ? 'Headers were found, but there are no data rows.'
                : 'Unmapped columns are ignored. Full name is used only when first and last are not mapped.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {['firstName', 'lastName', 'fullName', 'email', 'phone', 'role', 'employmentStatus', 'startDate'].map(
                (key) => {
                  const field = {
                    firstName: 'First name',
                    lastName: 'Last name',
                    fullName: 'Full name',
                    email: 'Email',
                    phone: 'Phone',
                    role: 'Role',
                    employmentStatus: 'Employment status',
                    startDate: 'Start date',
                  }[key]
                  return (
                    <ColumnSelect
                      key={key}
                      label={field}
                      value={columnMap.fields[key] ?? ''}
                      columns={columns}
                      onChange={(column) =>
                        takeColumn(column, (next) => {
                          next.fields[key] = column
                        })
                      }
                    />
                  )
                },
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <h3 className="text-sm font-medium text-card-foreground">
                Site
              </h3>
              <div className="flex flex-col gap-2">
                <Choice
                  type="radio"
                  name="site-mode"
                  checked={siteMode === 'one'}
                  onChange={() => {
                    setSiteMode('one')
                    setResult(null)
                  }}
                >
                  Assign everyone to one site
                </Choice>
                <Choice
                  type="radio"
                  name="site-mode"
                  checked={siteMode === 'column'}
                  onChange={() => {
                    setSiteMode('column')
                    setResult(null)
                  }}
                >
                  Use a site column
                </Choice>
              </div>
              {siteMode === 'one' ? (
                <Field label="Location" className="sm:max-w-sm">
                  {sites.length === 0 ? (
                    <p className="text-sm font-normal text-muted-foreground">
                      Add a site first.{' '}
                      <Link
                        to={paths.sites}
                        className="font-medium text-card-foreground underline underline-offset-2"
                      >
                        Add a site
                      </Link>
                    </p>
                  ) : (
                    <Select
                      value={selectedSiteId}
                      onChange={(event) => {
                        setSelectedSiteId(event.target.value)
                        setResult(null)
                      }}
                      aria-label="Location"
                    >
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <div className="space-y-2 sm:max-w-sm">
                  <ColumnSelect
                    label="Site column"
                    value={columnMap.siteColumn}
                    columns={columns}
                    onChange={(column) =>
                      takeColumn(column, (next) => {
                        next.siteColumn = column
                      })
                    }
                  />
                  <p className="text-xs font-normal text-muted-foreground">
                    Several sites in one cell are separated by ; or ,. Every
                    name must match a site.
                  </p>
                </div>
              )}
            </div>

            {staffTypes.length > 0 ? (
              <div className="space-y-4 border-t border-border pt-5">
                <div>
                  <h3 className="text-sm font-medium text-card-foreground">
                    Certificates
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Blank cells create no record, so the certificate stays
                    Missing. If only an issued date is mapped, expiry is
                    calculated from that type’s validity, the same as entering
                    the record by hand.
                  </p>
                </div>
                {staffTypes.map((type) => {
                  const mapped = columnMap.certificates[type.id] ?? {
                    expiry: '',
                    issued: '',
                    number: '',
                  }
                  return (
                    <div key={type.id} className="space-y-3">
                      <p className="text-sm font-medium">{type.name}</p>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <ColumnSelect
                          label="Expiry"
                          value={mapped.expiry}
                          columns={columns}
                          onChange={(column) =>
                            takeColumn(column, (next) => {
                              next.certificates[type.id] = {
                                ...(next.certificates[type.id] ?? mapped),
                                expiry: column,
                              }
                            })
                          }
                        />
                        <ColumnSelect
                          label="Issued / completed"
                          value={mapped.issued}
                          columns={columns}
                          onChange={(column) =>
                            takeColumn(column, (next) => {
                              next.certificates[type.id] = {
                                ...(next.certificates[type.id] ?? mapped),
                                issued: column,
                              }
                            })
                          }
                        />
                        <ColumnSelect
                          label="Number / ID"
                          value={mapped.number}
                          columns={columns}
                          onChange={(column) =>
                            takeColumn(column, (next) => {
                              next.certificates[type.id] = {
                                ...(next.certificates[type.id] ?? mapped),
                                number: column,
                              }
                            })
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {preview && !preview.error && !preview.emptyData ? (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {existingStaff == null
                ? 'Checking existing staff…'
                : `${importable.length} of ${validated.length} ${
                    validated.length === 1 ? 'row' : 'rows'
                  } will be imported.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasDuplicates ? (
              <Choice
                type="checkbox"
                checked={importDuplicates}
                onChange={(event) => {
                  setImportDuplicates(event.target.checked)
                  setResult(null)
                }}
              >
                Import duplicates anyway
              </Choice>
            ) : null}
            <div className="max-h-[32rem] overflow-auto">
              <Table>
                <THead>
                  <Th>Status</Th>
                  <Th>Name</Th>
                  <Th>Site</Th>
                  <Th>Issues</Th>
                </THead>
                <tbody>
                  {validated.map((row) => {
                    const status = previewStatus(row, importDuplicates, siteReady)
                    return (
                      <Tr key={row.rowNumber}>
                        <Td className={`font-medium ${statusClassName(status)}`}>
                          {STATUS_LABEL[status]}
                        </Td>
                        <Td>{row.name || '—'}</Td>
                        <Td>{row.siteNames.join(', ') || '—'}</Td>
                        <Td className="whitespace-pre-line text-muted-foreground">
                          {rowIssues(row) || '—'}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
            {result ? null : (
              <Button
                type="button"
                onClick={handleImport}
                disabled={saving || importable.length === 0 || existingStaff == null}
              >
                {saving
                  ? `Importing ${progress?.done ?? 0} of ${progress?.total ?? importable.length}…`
                  : `Import ${importable.length} staff`}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Import result</CardTitle>
            <CardDescription>
              {result.created} created. {result.skipped.length} skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PageSuccess>
              {result.created}{' '}
              {result.created === 1 ? 'person was' : 'people were'} added.
            </PageSuccess>
            {result.skipped.length > 0 ? (
              <>
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <THead>
                      <Th>Row</Th>
                      <Th>Reason</Th>
                    </THead>
                    <tbody>
                      {result.skipped.map((row, index) => (
                        <Tr key={`${row.rowNumber}-${index}`}>
                          <Td>{row.rowNumber}</Td>
                          <Td className="text-muted-foreground">{row.reason}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <Button type="button" variant="outline" onClick={handleSkippedCsv}>
                  Download skipped rows
                </Button>
              </>
            ) : (
              <PageMuted>Nothing was skipped.</PageMuted>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
