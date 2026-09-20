import { AlertTriangle, Clock, ShieldCheck, UserRoundX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DocumentAttached } from './DocumentLink'
import { StatusBadge } from './StatusBadge'
import { formatDate, formatRelativeExpiry } from '../lib/format'

const COUNT_STATS = [
  {
    key: 'current',
    label: 'Current',
    hint: 'In date',
    icon: ShieldCheck,
    tone: 'valid',
  },
  {
    key: 'expiring',
    label: 'Expiring',
    hint: 'Due within 30 days',
    icon: Clock,
    tone: 'soon',
  },
  {
    key: 'expired',
    label: 'Expired',
    hint: 'Past expiry date',
    icon: AlertTriangle,
    tone: 'expired',
  },
  {
    key: 'missing',
    label: 'Missing',
    hint: 'No record on file',
    icon: UserRoundX,
    tone: 'expired',
  },
]

const TONE_NUMBER = {
  valid: 'text-status-valid',
  soon: 'text-status-soon',
  expired: 'text-status-expired',
}

const TONE_ICON = {
  valid: 'bg-status-valid-muted text-status-valid',
  soon: 'bg-status-soon-muted text-status-soon',
  expired: 'bg-status-expired-muted text-status-expired',
}

function urgentAccent(status) {
  if (status === 'Expiring soon') {
    return {
      box: 'border-status-soon/30 bg-status-soon-muted/70 border-l-status-soon',
      label: 'text-status-soon',
    }
  }
  return {
    box: 'border-status-expired/30 bg-status-expired-muted/70 border-l-status-expired',
    label: 'text-status-expired',
  }
}

function urgentDetail(row) {
  if (row.status === 'Missing') {
    return row.requirementType.mandatory
      ? 'Mandatory requirement has no record on file'
      : 'No record on file'
  }

  const relative = formatRelativeExpiry(row.item.expiry_date)
  const date = formatDate(row.item.expiry_date)
  return relative ? `${relative} · ${date}` : date
}

export function ProfileComplianceHeader({ summary, onReviewUrgent }) {
  const { counts, overall, mostUrgent, applicableCount } = summary
  const accent = mostUrgent ? urgentAccent(mostUrgent.status) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance status</CardTitle>
        <CardDescription>
          {applicableCount === 0
            ? 'No applicable requirements to track.'
            : `${applicableCount} applicable requirement${
                applicableCount === 1 ? '' : 's'
              }.`}
        </CardDescription>
        <CardAction>
          <StatusBadge status={overall} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COUNT_STATS.map((stat) => {
            const Icon = stat.icon
            const value = counts[stat.key]
            const active = value > 0

            return (
              <div
                key={stat.key}
                className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <span
                    className={`flex size-7 items-center justify-center rounded-md ${
                      active ? TONE_ICON[stat.tone] : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="size-3.5" />
                  </span>
                </div>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${
                    active ? TONE_NUMBER[stat.tone] : 'text-card-foreground'
                  }`}
                >
                  {value}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{stat.hint}</p>
              </div>
            )
          })}
        </div>

        {mostUrgent ? (
          <div
            className={`rounded-lg border border-l-4 px-4 py-3 ${accent.box}`}
          >
            <p
              className={`text-xs font-medium uppercase tracking-wide ${accent.label}`}
            >
              Most urgent
            </p>
            <div className="mt-1 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-card-foreground">
                  {mostUrgent.item?.label &&
                  mostUrgent.item.label !== mostUrgent.requirementType.name
                    ? mostUrgent.item.label
                    : mostUrgent.requirementType.name}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {urgentDetail(mostUrgent)}
                </p>
                <DocumentAttached path={mostUrgent.item?.document_url} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={mostUrgent.status} />
                {onReviewUrgent ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onReviewUrgent}
                  >
                    {mostUrgent.item ? 'Review' : 'Fill in'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : applicableCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing needs attention. All applicable requirements are current.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
