import * as XLSX from 'xlsx'

export const STAFF_IMPORT_FIELDS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'role', label: 'Role' },
  { key: 'employmentStatus', label: 'Employment status' },
  { key: 'startDate', label: 'Start date' },
]

const FIELD_ALIASES = {
  firstName: ['first name', 'firstname', 'given name', 'given names', 'forename'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  fullName: ['full name', 'staff name', 'employee name', 'educator name', 'name'],
  email: ['email address', 'e mail', 'email'],
  phone: ['mobile phone', 'contact number', 'telephone', 'mobile', 'phone'],
  role: ['job title', 'position', 'role'],
  employmentStatus: ['employment status', 'status', 'employment'],
  startDate: ['start date', 'date started', 'employment start', 'commenced', 'start'],
  site: ['centre name', 'center name', 'service name', 'location', 'centre', 'center', 'service', 'site'],
}

const BLANK_ROLE = 'Staff'

export function isStaffImportFilename(name) {
  const lower = String(name ?? '').toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.xlsx')
}

function cellText(value) {
  if (value == null) return ''
  return String(value).replace(/\u00a0/g, ' ').trim()
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

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isoFromParts(year, month, day) {
  if (!isRealDate(year, month, day) || year < 1900 || year > 2200) return ''
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function spreadsheetFormat() {
  return XLSX.SSF ?? XLSX.default?.SSF
}

export function excelSerialToIso(serial) {
  if (!Number.isFinite(serial)) return ''
  const whole = Math.floor(serial)
  if (whole < 1 || whole > 80000) return ''
  const parsed = spreadsheetFormat().parse_date_code(serial)
  if (!parsed?.y) return ''
  return isoFromParts(parsed.y, parsed.m, parsed.d)
}

function cellDisplay(cell) {
  if (!cell || cell.v == null || cell.v === '') return ''
  if (cell.t === 'n' && spreadsheetFormat().is_date(cell.z)) {
    return excelSerialToIso(Number(cell.v)) || ''
  }
  if (cell.t === 'd' && cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    return (
      isoFromParts(
        cell.v.getFullYear(),
        cell.v.getMonth() + 1,
        cell.v.getDate(),
      ) || ''
    )
  }
  if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE'
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    if (Number.isInteger(cell.v) && Math.abs(cell.v) < 1e15) return String(cell.v)
    return String(cell.v)
  }
  return cellText(cell.v)
}

export function sheetToRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet?.['!ref']) return []
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const rows = []
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = []
    row.excelRow = rowIndex + 1
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
      row.push(cellDisplay(sheet[address]))
    }
    rows.push(row)
  }
  return rows
}

export function rowsToPreview(rows, headerRowIndex) {
  const safeIndex = Number.isInteger(headerRowIndex)
    ? Math.max(0, headerRowIndex)
    : detectHeaderRowIndex(rows)
  const headerRow = rows[safeIndex] ?? []
  const body = []
  rows.forEach((row, index) => {
    if (index <= safeIndex || isEmptyRow(row)) return
    body.push({ row, rowNumber: row.excelRow ?? index + 1 })
  })
  const width = Math.max(
    headerRow.length,
    ...body.map((entry) => entry.row.length),
    0,
  )
  const columns = uniqueHeaders(headerRow, width)
  const records = body.map(({ row, rowNumber }) => {
    const record = { __row: rowNumber }
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
      cellDates: false,
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

function normHeader(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasWord(header, word) {
  return ` ${header} `.includes(` ${word} `)
}

function findColumn(columns, used, aliases) {
  const headers = columns.map((column) => ({
    column,
    header: normHeader(column),
  }))
  for (const alias of aliases) {
    const exact = headers.find(
      (entry) => !used.has(entry.column) && entry.header === alias,
    )
    if (exact) return exact.column
  }
  for (const alias of aliases) {
    if (!alias.includes(' ')) continue
    const partial = headers.find(
      (entry) => !used.has(entry.column) && entry.header.includes(alias),
    )
    if (partial) return partial.column
  }
  return ''
}

function blankCertificateColumns() {
  return { expiry: '', issued: '', number: '' }
}

export function emptyStaffMapping() {
  return Object.fromEntries(STAFF_IMPORT_FIELDS.map((field) => [field.key, '']))
}

export function guessStaffImportColumns(columns, requirementTypes) {
  const used = new Set()
  const mapping = emptyStaffMapping()
  const guessOrder = [
    'email',
    'phone',
    'firstName',
    'lastName',
    'employmentStatus',
    'startDate',
    'role',
    'site',
    'fullName',
  ]

  let siteColumn = ''
  for (const key of guessOrder) {
    const column = findColumn(columns, used, FIELD_ALIASES[key])
    if (!column) continue
    used.add(column)
    if (key === 'site') siteColumn = column
    else mapping[key] = column
  }

  const certificates = {}
  for (const type of requirementTypes ?? []) {
    const name = normHeader(type.name)
    const picked = blankCertificateColumns()
    if (name) {
      for (const column of columns) {
        if (used.has(column)) continue
        const header = normHeader(column)
        if (!header.includes(name)) continue
        if (
          !picked.expiry &&
          (hasWord(header, 'expiry') ||
            hasWord(header, 'expires') ||
            header.includes('expiration'))
        ) {
          picked.expiry = column
        } else if (
          !picked.issued &&
          (hasWord(header, 'issued') ||
            hasWord(header, 'completed') ||
            header.includes('completion') ||
            header.includes('issue date') ||
            header.includes('date issued') ||
            header.includes('date completed'))
        ) {
          picked.issued = column
        } else if (
          !picked.number &&
          (hasWord(header, 'number') ||
            hasWord(header, 'id') ||
            hasWord(header, 'reference'))
        ) {
          picked.number = column
        }
      }
    }
    for (const column of Object.values(picked)) {
      if (column) used.add(column)
    }
    certificates[type.id] = picked
  }

  return { mapping, siteColumn, certificates }
}

export function parseImportDate(value) {
  let text = cellText(value).replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, '')
  if (!text) return { empty: true }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) {
    const formatted = isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return formatted
      ? { iso: formatted }
      : { error: `Invalid date "${cellText(value)}".` }
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text)
  if (slash) {
    let year = Number(slash[3])
    if (slash[3].length === 2) year = year <= 49 ? 2000 + year : 1900 + year
    const formatted = isoFromParts(year, Number(slash[2]), Number(slash[1]))
    return formatted
      ? { iso: formatted }
      : { error: `Invalid date "${cellText(value)}".` }
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const formatted = excelSerialToIso(Number(text))
    return formatted
      ? { iso: formatted }
      : { error: `Invalid date "${cellText(value)}".` }
  }

  return { error: `Invalid date "${cellText(value)}".` }
}

export function splitSiteNames(value) {
  return cellText(value)
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeName(value) {
  return cellText(value).replace(/\s+/g, ' ').toLowerCase()
}

function normalizeEmail(value) {
  return cellText(value).toLowerCase()
}

function parseEmploymentStatus(value) {
  const text = cellText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!text) return { status: 'active' }
  if (text === 'active' || text === 'current') return { status: 'active' }
  if (text === 'inactive') return { status: 'inactive' }
  if (text === 'on leave' || text === 'leave') return { status: 'on_leave' }
  return {
    status: 'active',
    warning: `Employment status "${cellText(value)}" is not active, inactive, or on leave. Saved as Active.`,
  }
}

function mappedValue(record, column) {
  if (!column) return ''
  return cellText(record[column])
}

function pushMessage(list, code, message) {
  list.push({ code, message })
}

export function certificateFromCells({
  type,
  expiryText,
  issuedText,
  numberText,
  today,
  suggestExpiry,
}) {
  const errors = []
  const warnings = []
  const label = type?.name ?? 'Certificate'
  const number = cellText(numberText)
  const expiryParsed = expiryText ? parseImportDate(expiryText) : { empty: true }
  const issuedParsed = issuedText ? parseImportDate(issuedText) : { empty: true }

  if (expiryParsed.error) {
    pushMessage(errors, 'date', `${label} expiry: ${expiryParsed.error}`)
  }
  if (issuedParsed.error) {
    pushMessage(errors, 'date', `${label} issued date: ${issuedParsed.error}`)
  }
  if (errors.length) return { record: null, errors, warnings }

  const expiry = expiryParsed.iso ?? ''
  const issued = issuedParsed.iso ?? ''
  if (issued && today && issued > today) {
    pushMessage(errors, 'date', `${label} issued date is in the future.`)
    return { record: null, errors, warnings }
  }

  const perpetual = Boolean(type?.perpetual)
  if (expiry && issued && issued > expiry) {
    pushMessage(errors, 'date', `${label} issued date is after expiry.`)
    return { record: null, errors, warnings }
  }

  if (!expiry && !issued && !number) return { record: null, errors, warnings }

  if (!expiry && !issued && number && !perpetual) {
    pushMessage(
      warnings,
      'certificate',
      `${label} number ignored because there is no expiry or issued date.`,
    )
    return { record: null, errors, warnings }
  }

  let expiryDate = expiry
  if (!expiry && issued && !perpetual) {
    expiryDate = suggestExpiry?.(issued, type?.validity_months) ?? ''
    if (!expiryDate) {
      pushMessage(
        errors,
        'date',
        `${label} has an issued date but no validity period, so an expiry cannot be calculated.`,
      )
      return { record: null, errors, warnings }
    }
  }

  return {
    record: {
      requirementTypeId: type.id,
      label,
      expiryDate: expiryDate || null,
      issuedDate: issued || null,
      referenceNumber: number || null,
    },
    errors,
    warnings,
  }
}

function matchSites(value, sites) {
  const names = splitSiteNames(value)
  if (names.length === 0) {
    return { errors: [{ code: 'site', message: 'Missing site.' }], sites: [] }
  }

  const errors = []
  const matched = []
  const seen = new Set()
  for (const name of names) {
    const hits = (sites ?? []).filter(
      (site) => cellText(site.name).toLowerCase() === name.toLowerCase(),
    )
    if (hits.length === 0) {
      pushMessage(errors, 'site', `Unknown site "${name}".`)
    } else if (hits.length > 1) {
      pushMessage(errors, 'site', `Site name "${name}" matches more than one site.`)
    } else if (!seen.has(hits[0].id)) {
      seen.add(hits[0].id)
      matched.push(hits[0])
    }
  }
  return { errors, sites: matched }
}

function personName(record, mapping) {
  const first = mappedValue(record, mapping.firstName)
  const last = mappedValue(record, mapping.lastName)
  if (mapping.firstName || mapping.lastName) {
    return [first, last].filter(Boolean).join(' ')
  }
  return mappedValue(record, mapping.fullName).replace(/\s+/g, ' ')
}

export function validateStaffImport({
  records,
  columns,
  mapping,
  siteMode,
  siteColumn,
  selectedSite,
  sites,
  certificateColumns,
  requirementTypes,
  existingStaff,
  today,
  maxStartDate,
  suggestExpiry,
}) {
  const types = requirementTypes ?? []
  const existingEmails = new Map()
  const existingNames = new Map()
  for (const member of existingStaff ?? []) {
    const email = normalizeEmail(member.email)
    const name = normalizeName(member.name)
    if (email && !existingEmails.has(email)) existingEmails.set(email, member)
    if (name && !existingNames.has(name)) existingNames.set(name, member)
  }

  const claimedEmails = new Set()
  const claimedNames = new Set()
  const rows = []

  for (const record of records ?? []) {
    const errors = []
    const warnings = []
    const name = personName(record, mapping)
    if (!name) pushMessage(errors, 'name', 'Missing name.')

    const email = mappedValue(record, mapping.email)
    const phone = mappedValue(record, mapping.phone)
    let role = mappedValue(record, mapping.role)
    if (!role) {
      role = BLANK_ROLE
      pushMessage(warnings, 'role', 'Role is blank. Saved as Staff.')
    }

    const employment = parseEmploymentStatus(
      mappedValue(record, mapping.employmentStatus),
    )
    if (employment.warning) {
      pushMessage(warnings, 'employment', employment.warning)
    }

    let startDate = ''
    const startText = mappedValue(record, mapping.startDate)
    if (startText) {
      const parsed = parseImportDate(startText)
      if (parsed.error) pushMessage(errors, 'date', `Start date: ${parsed.error}`)
      else {
        startDate = parsed.iso
        if (maxStartDate && startDate > maxStartDate) {
          pushMessage(warnings, 'date', 'Start date is more than 15 years ahead.')
        }
      }
    }

    let siteIds = []
    let siteNames = []
    if (siteMode === 'column') {
      if (!siteColumn) {
        pushMessage(errors, 'site', 'Choose the site column.')
      } else {
        const matched = matchSites(mappedValue(record, siteColumn), sites)
        errors.push(...matched.errors)
        siteIds = matched.sites.map((site) => site.id)
        siteNames = matched.sites.map((site) => site.name)
      }
    } else if (!selectedSite) {
      pushMessage(errors, 'site', 'Select a site.')
    } else {
      siteIds = [selectedSite.id]
      siteNames = [selectedSite.name]
    }

    const certificates = []
    for (const type of types) {
      const columnsForType = certificateColumns?.[type.id] ?? blankCertificateColumns()
      const outcome = certificateFromCells({
        type,
        expiryText: mappedValue(record, columnsForType.expiry),
        issuedText: mappedValue(record, columnsForType.issued),
        numberText: mappedValue(record, columnsForType.number),
        today,
        suggestExpiry,
      })
      errors.push(...outcome.errors)
      warnings.push(...outcome.warnings)
      if (outcome.record) certificates.push(outcome.record)
    }

    const emailKey = normalizeEmail(email)
    const nameKey = normalizeName(name)
    if (name) {
      if (emailKey) {
        const existing = existingEmails.get(emailKey)
        if (existing) {
          const who = existing.archived_at
            ? 'an archived staff member'
            : 'an existing staff member'
          pushMessage(errors, 'duplicate', `Duplicate of ${who} (email).`)
        } else if (claimedEmails.has(emailKey)) {
          pushMessage(
            errors,
            'duplicate',
            'Duplicate of an earlier row in this file (email).',
          )
        }
      } else if (nameKey) {
        const existing = existingNames.get(nameKey)
        if (existing) {
          const who = existing.archived_at
            ? 'an archived staff member'
            : 'an existing staff member'
          pushMessage(errors, 'duplicate', `Duplicate of ${who} (name).`)
        } else if (claimedNames.has(nameKey)) {
          pushMessage(
            errors,
            'duplicate',
            'Duplicate of an earlier row in this file (name).',
          )
        }
      }
    }

    if (name && !errors.some((error) => error.code !== 'duplicate')) {
      if (emailKey) claimedEmails.add(emailKey)
      else if (nameKey) claimedNames.add(nameKey)
    }

    const status = errors.length ? 'error' : warnings.length ? 'warning' : 'ok'
    rows.push({
      rowNumber: record.__row,
      raw: Object.fromEntries(
        (columns ?? []).map((column) => [column, record[column] ?? '']),
      ),
      status,
      errors,
      warnings,
      name,
      email,
      phone,
      role,
      employmentStatus: employment.status,
      startDate,
      siteIds,
      siteNames,
      certificates,
    })
  }

  return rows
}

export function importRowWillSave(row, { importDuplicates = false, siteReady = true } = {}) {
  if (!siteReady || !row) return false
  return !row.errors.some((error) => error.code !== 'duplicate' || !importDuplicates)
}

export function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function staffImportTemplateCsv(requirementTypes) {
  const headers = [
    'First name',
    'Last name',
    'Email',
    'Phone',
    'Role',
    'Employment status',
    'Start date',
    'Site',
  ]
  for (const type of requirementTypes ?? []) {
    headers.push(`${type.name} expiry`, `${type.name} issued`, `${type.name} number`)
  }
  return `${headers.map(csvEscape).join(',')}\n`
}

export function skippedRowsCsv(columns, skipped) {
  const headers = ['Row', ...(columns ?? []), 'Reason']
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of skipped ?? []) {
    const cells = [
      row.rowNumber ?? '',
      ...(columns ?? []).map((column) => row.raw?.[column] ?? ''),
      row.reason ?? '',
    ]
    lines.push(cells.map(csvEscape).join(','))
  }
  return `${lines.join('\n')}\n`
}

export function rowIssues(row) {
  return [...(row?.errors ?? []), ...(row?.warnings ?? [])]
    .map((issue) => issue.message)
    .join('\n')
}
