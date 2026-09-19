export function ProgressPill({ completed = 0, total = 0, inactive = false }) {
  if (inactive) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const percent = total === 0 ? 100 : Math.round((completed / total) * 100)

  return (
    <span
      className="inline-flex items-center gap-2.5"
      title={`${completed} of ${total} requirements current`}
    >
      <span className="relative h-1 w-16 overflow-hidden rounded-full bg-foreground/10">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {completed}/{total}
      </span>
    </span>
  )
}
