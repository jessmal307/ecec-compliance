import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import {
  buildStaffImportPreview,
  centreColumnFromValues,
  detectConfidentHeader,
  parseImportDate,
  plainIssue,
  sheetToRows,
  workbookFromPaste,
} from './staffImport.js'

function workbookWithSheet(sheet, name = 'Data') {
  return { SheetNames: [name], Sheets: { [name]: sheet } }
}

test('reads a date cell, a plain number, text dates, and blanks', () => {
  const sheet = {
    '!ref': 'A1:E3',
    A1: { t: 's', v: 'Name' },
    B1: { t: 's', v: 'Started' },
    C1: { t: 's', v: 'Count' },
    D1: { t: 's', v: 'Text date' },
    E1: { t: 's', v: 'Blank' },
    A2: { t: 's', v: 'Ada' },
    B2: { t: 'n', v: 46054, z: 'dd/mm/yyyy' },
    C2: { t: 'n', v: 42 },
    D2: { t: 's', v: '1/2/26' },
    E2: { t: 's', v: '' },
    A3: { t: 's', v: 'Bea' },
    B3: { t: 's', v: '2026-03-04' },
    C3: { t: 'n', v: 7 },
    D3: { t: 's', v: '13/02/2026' },
  }

  assert.equal(sheet.C2.z, undefined)
  assert.equal(XLSX.SSF ?? XLSX.default.SSF, XLSX.default?.SSF ?? XLSX.SSF)

  const rows = sheetToRows(workbookWithSheet(sheet), 'Data')
  assert.equal(rows[1][1], '2026-02-01')
  assert.equal(rows[1][2], '42')
  assert.equal(rows[1][3], '1/2/26')
  assert.equal(rows[1][4], '')
  assert.equal(rows[2][1], '2026-03-04')
  assert.equal(rows[2][2], '7')
  assert.equal(rows[2][4], '')

  const preview = buildStaffImportPreview(workbookWithSheet(sheet), 'Data', 0)
  assert.equal(preview.error, null)
  assert.equal(preview.records[0].Started, '2026-02-01')
  assert.equal(preview.records[0].Count, '42')
  assert.equal(preview.records[0]['Text date'], '1/2/26')
  assert.equal(preview.records[0].Blank, '')
  assert.equal(parseImportDate(preview.records[0]['Text date']).iso, '2026-02-01')
  assert.equal(parseImportDate(preview.records[1]['Text date']).iso, '2026-02-13')
  assert.equal(parseImportDate(preview.records[1].Started).iso, '2026-03-04')
})

test('a sheet that cannot be parsed returns an error instead of throwing', () => {
  const sheet = {}
  Object.defineProperty(sheet, '!ref', {
    get() {
      throw new Error('bad sheet')
    },
  })

  const preview = buildStaffImportPreview(workbookWithSheet(sheet), 'Data', 0)
  assert.equal(preview.error, "Couldn't read this file")
  assert.deepEqual(preview.records, [])
})

test('picks a column-name row when at least three cells match, and asks when unsure', () => {
  const types = [{ id: 'wwcc', name: 'WWCC' }]
  const sure = detectConfidentHeader(
    [
      ['Staff list export'],
      ['Given name', 'Surname', 'Email', 'WWCC expiry'],
      ['Ada', 'Lovelace', 'ada@example.com', '1/2/26'],
    ],
    types,
  )
  assert.equal(sure.confident, true)
  assert.equal(sure.index, 1)

  const tie = detectConfidentHeader(
    [
      ['Given name', 'Surname', 'Email', 'Phone'],
      ['First name', 'Last name', 'Email address', 'Mobile'],
    ],
    types,
  )
  assert.equal(tie.confident, false)

  const weak = detectConfidentHeader([['Notes'], ['Hello', 'There']], types)
  assert.equal(weak.confident, false)
})

test('uses a column as centres when at least half the values match', () => {
  const sites = [{ id: '1', name: 'Bondi' }, { id: '2', name: 'Parramatta' }]
  const records = [
    { Name: 'Ada', Place: 'Bondi' },
    { Name: 'Bea', Place: 'parramatta' },
    { Name: 'Cam', Place: 'Bondi; Parramatta' },
    { Name: 'Dee', Place: 'No such centre' },
  ]
  assert.equal(
    centreColumnFromValues(records, ['Name', 'Place'], sites, ['Name']),
    'Place',
  )
  assert.equal(
    centreColumnFromValues(
      [
        { Place: 'Bondi' },
        { Place: 'Nope' },
        { Place: 'Also nope' },
      ],
      ['Place'],
      sites,
      [],
    ),
    '',
  )
})

test('plain reasons and pasted rows', () => {
  assert.equal(
    plainIssue({ code: 'site', message: 'Unknown centre "West".' }),
    '“West” isn’t one of your centres.',
  )
  const pasted = workbookFromPaste(
    'Given name\tSurname\tEmail\nAda\tLovelace\tada@example.com',
  )
  assert.equal(pasted.error, null)
  const preview = buildStaffImportPreview(
    pasted.data.workbook,
    pasted.data.sheetNames[0],
    0,
  )
  assert.equal(preview.error, null)
  assert.equal(preview.records[0]['Given name'], 'Ada')
  assert.equal(preview.records[0].Email, 'ada@example.com')
})
