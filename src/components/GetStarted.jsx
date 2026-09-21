import { useEffect, useState } from 'react'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'

export function setupProgress({ sites, staff, requirementTypes }) {
  const steps = {
    site: sites.length > 0,
    staff: staff.length > 0,
    requirements: requirementTypes.length > 0,
  }

  return {
    steps,
    complete: steps.site && steps.staff && steps.requirements,
  }
}

const STEPS = [
  {
    key: 'site',
    title: 'Add your first site',
    description: 'A service location to assign staff and site checks.',
    to: paths.sites,
  },
  {
    key: 'staff',
    title: 'Add your staff',
    description: 'People whose certificates and checks you will track.',
    to: paths.newStaff,
  },
  {
    key: 'requirements',
    title: 'Set up requirements',
    description: 'Review the requirement types used for compliance.',
    to: paths.requirements,
  },
]

const INTRO_STEPS = [
  {
    title: 'Add your sites.',
    to: paths.sites,
  },
  {
    title: 'Add your staff and their certificates.',
    to: paths.newStaff,
  },
  {
    title: "We'll email you before anything lapses.",
    to: null,
  },
]

function introStorageKey(orgId) {
  return `ecec-how-this-works:${orgId}`
}

function readIntroDismissed(orgId) {
  if (!orgId) return false
  try {
    return localStorage.getItem(introStorageKey(orgId)) === '1'
  } catch {
    return false
  }
}

function writeIntroDismissed(orgId) {
  if (!orgId) return
  try {
    localStorage.setItem(introStorageKey(orgId), '1')
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function GetStarted({ steps }) {
  const { organizationId } = useAuth()
  const [introDismissed, setIntroDismissed] = useState(() =>
    readIntroDismissed(organizationId),
  )
  const brandNew = !steps.site && !steps.staff
  const showIntro = brandNew && !introDismissed
  const doneCount = STEPS.filter((step) => steps[step.key]).length

  useEffect(() => {
    setIntroDismissed(readIntroDismissed(organizationId))
  }, [organizationId])

  function dismissIntro() {
    writeIntroDismissed(organizationId)
    setIntroDismissed(true)
  }

  if (showIntro) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>How this works</CardTitle>
          <CardAction>
            <Button type="button" variant="ghost" size="sm" onClick={dismissIntro}>
              Dismiss
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {INTRO_STEPS.map((step, index) => {
              const body = (
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-base font-medium text-card-foreground md:text-sm">
                    {step.title}
                  </span>
                  {step.to ? (
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                </span>
              )

              return (
                <li key={step.title}>
                  {step.to ? (
                    <Link
                      to={step.to}
                      className="block min-h-11 rounded-md py-1 no-underline"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="py-1">{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          {doneCount} of {STEPS.length} complete. Work through these once, then
          the live dashboard will appear.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-border">
          {STEPS.map((step, index) => {
            const done = Boolean(steps[step.key])
            return (
              <li key={step.key}>
                <Link
                  to={step.to}
                  className="flex min-h-11 items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span
                    className={[
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                      done
                        ? 'bg-status-valid-muted text-status-valid'
                        : 'bg-muted text-muted-foreground',
                    ].join(' ')}
                    aria-hidden
                  >
                    {done ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Circle className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span
                        className={
                          done
                            ? 'text-base font-medium text-muted-foreground line-through md:text-sm'
                            : 'text-base font-medium text-card-foreground md:text-sm'
                        }
                      >
                        {step.title}
                      </span>
                      {done ? (
                        <span className="text-xs text-status-valid">Done</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-base text-muted-foreground md:text-sm">
                      {step.description}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
