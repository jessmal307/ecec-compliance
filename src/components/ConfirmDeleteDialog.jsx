import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from './ui/form'

export const STAFF_ARCHIVE_WARNING =
  'This hides them from lists, dashboards, gaps, and alerts. You can restore them later from Archived.'

export const SITE_ARCHIVE_WARNING =
  'This hides the site from lists, dashboards, gaps, and alerts. You can restore it later from Archived.'

export const ITEM_ARCHIVE_WARNING =
  'This hides the record from lists, profiles, dashboards, and alerts. You can restore it later from Archived.'

export const STAFF_DELETE_WARNING =
  'This permanently deletes their compliance records and site assignments. This cannot be undone. Prefer Archive unless you need a genuine data-deletion request.'

export const SITE_DELETE_WARNING =
  'This permanently deletes its compliance records and staff assignments. This cannot be undone. Prefer Archive unless you need a genuine data-deletion request.'

export const ITEM_DELETE_WARNING =
  'This permanently deletes the recorded check and any uploaded document. This cannot be undone. Prefer Archive unless you need a genuine data-deletion request.'

export const TYPE_ARCHIVE_WARNING =
  'This hides the type from add-requirement pickers and gap calculations. Existing recorded items stay on staff and site profiles. You can restore it later from Archived.'

export const TYPE_DELETE_WARNING =
  'This permanently deletes the requirement type. This cannot be undone. Only unused types can be deleted.'

export function typeArchiveTitle(name) {
  return `Archive ${name}?`
}

export function typeDeleteTitle(name) {
  return `Delete ${name} permanently?`
}

export const PERMANENT_DELETE_PHRASE = 'DELETE'

export function staffArchiveTitle(name) {
  return `Archive ${name}?`
}

export function siteArchiveTitle(name) {
  return `Archive ${name}?`
}

export function itemArchiveTitle(item) {
  const name =
    item.label && item.label !== item.typeName
      ? item.label
      : item.typeName || 'this item'
  return `Archive ${name}?`
}

export function staffDeleteTitle(name) {
  return `Delete ${name} permanently?`
}

export function siteDeleteTitle(name) {
  return `Delete ${name} permanently?`
}

export function itemDeleteTitle(item) {
  const name =
    item.label && item.label !== item.typeName
      ? item.label
      : item.typeName || 'this item'
  return `Delete ${name} permanently?`
}

export function itemArchiveWarning(item) {
  if (item.ownerName) {
    return `This recorded check for ${item.ownerName} will be hidden from lists and alerts. You can restore it later from Archived.`
  }
  return ITEM_ARCHIVE_WARNING
}

export function itemDeleteWarning(item) {
  if (item.ownerName) {
    return `This recorded check for ${item.ownerName} will be permanently deleted. This cannot be undone.`
  }
  return ITEM_DELETE_WARNING
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirming = false,
  onConfirm,
  confirmLabel = 'Delete',
  confirmingLabel = 'Deleting…',
  confirmPhrase,
  variant = 'destructive',
}) {
  const [typed, setTyped] = useState('')
  const phraseReady = !confirmPhrase || typed === confirmPhrase

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (confirming) return
        if (!nextOpen) setTyped('')
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmPhrase ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{confirmPhrase}</span>{' '}
              to confirm.
            </p>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={confirming}
              aria-label={`Type ${confirmPhrase} to confirm`}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={confirming || !phraseReady}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {confirming ? confirmingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
