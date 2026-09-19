import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { datePickerMax, MIN_REASONABLE_DATE } from '@/lib/dates'

export const controlClassName =
  'min-h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base text-card-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-expired aria-invalid:focus-visible:ring-status-expired/30'

export function Field({ label, hint, error, className, children }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 text-base font-medium text-card-foreground',
        className,
      )}
    >
      <span>{label}</span>
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-xs font-normal text-status-expired" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export function Input({ className, ...props }) {
  return <input className={cn(controlClassName, className)} {...props} />
}

export function PasswordInput({ className, disabled, ...props }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-12', className)}
        disabled={disabled}
        {...props}
      />
      <button
        type="button"
        className="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? (
          <EyeOff className="size-3.5" aria-hidden />
        ) : (
          <Eye className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  )
}

export function DateInput({
  allowFuture = true,
  min = MIN_REASONABLE_DATE,
  max = datePickerMax({ allowFuture }),
  className,
  ...props
}) {
  return (
    <Input
      type="date"
      min={min}
      max={max}
      className={cn(
        'appearance-auto [-webkit-appearance:auto] font-[inherit]',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        controlClassName,
        'h-auto min-h-24 py-2',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }) {
  return (
    <select
      className={cn(controlClassName, 'appearance-auto', className)}
      {...props}
    />
  )
}

export function FieldGrid({ children, className }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-2', className)}>
      {children}
    </div>
  )
}

export function FormSection({ title, description, children }) {
  return (
    <div className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      {title ? (
        <div>
          <h3 className="text-sm font-medium text-card-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function FormActions({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
      {children}
    </div>
  )
}

export function ChoiceRow({ children, disabled }) {
  return (
    <div
      className="flex flex-wrap gap-4 text-base font-normal text-card-foreground"
      aria-disabled={disabled || undefined}
    >
      {children}
    </div>
  )
}

export function Choice({ children, ...props }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 font-normal">
      <input className="size-5 shrink-0 accent-foreground" {...props} />
      {children}
    </label>
  )
}
