export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight break-words text-card-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-base text-muted-foreground md:text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

function toUserFacingError(children) {
  if (typeof children !== 'string') return children
  if (/jwt issued at future|pgrst303/i.test(children)) {
    return 'Could not load this page. Refresh and try again.'
  }
  return children
}

export function PageError({ children }) {
  if (!children) return null
  return (
    <p
      className="rounded-lg border border-status-expired/30 bg-status-expired-muted px-3 py-2 text-base text-status-expired md:text-sm"
      role="alert"
    >
      {toUserFacingError(children)}
    </p>
  )
}

export function PageSuccess({ children }) {
  if (!children) return null
  return (
    <p
      className="rounded-lg border border-status-valid/30 bg-status-valid-muted px-3 py-2 text-base text-status-valid md:text-sm"
      role="status"
    >
      {children}
    </p>
  )
}

export function PageMuted({ children }) {
  return <p className="px-4 py-6 text-base text-muted-foreground md:text-sm">{children}</p>
}
