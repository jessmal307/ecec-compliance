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

export const STAFF_DELETE_WARNING =
  'This also deletes their compliance records and site assignments. This cannot be undone.'

export const SITE_DELETE_WARNING =
  'This also removes its compliance records and staff assignments. This cannot be undone.'

export const ITEM_DELETE_WARNING =
  'This recorded check will be removed. This cannot be undone.'

export function staffDeleteTitle(name) {
  return `Delete ${name}?`
}

export function siteDeleteTitle(name) {
  return `Delete ${name}?`
}

export function itemDeleteTitle(item) {
  const name =
    item.label && item.label !== item.typeName
      ? item.label
      : item.typeName || 'this item'
  return `Delete ${name}?`
}

export function itemDeleteWarning(item) {
  if (item.ownerName) {
    return `This recorded check for ${item.ownerName} will be removed. This cannot be undone.`
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
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (confirming) return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirming}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {confirming ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
