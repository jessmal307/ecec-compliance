export function isArchived(row) {
  return row?.archived_at != null && row.archived_at !== ''
}

export function withArchiveScope(query, { archivedOnly = false } = {}) {
  return archivedOnly
    ? query.not('archived_at', 'is', null)
    : query.is('archived_at', null)
}

export function isListedComplianceItem(item, { archivedOnly = false } = {}) {
  if (archivedOnly) return isArchived(item)
  return !isArchived(item) && !isArchived({ archived_at: item.ownerArchivedAt })
}
