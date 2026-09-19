import { StatusBadge } from './StatusBadge'

function CategoryPill({ status, count }) {
  if (count === 0) return null

  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge status={status} />
      <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
    </span>
  )
}

export function GapCategories({
  missing = 0,
  expired = 0,
  className = 'flex flex-wrap items-center gap-2',
}) {
  return (
    <div className={className}>
      <CategoryPill status="Missing" count={missing} />
      <CategoryPill status="Expired" count={expired} />
    </div>
  )
}
