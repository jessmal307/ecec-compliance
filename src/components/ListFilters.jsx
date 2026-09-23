import { Search } from 'lucide-react'
import { Input, Select } from './ui/form'

export const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'current', label: 'Current' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'missing', label: 'Missing' },
  { value: 'archived', label: 'Archived' },
]

export const EMPLOYMENT_FILTERS = [
  { value: '', label: 'All staff' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
]

export const ARCHIVE_VIEW_FILTERS = [
  { value: '', label: 'Current' },
  { value: 'archived', label: 'Archived' },
]

export function normalizeQuery(query) {
  return query.trim().toLowerCase()
}

export function matchesQuery(value, query) {
  if (!query) return true
  return String(value ?? '')
    .toLowerCase()
    .includes(query)
}

export function matchesAnyQuery(query, ...values) {
  if (!query) return true
  return values.some((value) => matchesQuery(value, query))
}

export function matchesItemStatus(statusFilter, computedStatus) {
  if (!statusFilter) return true
  if (statusFilter === 'current') return computedStatus === 'Valid'
  if (statusFilter === 'expiring') return computedStatus === 'Expiring soon'
  if (statusFilter === 'expired') return computedStatus === 'Expired'
  if (statusFilter === 'missing') return computedStatus === 'Missing'
  return true
}

export function ListFilters({
  query,
  onQueryChange,
  queryPlaceholder = 'Search by name',
  status,
  onStatusChange,
  statusOptions = STATUS_FILTERS,
  statusLabel = 'Filter by status',
  siteId,
  onSiteChange,
  sites = [],
  includeUnassigned = false,
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-(--card-spacing) pb-(--card-spacing) sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={queryPlaceholder}
          className="pl-10"
          aria-label={queryPlaceholder}
        />
      </div>
      {onStatusChange ? (
        <Select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-label={statusLabel}
          className="sm:w-40"
        >
          {statusOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : null}
      {onSiteChange ? (
        <Select
          value={siteId}
          onChange={(event) => onSiteChange(event.target.value)}
          aria-label="Filter by site"
          className="sm:w-44"
        >
          <option value="">All sites</option>
          {includeUnassigned ? (
            <option value="unassigned">No site assigned</option>
          ) : null}
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}
