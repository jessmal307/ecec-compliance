import { Badge } from '@/components/ui/badge'

const STYLES = {
  Expired: 'border-transparent bg-status-expired text-status-expired-foreground',
  'Recheck due':
    'border-transparent bg-status-expired text-status-expired-foreground',
  'Expiring soon':
    'border-transparent bg-status-soon text-status-soon-foreground',
  Valid: 'border-transparent bg-status-valid text-status-valid-foreground',
  Missing:
    'border-status-expired/40 bg-status-expired-muted text-status-expired',
  Compliant:
    'border-transparent bg-status-valid text-status-valid-foreground',
  'Action needed':
    'border-transparent bg-status-expired text-status-expired-foreground',
  Active: 'border-transparent bg-status-valid text-status-valid-foreground',
}

export function StatusBadge({ status, children }) {
  if (status === 'Not applicable' || status === 'Inactive' || status === 'Archived') {
    return (
      <Badge variant="secondary" className="max-w-none shrink-0">
        {children ?? status}
      </Badge>
    )
  }

  return (
    <Badge className={`max-w-none shrink-0 ${STYLES[status] ?? STYLES.Valid}`}>
      {children ?? status}
    </Badge>
  )
}

const LEGEND_ITEMS = [
  {
    status: 'Valid',
    label: 'Current',
    meaning: 'valid and in date',
  },
  {
    status: 'Expiring soon',
    label: 'Expiring',
    meaning: 'valid but due soon',
  },
  {
    status: 'Expired',
    label: 'Expired',
    meaning: 'past its expiry date',
  },
  {
    status: 'Missing',
    label: 'Missing',
    meaning: 'required but no record yet',
  },
]

export function StatusLegend({ className = '' }) {
  return (
    <div className={className}>
      <p className="sr-only">Status key</p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {LEGEND_ITEMS.map((item) => (
          <li key={item.label} className="inline-flex items-center gap-1.5">
            <StatusBadge status={item.status}>{item.label}</StatusBadge>
            <span>{item.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
