import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Choice, Field, Input, Select, Textarea } from './ui/form'
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
  STAFF_IMPORT_FIELDS,
  buildStaffImportPreview,
  centreColumnFromValues,
  columnMatchList,
  detectConfidentHeader,
  emptyStaffMapping,
  guessStaffImportColumns,
  importRowWillSave,
  plainIssue,
  readStaffImportWorkbook,
  skippedRowsCsv,
  staffImportTemplateCsv,
  validateStaffImport,
  workbookFromPaste,
} from '../lib/staffImport'
import {
  listStaffForImportMatch,
  saveStaffImport,
} from '../lib/staffImportSave'

const STEPS = [
  { id: 'add', label: 'Add your staff' },
  { id: 'columns', label: 'Check columns' },
  { id: 'review', label: 'Review staff' },
  { id: 'done', label: 'Done' },
]

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
    (types ?? []).map((type) => [type.id, { expiry: '', issued: '', number: '' }]),
  )
}

function applyName(record, mapping, name) {
  const trimmed = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (mapping.firstName || mapping.lastName) {
    if (mapping.firstName && mapping.lastName) {
      const parts = trimmed ? trimmed.split(' ') : []
      record[mapping.firstName] = parts.shift() ?? ''
      record[mapping.lastName] = parts.join(' ')
    } else if (mapping.firstName) {
      record[mapping.firstName] = trimmed
    } else {
      record[mapping.lastName] = trimmed
    }
    return
  }
  if (mapping.fullName) record[mapping.fullName] = trimmed
}

function destinationOptions(staffTypes) {
  return [
    { value: '', label: 'Ignore this column' },
    ...STAFF_IMPORT_FIELDS.map((field) => ({
      value: `field:${field.key}`,
      label: field.label,
    })),
    { value: 'centre', label: 'Centre' },
    ...staffTypes.flatMap((type) => [
      { value: `cert:${type.id}:expiry`, label: `${type.name} expiry date` },
      { value: `cert:${type.id}:issued`, label: `${type.name} date completed` },
      { value: `cert:${type.id}:number`, label: `${type.name} number` },
    ]),
  ]
}

function destinationValue(column, columnMap, staffTypes) {
  for (const [key, value] of Object.entries(columnMap.fields)) {
    if (value === column) return `field:${key}`
  }
  if (columnMap.siteColumn === column) return 'centre'
  for (const type of staffTypes) {
    const picked = columnMap.certificates[type.id] ?? {}
    if (picked.expiry === column) return `cert:${type.id}:expiry`
    if (picked.issued === column) return `cert:${type.id}:issued`
    if (picked.number === column) return `cert:${type.id}:number`
  }
  return ''
}

function dateFieldFor(row, mapping, certificates, types) {
  const issue = [...row.errors, ...row.warnings].find((item) => item.code === 'date')
  if (!issue) return null
  if (issue.message.startsWith('Start date') && mapping.startDate) {
    return { column: mapping.startDate, label: 'Start date' }
  }
  for (const type of types) {
    if (!issue.message.startsWith(type.name)) continue
    const picked = certificates[type.id] ?? {}
    if (issue.message.includes('issued') && picked.issued) {
      return { column: picked.issued, label: `${type.name} date completed` }
    }
    if (picked.expiry) return { column: picked.expiry, label: `${type.name} expiry date` }
    if (picked.issued) return { column: picked.issued, label: `${type.name} date completed` }
  }
  return null
}

function rowTone(row) {
  if (row.errors.length) return 'blocked'
  if (row.warnings.length) return 'check'
  return 'ready'
}

const TONE_LABEL = {
  ready: 'Ready',
  check: 'Check',
  blocked: "Can't import",
}

function toneClassName(tone) {
  if (tone === 'blocked') return 'text-status-expired'
  if (tone === 'check') return 'text-status-soon'
  return 'text-status-valid'
}

export function ImportStaff() {
  const { organizationId } = useAuth()
  const [step, setStep] = useState(0)
  const [inputKey, setInputKey] = useState(0)
  const [fileName, setFileName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [workbook, setWorkbook] = useState(null)
  const [sheetNames, setSheetNames] = useState([])
  const [sheetName, setSheetName] = useState('')
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [headerConfirmed, setHeaderConfirmed] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [sites, setSites] = useState([])
  const [staffTypes, setStaffTypes] = useState([])
  const [typesLoaded, setTypesLoaded] = useState(false)
  const [existingStaff, setExistingStaff] = useState(null)
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [columnMap, setColumnMap] = useState({
    fields: emptyStaffMapping(),
    siteColumn: '',
    certificates: {},
  })
  const [centreIgnored, setCentreIgnored] = useState(false)
  const [showAllMatches, setShowAllMatches] = useState(false)
  const [cellEdits, setCellEdits] = useState({})
  const [nameDrafts, setNameDrafts] = useState({})
  const [centreEdits, setCentreEdits] = useState({})
  const [skipped, setSkipped] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const headerPicked = useRef(false)

  const columns = preview?.columns ?? []
  const records = preview?.records ?? []
  const rawRows = preview?.rawRows ?? []
  const columnKey = columns.join('\0')
  const typeKey = staffTypes.map((type) => `${type.id}:${type.name}`).join('|')
  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null

  function clearRowEdits() {
    setCellEdits({})
    setNameDrafts({})
    setCentreEdits({})
    setSkipped(new Set())
  }

  function applyPreview(nextWorkbook, nextSheetName, nextHeaderIndex) {
    try {
      const next = buildStaffImportPreview(
        nextWorkbook,
        nextSheetName,
        nextHeaderIndex,
      )
      setPreview(next)
      setHeaderRowIndex(next.headerRowIndex)
      setError(next.error ?? '')
      clearRowEdits()
    } catch {
      setError("Couldn't read this file")
    }
  }

  function openWorkbook(data, name) {
    const nextSheet = data.sheetNames[0] ?? ''
    headerPicked.current = false
    setFileName(name)
    setWorkbook(data.workbook)
    setSheetNames(data.sheetNames)
    setSheetName(nextSheet)
    setShowAllMatches(false)
    setResult(null)
    setStep(0)
    try {
      const probe = buildStaffImportPreview(data.workbook, nextSheet, 0)
      if (probe.error && !probe.rawRows?.length) {
        setPreview(probe)
        setHeaderRowIndex(0)
        setHeaderConfirmed(true)
        setError(probe.error)
        return
      }
      const detected = detectConfidentHeader(probe.rawRows ?? [], staffTypes)
      setHeaderConfirmed(detected.confident)
      applyPreview(data.workbook, nextSheet, detected.index)
    } catch {
      setError("Couldn't read this file")
    }
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
    setCentreIgnored(false)
    setShowAllMatches(false)
  }, [columnKey, typeKey, staffTypes])

  useEffect(() => {
    if (!workbook || !sheetName || headerPicked.current || !rawRows.length) return
    const detected = detectConfidentHeader(rawRows, staffTypes)
    setHeaderConfirmed(detected.confident)
    if (detected.confident && detected.index !== headerRowIndex) {
      applyPreview(workbook, sheetName, detected.index)
    }
  }, [typeKey])

  const valueCentre = useMemo(
    () =>
      centreColumnFromValues(
        records,
        columns,
        sites,
        Object.values(columnMap.fields).filter(Boolean),
      ),
    [records, columns, sites, columnMap.fields],
  )
  const centreColumn = columnMap.siteColumn || (centreIgnored ? '' : valueCentre)
  const usingCentreColumn = Boolean(centreColumn)
  const matches = columnMatchList({
    columns,
    mapping: columnMap.fields,
    siteColumn: centreColumn,
    certificates: columnMap.certificates,
    requirementTypes: staffTypes,
  })
  const foundCertificates = staffTypes.filter((type) => {
    const picked = columnMap.certificates[type.id] ?? {}
    return picked.expiry || picked.issued || picked.number
  })

  const today = todayIsoDate()
  const validated = useMemo(() => {
    const edited = (preview?.records ?? []).map((record) => {
      const next = { ...record, ...(cellEdits[record.__row] ?? {}) }
      if (nameDrafts[record.__row] != null) {
        applyName(next, columnMap.fields, nameDrafts[record.__row])
      }
      const override = centreEdits[record.__row]
      if (usingCentreColumn) {
        if (override) next[centreColumn] = override
      } else {
        next.__centre = override || selectedSite?.name || ''
      }
      return next
    })
    return validateStaffImport({
      records: edited,
      columns: preview?.columns ?? [],
      mapping: columnMap.fields,
      siteMode: 'column',
      siteColumn: usingCentreColumn ? centreColumn : '__centre',
      selectedSite: null,
      sites,
      certificateColumns: columnMap.certificates,
      requirementTypes: staffTypes,
      existingStaff: existingStaff ?? [],
      today,
      maxStartDate: maxReasonableDate(today),
      suggestExpiry: suggestedExpiryFromIssuedDate,
    })
  }, [
    preview,
    cellEdits,
    nameDrafts,
    centreEdits,
    columnMap,
    usingCentreColumn,
    centreColumn,
    selectedSite,
    sites,
    staffTypes,
    existingStaff,
    today,
  ])

  const siteReady = usingCentreColumn || Boolean(selectedSite)
  const ready = validated.filter((row) => rowTone(row) === 'ready')
  const check = validated.filter((row) => rowTone(row) === 'check')
  const blocked = validated.filter((row) => rowTone(row) === 'blocked')
  const importable = [...ready, ...check].filter(
    (row) =>
      !skipped.has(row.rowNumber) &&
      importRowWillSave(row, { importDuplicates: false, siteReady }),
  )

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
  }

  function assignDestination(column, encoded) {
    if (column === centreColumn && encoded !== 'centre') setCentreIgnored(true)
    takeColumn(column, (next) => {
      if (!encoded) return
      if (encoded === 'centre') {
        next.siteColumn = column
        return
      }
      if (encoded.startsWith('field:')) {
        next.fields[encoded.slice('field:'.length)] = column
        return
      }
      const match = /^cert:(.+):(expiry|issued|number)$/.exec(encoded)
      if (!match) return
      const current = next.certificates[match[1]] ?? {
        expiry: '',
        issued: '',
        number: '',
      }
      next.certificates[match[1]] = { ...current, [match[2]]: column }
    })
  }

  async function handleFile(file) {
    setError('')
    setPreview(null)
    setPasteText('')
    if (!file) return
    setReading(true)
    const { data, error: readError } = await readStaffImportWorkbook(file)
    setReading(false)
    if (readError || !data) {
      setError(readError || "Couldn't read this file")
      return
    }
    openWorkbook(data, file.name)
  }

  function handlePaste() {
    setError('')
    const { data, error: readError } = workbookFromPaste(pasteText)
    if (readError || !data) {
      setError(readError || "Couldn't read this file")
      return
    }
    openWorkbook(data, 'Pasted from Excel')
  }

  function handleSheetChange(nextSheet) {
    if (!workbook) return
    headerPicked.current = false
    setSheetName(nextSheet)
    try {
      const probe = buildStaffImportPreview(workbook, nextSheet, 0)
      if (probe.error && !probe.rawRows?.length) {
        setPreview(probe)
        setError(probe.error)
        setHeaderConfirmed(true)
        return
      }
      const detected = detectConfidentHeader(probe.rawRows ?? [], staffTypes)
      setHeaderConfirmed(detected.confident)
      applyPreview(workbook, nextSheet, detected.index)
    } catch {
      setError("Couldn't read this file")
    }
  }

  function chooseHeader(index) {
    if (!workbook) return
    headerPicked.current = true
    setHeaderConfirmed(true)
    applyPreview(workbook, sheetName, index)
  }

  function resetImport() {
    headerPicked.current = false
    setStep(0)
    setFileName('')
    setPasteText('')
    setWorkbook(null)
    setSheetNames([])
    setSheetName('')
    setHeaderRowIndex(0)
    setHeaderConfirmed(false)
    setPreview(null)
    setError('')
    setResult(null)
    setProgress(null)
    setShowAllMatches(false)
    setCentreIgnored(false)
    clearRowEdits()
    setInputKey((current) => current + 1)
  }

  function toggleSkipped(rowNumber) {
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

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
    const failedNumbers = new Set(saved.failed.map((row) => row.rowNumber))
    const skippedRows = [
      ...validated
        .filter(
          (row) =>
            skipped.has(row.rowNumber) ||
            !importRowWillSave(row, { importDuplicates: false, siteReady }),
        )
        .map((row) => ({
          rowNumber: row.rowNumber,
          raw: row.raw,
          reason: skipped.has(row.rowNumber)
            ? 'Skipped.'
            : row.errors.map((issue) => plainIssue(issue)).join(' '),
        })),
      ...saved.failed.map((row) => ({
        ...row,
        reason: row.reason || "Couldn't add this person.",
      })),
    ]
    setResult({
      created: saved.created,
      skipped: skippedRows,
      imported: importable.filter((row) => !failedNumbers.has(row.rowNumber)),
    })
    setSaving(false)
    setProgress(null)
    setStep(3)
    const refreshed = await listStaffForImportMatch(organizationId)
    if (!refreshed.error) setExistingStaff(refreshed.data ?? [])
  }

  const missingCertificates = staffTypes
    .filter((type) => type.mandatory)
    .map((type) => ({
      name: type.name,
      count: (result?.imported ?? []).filter(
        (row) =>
          !row.certificates.some(
            (certificate) => certificate.requirementTypeId === type.id,
          ),
      ).length,
    }))
    .filter((line) => line.count > 0)

  const options = destinationOptions(staffTypes)
  const canContinueAdd = Boolean(preview && !preview.error && records.length && !reading)
  const canContinueColumns =
    headerConfirmed && (usingCentreColumn || Boolean(selectedSiteId)) && !preview?.error

  function renderMatchSelect(column) {
    return (
      <Select
        value={destinationValue(
          column,
          { ...columnMap, siteColumn: centreColumn },
          staffTypes,
        )}
        onChange={(event) => assignDestination(column, event.target.value)}
        aria-label={`What's in your ${column} column?`}
      >
        {options.map((option) => (
          <option key={option.value || 'ignore'} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    )
  }

  function renderReviewRow(row) {
    const tone = rowTone(row)
    const isSkipped = skipped.has(row.rowNumber)
    const dateField = dateFieldFor(
      row,
      columnMap.fields,
      columnMap.certificates,
      staffTypes,
    )
    const centreId =
      row.siteNames.length === 1
        ? sites.find(
            (site) => site.name.toLowerCase() === row.siteNames[0].toLowerCase(),
          )?.id ?? ''
        : ''
    const issues = [...row.errors, ...row.warnings].map((issue) => plainIssue(issue))
    return (
      <li key={row.rowNumber} className="space-y-3 border-b border-border py-4 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Field label="Name" className="min-w-0 flex-1 font-normal">
            <Input
              value={nameDrafts[row.rowNumber] ?? row.name}
              onChange={(event) =>
                setNameDrafts((current) => ({
                  ...current,
                  [row.rowNumber]: event.target.value,
                }))
              }
              aria-label={`Name for row ${row.rowNumber}`}
            />
          </Field>
          <p className={`pt-7 text-sm font-medium ${toneClassName(tone)}`}>
            {isSkipped ? 'Skipped' : TONE_LABEL[tone]}
          </p>
        </div>
        <Field label="Centre" className="font-normal">
          <Select
            value={centreId}
            onChange={(event) => {
              const site = sites.find((item) => item.id === event.target.value)
              if (!site) return
              setCentreEdits((current) => ({
                ...current,
                [row.rowNumber]: site.name,
              }))
            }}
            aria-label={`Centre for row ${row.rowNumber}`}
          >
            <option value="">
              {row.siteNames.join(', ') || 'Choose a centre'}
            </option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground">
          {row.certificates.length
            ? row.certificates.map((certificate) => certificate.label).join(', ')
            : 'No certificates in this row'}
        </p>
        {dateField ? (
          <Field label={dateField.label} className="font-normal">
            <Input
              value={row.raw[dateField.column] ?? ''}
              onChange={(event) =>
                setCellEdits((current) => ({
                  ...current,
                  [row.rowNumber]: {
                    ...(current[row.rowNumber] ?? {}),
                    [dateField.column]: event.target.value,
                  },
                }))
              }
              aria-label={dateField.label}
            />
          </Field>
        ) : null}
        {issues.length ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        {tone === 'blocked' ? null : (
          <Choice
            type="checkbox"
            checked={isSkipped}
            onChange={() => toggleSkipped(row.rowNumber)}
          >
            Skip this person
          </Choice>
        )}
      </li>
    )
  }

  function renderGroup(title, tone, rows) {
    if (!rows.length) return null
    return (
      <section className="space-y-2">
        <h3 className={`text-sm font-medium ${toneClassName(tone)}`}>
          {title} ({rows.length})
        </h3>
        <ul>{rows.map((row) => renderReviewRow(row))}</ul>
      </section>
    )
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 overflow-x-hidden text-left">
      <PageHeader
        title={STEPS[step].label}
        description="Nothing is saved until you choose Import."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={paths.staff}>Back to staff</Link>
          </Button>
        }
      />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Progress">
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className={[
              'rounded-lg border px-3 py-2 text-sm',
              index === step
                ? 'border-foreground bg-card font-medium text-card-foreground'
                : 'border-border text-muted-foreground',
            ].join(' ')}
            aria-current={index === step ? 'step' : undefined}
          >
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      <PageError>{error}</PageError>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add your staff</CardTitle>
            <CardDescription>
              Upload a spreadsheet, paste from Excel, or start from the template.
              The file stays in this browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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
              fileName={fileName && fileName !== 'Pasted from Excel' ? fileName : ''}
              onFile={handleFile}
            />
            <Field label="Paste from Excel">
              <Textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="Copy rows in Excel, including the column names, and paste them here."
                rows={6}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handlePaste} disabled={!pasteText.trim()}>
                Use pasted rows
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    staffImportTemplateCsv(staffTypes),
                    'staff-import-template.csv',
                  )
                }
                disabled={!typesLoaded}
              >
                Download template
              </Button>
            </div>
            {sheetNames.length > 1 ? (
              <Field label="Which sheet?">
                <Select
                  value={sheetName}
                  onChange={(event) => handleSheetChange(event.target.value)}
                  aria-label="Which sheet?"
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {fileName ? (
              <p className="text-sm text-muted-foreground">
                {records.length
                  ? `${records.length} ${records.length === 1 ? 'person' : 'people'} read from ${fileName}.`
                  : fileName}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setStep(1)} disabled={!canContinueAdd}>
                Continue
              </Button>
              {fileName ? (
                <Button type="button" variant="outline" onClick={resetImport}>
                  Start again
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Check columns</CardTitle>
            <CardDescription>
              {headerConfirmed
                ? `We matched ${matches.matched.length} of ${columns.length} columns.`
                : 'Which row has your column names?'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!headerConfirmed ? (
              <div className="space-y-2">
                {rawRows.slice(0, 10).map((row, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => chooseHeader(index)}
                    className={[
                      'w-full rounded-lg border px-3 py-2 text-left',
                      index === headerRowIndex
                        ? 'border-foreground'
                        : 'border-border',
                    ].join(' ')}
                  >
                    <span className="block text-xs text-muted-foreground">
                      Row {index + 1}
                    </span>
                    <span className="block truncate text-sm">
                      {(row ?? [])
                        .map((cell) => String(cell ?? '').trim())
                        .filter(Boolean)
                        .slice(0, 8)
                        .join(' · ') || 'Empty row'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <ul className="space-y-1 text-sm">
                  {matches.matched.map((match) => (
                    <li key={match.column}>
                      {match.column} → {match.label}
                    </li>
                  ))}
                </ul>
                {foundCertificates.length ? (
                  <p className="text-sm text-muted-foreground">
                    Certificates found:{' '}
                    {foundCertificates.map((type) => type.name).join(', ')}.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No certificate columns found. You can add certificates later.
                  </p>
                )}
                {matches.unmatched.map((column) => (
                  <Field key={column} label={`What's in your "${column}" column?`}>
                    {renderMatchSelect(column)}
                  </Field>
                ))}
                <button
                  type="button"
                  className="text-sm font-medium underline underline-offset-4"
                  onClick={() => setShowAllMatches((current) => !current)}
                >
                  {showAllMatches ? 'Hide match changes' : 'Change a match'}
                </button>
                {showAllMatches ? (
                  <div className="space-y-4">
                    {matches.matched.map((match) => (
                      <Field key={match.column} label={match.column}>
                        {renderMatchSelect(match.column)}
                      </Field>
                    ))}
                  </div>
                ) : null}
                {usingCentreColumn ? (
                  <p className="text-sm text-muted-foreground">
                    Centres come from the “{centreColumn}” column. Several centres
                    in one cell can be separated by ; or ,.
                  </p>
                ) : (
                  <Field label="Which centre do these staff work at?">
                    {sites.length === 0 ? (
                      <p className="text-sm font-normal text-muted-foreground">
                        Add a centre first.{' '}
                        <Link
                          to={paths.sites}
                          className="font-medium text-card-foreground underline underline-offset-2"
                        >
                          Add a centre
                        </Link>
                      </p>
                    ) : (
                      <Select
                        value={selectedSiteId}
                        onChange={(event) => {
                          setCentreIgnored(true)
                          setSelectedSiteId(event.target.value)
                        }}
                        aria-label="Which centre do these staff work at?"
                      >
                        <option value="">Choose a centre</option>
                        {sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline underline-offset-4"
                  onClick={() => {
                    headerPicked.current = false
                    setHeaderConfirmed(false)
                  }}
                >
                  Choose a different row
                </button>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={!canContinueColumns}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review staff</CardTitle>
            <CardDescription>
              {existingStaff == null
                ? 'Checking who is already on file…'
                : `${importable.length} ${importable.length === 1 ? 'person' : 'people'} will be added.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderGroup('Ready', 'ready', ready)}
            {renderGroup('Check these', 'check', check)}
            {renderGroup("Can't import", 'blocked', blocked)}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={saving}>
                Back
              </Button>
              <Button
                type="button"
                onClick={handleImport}
                disabled={saving || importable.length === 0 || existingStaff == null}
              >
                {saving
                  ? `Adding ${progress?.done ?? 0} of ${progress?.total ?? importable.length}…`
                  : `Import ${importable.length} staff`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && result ? (
        <Card>
          <CardHeader>
            <CardTitle>Added {result.created} staff</CardTitle>
            <CardDescription>
              {result.skipped.length
                ? `${result.skipped.length} not added.`
                : 'Everyone in the file was added.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PageSuccess>
              Added {result.created} staff.
            </PageSuccess>
            {missingCertificates.length ? (
              <ul className="space-y-1 text-sm">
                {missingCertificates.map((line) => (
                  <li key={line.name}>
                    {line.count} {line.count === 1 ? 'has' : 'have'} no {line.name} on file.
                  </li>
                ))}
              </ul>
            ) : (
              <PageMuted>Every mandatory certificate in this import has a date or number.</PageMuted>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={paths.gaps}>Gaps</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={paths.staff}>Upload certificates</Link>
              </Button>
              {result.skipped.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      skippedRowsCsv(columns, result.skipped),
                      `staff-import-skipped-${sydneyToday()}.csv`,
                    )
                  }
                >
                  Download rows not added
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={resetImport}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
