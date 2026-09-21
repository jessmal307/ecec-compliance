import { useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/form'
import { useAuth } from '../hooks/useAuth'
import { currentPagePath, FEEDBACK_TYPES, submitFeedback } from '../lib/feedback'

const EMPTY_FORM = {
  type: '',
  message: '',
}

export function FeedbackButton({ className }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        Feedback
      </Button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function FeedbackDialog({ open, onOpenChange }) {
  const { organizationId } = useAuth()
  const location = useLocation()
  const [type, setType] = useState(EMPTY_FORM.type)
  const [message, setMessage] = useState(EMPTY_FORM.message)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function reset() {
    setType(EMPTY_FORM.type)
    setMessage(EMPTY_FORM.message)
    setError('')
    setSaving(false)
    setSubmitted(false)
  }

  function handleOpenChange(nextOpen) {
    if (saving) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSaving(true)

    const { error: submitError } = await submitFeedback({
      orgId: organizationId,
      type,
      message,
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
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-[60] grid w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          onOpenAutoFocus={(event) => {
            if (submitted) event.preventDefault()
          }}
        >
          {submitted ? (
            <>
              <div className="flex flex-col gap-1.5 text-left">
                <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                  Thanks — we&apos;ve got it
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  Your note is with us. Keep using the app as usual.
                </DialogPrimitive.Description>
              </div>
              <div className="-mx-4 -mb-4 flex justify-end rounded-b-xl border-t border-border bg-muted/50 p-4">
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5 text-left">
                <DialogPrimitive.Title className="text-base font-medium text-card-foreground">
                  Feedback
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  A bug, an improvement, or something you&apos;d like to see.
                </DialogPrimitive.Description>
              </div>
              <Field label="Type">
                <Select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  required
                  disabled={saving}
                  aria-label="Feedback type"
                >
                  <option value="" disabled>
                    Choose a type
                  </option>
                  {FEEDBACK_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Message">
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                  disabled={saving}
                  rows={5}
                  placeholder="What happened, or what would help?"
                />
              </Field>
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
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !organizationId}>
                  {saving ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
