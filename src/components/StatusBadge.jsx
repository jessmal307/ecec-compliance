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

export function StatusBadge({ status }) {
  if (status === 'Not applicable' || status === 'Inactive') {
    return (
      <Badge variant="secondary" className="max-w-none shrink-0">
        {status}
      </Badge>
    )
  }

  return (
    <Badge className={`max-w-none shrink-0 ${STYLES[status] ?? STYLES.Valid}`}>
      {status}
    </Badge>
  )
}
