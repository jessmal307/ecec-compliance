import { useState } from 'react'
import { Baby, FileText } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '../hooks/useAuth'
import { currentPagePath, submitFeatureInterest } from '../lib/feedback'

export const RESERVED_FEATURES = [
  { id: 'children', label: 'Children', icon: Baby },
  { id: 'forms', label: 'Forms', icon: FileText },
]

export function ComingSoonNavItem({
  feature,
  className,
  onOpen,
}) {
  const Icon = feature.icon

  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpen(feature)}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{feature.label}</span>
      <SoonBadge />
    </button>
  )
}

export function SoonBadge() {
  return (
    <Badge
      variant="secondary"
      className="h-5 min-h-5 px-1.5 text-[10px] font-medium text-muted-foreground"
    >
      Soon
    </Badge>
  )
}

export function ComingSoonDialog({ feature, onOpenChange }) {
  const { organizationId } = useAuth()
  const location = useLocation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const open = Boolean(feature)

  function handleOpenChange(nextOpen) {
    if (saving) return
    if (!nextOpen) {
      setError('')
      setSaving(false)
      setSubmitted(false)
    }
    onOpenChange(nextOpen ? feature : null)
  }

  async function handleNotify() {
    if (!feature) return
    setError('')
    setSaving(true)
    const { error: submitError } = await submitFeatureInterest({
      orgId: organizationId,
      feature: feature.id,
      page: currentPagePath(location),
    })
    if (submitError) {
      setError(submitError.message)
      setSaving(false)
      return
    }
    setSaving(false)
    setSubmitted(true)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-[60] grid w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {submitted ? (
            <>
              <div className="flex flex-col gap-1.5 text-left">
                <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                  Thanks — we&apos;ve got it
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  We&apos;ll use this to decide what to build next.
                </DialogPrimitive.Description>
              </div>
              <div className="-mx-4 -mb-4 flex justify-end rounded-b-xl border-t border-border bg-muted/50 p-4">
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5 text-left">
                <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                  Coming soon
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  {feature
                    ? `${feature.label} is not in the app yet.`
                    : 'This is not in the app yet.'}
                </DialogPrimitive.Description>
              </div>
              {error ? (
                <p className="text-sm text-status-expired" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border bg-muted/50 p-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => handleOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={saving || !organizationId}
                  onClick={handleNotify}
                >
                  {saving ? 'Saving…' : "I'd use this — notify me"}
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
