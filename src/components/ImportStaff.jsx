import { useEffect, useState } from 'react'
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
import { Field, Select } from './ui/form'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import { listSites } from '../lib/sites'
import {
  buildStaffImportPreview,
  detectHeaderRowIndex,
  pickDefaultSheetName,
  readStaffImportWorkbook,
} from '../lib/staffImport'

function rowLabel(row, index) {
  const sample = (row ?? [])
    .map((cell) => String(cell ?? '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
  return sample ? `Row ${index + 1} — ${sample}` : `Row ${index + 1}`
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
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [assignedSite, setAssignedSite] = useState(null)

  function applyPreview(nextWorkbook, nextSheetName, nextHeaderIndex) {
    const result = buildStaffImportPreview(
      nextWorkbook,
      nextSheetName,
      nextHeaderIndex,
    )
    setPreview(result)
    setHeaderRowIndex(result.headerRowIndex)
    if (result.error) setError(result.error)
    else setError('')
    setAssignedSite(null)
  }

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function loadSites() {
      const { data, error: sitesError } = await listSites(organizationId)
      if (cancelled) return
      if (sitesError) {
        setError(sitesError.message)
        return
      }
      const rows = data ?? []
      setSites(rows)
      setSelectedSiteId((current) => current || rows[0]?.id || '')
    }

    loadSites()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  async function handleFile(file) {
    setError('')
    setPreview(null)
    setWorkbook(null)
    setSheetNames([])
    setSheetName('')
    setFileName(file?.name ?? '')

    if (!file) return

    setReading(true)
    const { data, error: readError } = await readStaffImportWorkbook(file)
    setReading(false)

    if (readError || !data) {
      setError(readError)
      return
    }

    const nextSheet = pickDefaultSheetName(data.sheetNames)
    const rows = buildStaffImportPreview(data.workbook, nextSheet, 0)
    setWorkbook(data.workbook)
    setSheetNames(data.sheetNames)
    setSheetName(nextSheet)
    applyPreview(
      data.workbook,
      nextSheet,
      rows.rawRows?.length ? detectHeaderRowIndex(rows.rawRows) : 0,
    )
  }

  function handleSheetChange(nextSheet) {
    setSheetName(nextSheet)
    if (!workbook) return
    const next = buildStaffImportPreview(workbook, nextSheet, 0)
    applyPreview(
      workbook,
      nextSheet,
      next.rawRows?.length ? detectHeaderRowIndex(next.rawRows) : 0,
    )
  }

  function handleHeaderChange(nextIndex) {
    if (!workbook) return
    applyPreview(workbook, sheetName, nextIndex)
  }

  function resetImport() {
    setFileName('')
    setWorkbook(null)
    setSheetNames([])
    setSheetName('')
    setHeaderRowIndex(0)
    setPreview(null)
    setAssignedSite(null)
    setError('')
    setInputKey((current) => current + 1)
  }

  function assignAllToSelectedSite() {
    const site = sites.find((row) => row.id === selectedSiteId)
    if (!site) {
      setError('Select a location first.')
      return
    }
    setError('')
    setAssignedSite({ id: site.id, name: site.name })
  }

  const columns = preview?.columns ?? []
  const records = preview?.records ?? []
  const rawRows = preview?.rawRows ?? []

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Import staff"
        description="Upload a spreadsheet to check that columns and rows read correctly. Nothing is saved yet."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={paths.staff}>Back to staff</Link>
          </Button>
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
              disabled={reading}
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
                {rawRows.map((row, index) => (
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
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {preview.emptyData
                ? 'Headers were found, but there are no data rows.'
                : `${records.length} ${records.length === 1 ? 'person' : 'people'} read from the file.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-card-foreground">
                Columns ({columns.length})
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {columns.join(' · ') || 'None'}
              </p>
            </div>
            {preview.emptyData ? (
              <PageMuted>No data rows under that header.</PageMuted>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <Field label="Location" className="sm:min-w-56 sm:flex-1">
                    {sites.length === 0 ? (
                      <p className="text-sm font-normal text-muted-foreground">
                        Add a site first, then assign everyone to it.{' '}
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
                        onChange={(event) =>
                          setSelectedSiteId(event.target.value)
                        }
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
                  <Button
                    type="button"
                    onClick={assignAllToSelectedSite}
                    disabled={sites.length === 0 || !selectedSiteId}
                  >
                    Assign all to this location
                  </Button>
                </div>
                {assignedSite ? (
                  <p className="text-sm text-muted-foreground">
                    All {records.length}{' '}
                    {records.length === 1 ? 'person is' : 'people are'} assigned
                    to {assignedSite.name}.
                  </p>
                ) : null}
                <Table>
                  <THead>
                    <Th>Location</Th>
                    {columns.map((column) => (
                      <Th key={column}>{column}</Th>
                    ))}
                  </THead>
                  <tbody>
                    {records.map((row, rowIndex) => (
                      <Tr key={rowIndex}>
                        <Td className="font-medium text-card-foreground">
                          {assignedSite?.name || '—'}
                        </Td>
                        {columns.map((column) => (
                          <Td key={column} className="text-muted-foreground">
                            {row[column] || '—'}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
