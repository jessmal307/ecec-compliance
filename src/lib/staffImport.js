import * as XLSX from 'xlsx'

export function isStaffImportFilename(name) {
  const lower = String(name ?? '').toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.xlsx')
}

function cellText(value) {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

function isEmptyRow(row) {
  return !Array.isArray(row) || row.every((cell) => cellText(cell) === '')
}

function uniqueHeaders(cells, width) {
  const seen = new Map()
  const headers = []

  for (let index = 0; index < width; index += 1) {
    const raw = cellText(cells[index])
    const base = raw || `Column ${index + 1}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    headers.push(count === 1 ? base : `${base} (${count})`)
  }

  return headers
}

export function detectHeaderRowIndex(rows) {
  const index = rows.findIndex((row) => !isEmptyRow(row))
  return index < 0 ? 0 : index
}

export function pickDefaultSheetName(sheetNames) {
  const names = sheetNames ?? []
  const dataSheet = names.find(
    (name) => String(name).trim().toLowerCase() === 'data',
  )
  return dataSheet ?? names[0] ?? ''
}

export function sheetToRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  })
}

export function rowsToPreview(rows, headerRowIndex) {
  const safeIndex = Number.isInteger(headerRowIndex)
    ? Math.max(0, headerRowIndex)
    : detectHeaderRowIndex(rows)
  const headerRow = rows[safeIndex] ?? []
  const body = rows.slice(safeIndex + 1).filter((row) => !isEmptyRow(row))
  const width = Math.max(
    headerRow.length,
    ...body.map((row) => row.length),
    0,
  )
  const columns = uniqueHeaders(headerRow, width)
  const records = body.map((row) => {
    const record = {}
    columns.forEach((column, index) => {
      record[column] = cellText(row[index])
    })
    return record
  })

  return {
    headerRowIndex: safeIndex,
    columns,
    records,
    previewRows: records,
  }
}

export function parseStaffImportFile(file) {
  if (!file) {
    return { error: 'Choose a CSV or Excel file to import.' }
  }
  if (!isStaffImportFilename(file.name)) {
    return { error: 'Use a .csv or .xlsx file.' }
  }
  if (file.size === 0) {
    return { error: 'That file is empty.' }
  }

  return { error: null }
}

export async function readStaffImportWorkbook(file) {
  const typeError = parseStaffImportFile(file)
  if (typeError.error) return { data: null, error: typeError.error }

  try {
    const buffer = await file.arrayBuffer()
    if (buffer.byteLength === 0) {
      return { data: null, error: 'That file is empty.' }
    }

    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
    })
    const sheetNames = workbook.SheetNames ?? []
    if (sheetNames.length === 0) {
      return { data: null, error: 'That file has no sheets to read.' }
    }

    return { data: { workbook, sheetNames }, error: null }
  } catch {
    return {
      data: null,
      error: 'Could not read that file. Check it is a valid .csv or .xlsx.',
    }
  }
}

export function buildStaffImportPreview(workbook, sheetName, headerRowIndex) {
  const rows = sheetToRows(workbook, sheetName)
  if (rows.length === 0 || rows.every(isEmptyRow)) {
    return {
      error: 'That sheet is empty.',
      columns: [],
      records: [],
      previewRows: [],
      headerRowIndex: 0,
      rawRows: [],
    }
  }

  const preview = rowsToPreview(rows, headerRowIndex)
  if (preview.columns.length === 0) {
    return {
      error: 'Could not find a header row.',
      ...preview,
      rawRows: rows,
    }
  }

  if (preview.records.length === 0) {
    return {
      error: null,
      emptyData: true,
      ...preview,
      rawRows: rows,
    }
  }

  return {
    error: null,
    emptyData: false,
    ...preview,
    rawRows: rows,
  }
}
