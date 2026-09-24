import { useEffect, useId, useRef } from 'react'
import SignaturePadLib from 'signature_pad'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

function resizeCanvas(canvas, pad) {
  if (!canvas || !pad) return
  const strokes = pad.isEmpty() ? [] : pad.toData()
  const ratio = Math.max(window.devicePixelRatio || 1, 1)
  const width = canvas.offsetWidth
  const height = canvas.offsetHeight
  canvas.width = Math.floor(width * ratio)
  canvas.height = Math.floor(height * ratio)
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  pad.clear()
  if (strokes.length) pad.fromData(strokes)
}

export function SignaturePad({
  label = 'Signature',
  value = '',
  onChange,
  required = false,
  className,
}) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const canvasId = useId()

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reducedMotion = prefersReducedMotion()
    const pad = new SignaturePadLib(canvas, {
      throttle: reducedMotion ? 0 : 16,
      minDistance: reducedMotion ? 0 : 5,
      minWidth: 1.25,
      maxWidth: 2.5,
      penColor: getComputedStyle(canvas).color || '#111827',
    })
    padRef.current = pad

    function emit() {
      onChangeRef.current?.(pad.isEmpty() ? '' : pad.toDataURL('image/png'))
    }

    pad.addEventListener('endStroke', emit)

    const observer = new ResizeObserver(() => {
      resizeCanvas(canvas, pad)
    })
    observer.observe(canvas)
    resizeCanvas(canvas, pad)

    if (value) pad.fromDataURL(value)

    return () => {
      observer.disconnect()
      pad.off()
      padRef.current = null
    }
  }, [])

  function handleClear() {
    padRef.current?.clear()
    onChangeRef.current?.('')
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-input bg-background text-card-foreground',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        )}
      >
        <canvas
          ref={canvasRef}
          id={canvasId}
          tabIndex={0}
          role="img"
          aria-label={required ? `${label} (required)` : label}
          aria-required={required || undefined}
          className="block h-40 w-full touch-none outline-none"
        />
      </div>
      <Button type="button" variant="outline" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
