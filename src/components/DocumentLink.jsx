import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DOCUMENT_ACCEPT,
  getComplianceDocumentUrl,
  persistComplianceDocument,
  removeComplianceDocument,
  validateComplianceDocument,
} from '../lib/documents'

async function openSignedDocument(path, setBusy, setError) {
  setBusy(true)
  setError('')
  const { url, error } = await getComplianceDocumentUrl(path)
  setBusy(false)
  if (error || !url) {
    setError(error?.message || 'Could not open the file.')
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function DocumentAttached({ path, disabled = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!path) return null

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <Paperclip className="size-3 shrink-0" aria-hidden />
      <span>Document attached</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
        onClick={() => openSignedDocument(path, setBusy, setError)}
        disabled={disabled || busy}
      >
        {busy ? 'Opening…' : 'View'}
      </button>
      {error ? (
        <span className="basis-full text-status-expired" role="alert">
          {error}
        </span>
      ) : null}
    </p>
  )
}

export function DocumentActions({
  path,
  itemId,
  orgId,
  onChanged,
  disabled = false,
  compact = false,
}) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  if (!path) return null

  async function openDocument() {
    await openSignedDocument(path, (next) => setBusy(next ? 'view' : ''), setError)
  }

  async function replaceDocument(file) {
    const invalid = validateComplianceDocument(file)
    if (invalid.error) {
      setError(invalid.error)
      return
    }

    setBusy('replace')
    setError('')
    const { path: nextPath, error: replaceError } =
      await persistComplianceDocument({
        orgId,
        itemId,
        file,
        currentPath: path,
      })
    setBusy('')
    if (replaceError) {
      setError(replaceError.message)
      return
    }
    onChanged?.(nextPath ?? null)
  }

  async function removeDocument() {
    setBusy('remove')
    setError('')
    const { error: removeError } = await removeComplianceDocument({
      itemId,
      path,
    })
    setBusy('')
    if (removeError) {
      setError(removeError.message)
      return
    }
    onChanged?.(null)
  }

  const locked = disabled || Boolean(busy)

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openDocument}
          disabled={locked}
        >
          {busy === 'view' ? 'Opening…' : 'View document'}
        </Button>
        {compact ? null : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) replaceDocument(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={locked || !itemId || !orgId}
            >
              {busy === 'replace' ? 'Replacing…' : 'Replace'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeDocument}
              disabled={locked || !itemId}
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </Button>
          </>
        )}
      </span>
      {error ? (
        <span className="text-xs text-status-expired" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}

export function DocumentLink(props) {
  return <DocumentActions {...props} compact />
}
