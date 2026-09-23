import { useState } from 'react'
import { cn } from '@/lib/utils'

export function FileDropZone({
  accept,
  disabled = false,
  onFile,
  label = 'Drop a file here or click to browse',
  hint,
  fileName,
  invalid = false,
  inputLabel,
  className,
}) {
  const [dragOver, setDragOver] = useState(false)

  function takeFile(file) {
    if (disabled || !file) return
    onFile?.(file)
  }

  return (
    <label
      className={cn(
        'flex min-h-28 w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition-colors',
        dragOver
          ? 'border-ring bg-muted/60'
          : 'border-input bg-transparent',
        invalid ? 'border-status-expired' : null,
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40',
        className,
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) setDragOver(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return
        }
        setDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragOver(false)
        takeFile(event.dataTransfer.files?.[0] ?? null)
      }}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={inputLabel || label}
        aria-invalid={invalid || undefined}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          takeFile(file)
        }}
      />
      <span className="text-sm font-medium text-card-foreground">{label}</span>
      {hint ? (
        <span className="mt-1 text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {fileName ? (
        <span className="mt-2 text-xs font-normal text-muted-foreground">
          {fileName}
        </span>
      ) : null}
    </label>
  )
}
