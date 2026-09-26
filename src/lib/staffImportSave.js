import { supabase } from './supabase'

const BATCH_SIZE = 50
const ITEM_BATCH_SIZE = 200

function chunk(list, size) {
  const batches = []
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size))
  }
  return batches
}

export async function listStaffForImportMatch(orgId) {
  const rows = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('staff')
      .select('id, name, email, archived_at')
      .eq('org_id', orgId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }

  return { data: rows, error: null }
}

async function rollbackStaff(ids) {
  if (!ids.length) return null
  const { error } = await supabase.from('staff').delete().in('id', ids)
  return error ?? null
}

function staffPayload(row, orgId) {
  return {
    name: row.name,
    role: row.role,
    employment_status: row.employmentStatus,
    start_date: row.startDate || null,
    email: row.email || null,
    phone: row.phone || null,
    org_id: orgId,
  }
}

function itemPayload(certificate, staffId, orgId) {
  return {
    requirement_type_id: certificate.requirementTypeId,
    label: certificate.label,
    expiry_date: certificate.expiryDate || null,
    reference_number: certificate.referenceNumber || null,
    issued_date: certificate.issuedDate || null,
    issuer: null,
    status: 'current',
    last_verified_date: null,
    working_towards: false,
    working_towards_target: null,
    org_id: orgId,
    staff_id: staffId,
    site_id: null,
  }
}

async function writePeople(rows, orgId) {
  const { data, error } = await supabase
    .from('staff')
    .insert(rows.map((row) => staffPayload(row, orgId)))
    .select('id')

  if (error) return { error }
  const ids = (data ?? []).map((row) => row.id)
  if (ids.length !== rows.length) {
    const rollbackError = await rollbackStaff(ids)
    return {
      orphaned: Boolean(rollbackError),
      error: rollbackError ?? {
        message: 'The staff insert did not return every row.',
      },
    }
  }

  const links = []
  rows.forEach((row, index) => {
    for (const siteId of row.siteIds ?? []) {
      links.push({ staff_id: ids[index], site_id: siteId })
    }
  })
  if (links.length) {
    const { error: linkError } = await supabase.from('staff_sites').insert(links)
    if (linkError) {
      const rollbackError = await rollbackStaff(ids)
      return {
        orphaned: Boolean(rollbackError),
        error: rollbackError
          ? { message: `${linkError.message} Those staff rows could not be removed.` }
          : linkError,
      }
    }
  }

  const items = []
  rows.forEach((row, index) => {
    for (const certificate of row.certificates ?? []) {
      items.push(itemPayload(certificate, ids[index], orgId))
    }
  })
  for (const itemBatch of chunk(items, ITEM_BATCH_SIZE)) {
    const { error: itemError } = await supabase
      .from('compliance_items')
      .insert(itemBatch)
    if (itemError) {
      const rollbackError = await rollbackStaff(ids)
      return {
        orphaned: Boolean(rollbackError),
        error: rollbackError
          ? {
              message: `${itemError.message} Those staff rows could not be removed.`,
            }
          : itemError,
      }
    }
  }

  return { error: null }
}

function failedRow(row, message) {
  return {
    rowNumber: row.rowNumber,
    raw: row.raw,
    reason: message,
  }
}

async function saveBatch(batch, orgId) {
  const bulk = await writePeople(batch, orgId)
  if (!bulk.error) return { created: batch.length, failed: [] }
  if (bulk.orphaned) {
    return {
      created: 0,
      failed: batch.map((row) => failedRow(row, bulk.error.message)),
    }
  }

  const failed = []
  let created = 0
  for (const row of batch) {
    const one = await writePeople([row], orgId)
    if (one.error) failed.push(failedRow(row, one.error.message))
    else created += 1
  }
  return { created, failed }
}

export async function saveStaffImport({ orgId, rows, onProgress }) {
  const ready = rows ?? []
  let created = 0
  const failed = []
  let done = 0

  for (const batch of chunk(ready, BATCH_SIZE)) {
    const result = await saveBatch(batch, orgId)
    created += result.created
    failed.push(...result.failed)
    done += batch.length
    onProgress?.({ done, total: ready.length })
  }

  return { created, failed }
}
