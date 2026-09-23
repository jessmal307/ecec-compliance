import { alertTimingLine } from '../lib/alertTiming'

export function AlertTimingHint({
  item,
  type,
  status,
  expiryDate,
  lastVerifiedDate,
  workingTowards,
  className = '',
}) {
  const line = alertTimingLine({
    item,
    type,
    status,
    expiryDate,
    lastVerifiedDate,
    workingTowards,
  })
  if (!line) return null

  return (
    <p
      className={`text-xs font-normal text-muted-foreground ${className}`.trim()}
    >
      {line}
    </p>
  )
}
