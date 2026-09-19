import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DocumentActions, DocumentLink } from './DocumentLink'
import { StatusBadge } from './StatusBadge'
import {
  ComplianceItemForm,
} from './ComplianceItemFields'
import {
  attentionStatus,
  canMarkVerifiedToday,
  recheckDueDate,
} from '../lib/compliance'
import { ownerProfilePath } from '../lib/paths'

function formatExpiry(expiryDate) {
  const expiry = new Date(`${expiryDate}T00:00:00`)
  if (Number.isNaN(expiry.getTime())) return expiryDate

  return expiry.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysUntil(isoDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0
  return Math.round((date.getTime() - today.getTime()) / 86_400_000)
}

function relativeExpiry(expiryDate) {
  const days = daysUntil(expiryDate)
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Expires today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function relativeRecheck(dueDate) {
  const days = daysUntil(dueDate)
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Due today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function attentionMeta(item, status, dueDate) {
  if (status === 'Missing') return 'No record · Recheck due'
  if (status === 'Recheck due') {
    return item.last_verified_date && dueDate
      ? `Recheck due ${formatExpiry(dueDate)} · ${relativeRecheck(dueDate)}`
      : 'Not verified · Recheck due'
  }
  return `Expires ${formatExpiry(item.expiry_date)} · ${relativeExpiry(item.expiry_date)}`
}

export function UrgentAttentionList({
  items,
  kind,
  requirementTypes,
  compact = false,
  editingItemId,
  editValues,
  onEditValuesChange,
  onStartEdit,
  onCancelEdit,
  onSaveItem,
  onMarkVerified,
  onDocumentChanged,
  savingItem,
  verifyingId,
  organizationId,
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {kind === 'staff'
          ? 'Nothing needs attention for staff.'
          : kind === 'sites'
            ? 'Nothing needs attention for sites.'
            : 'Nothing needs attention.'}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const requirementType = requirementTypes.find(
          (type) => type.id === item.requirement_type_id,
        )
        const status = attentionStatus(item, requirementType)
        const canMarkVerified = canMarkVerifiedToday(item, requirementType)
        const canEdit =
          !item.missing &&
          (status === 'Expired' || status === 'Expiring soon')
        const dueDate = recheckDueDate(item, requirementType)
        const accent =
          status === 'Expired' ||
          status === 'Recheck due' ||
          status === 'Missing'
            ? 'border-l-status-expired'
            : 'border-l-status-soon'
        const isEditing = !compact && !item.missing && editingItemId === item.id

        return (
          <li
            key={item.id}
            className={`border-l-4 pl-3 ${accent} ${
              compact ? 'py-2 first:pt-0 last:pb-0' : 'flex flex-col gap-3 py-3 first:pt-0 last:pb-0'
            }`}
          >
            <div
              className={
                compact
                  ? 'flex items-start justify-between gap-3'
                  : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'
              }
            >
              <div className="min-w-0">
                <Link
                  to={ownerProfilePath(item)}
                  className="block truncate font-medium text-card-foreground hover:underline"
                >
                  {item.typeName}
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {item.ownerName}
                  </span>
                </Link>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.ownerKind === 'staff' ? 'Staff' : 'Site'}
                  {' · '}
                  {attentionMeta(item, status, dueDate)}
                  {item.label && item.label !== item.typeName
                    ? ` · ${item.label}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <StatusBadge status={status} />
                {compact || !canEdit || isEditing ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onStartEdit(item)}
                    disabled={savingItem || Boolean(verifyingId)}
                  >
                    Edit
                  </Button>
                )}
                {item.missing || !item.document_url ? null : compact ? (
                  <DocumentLink path={item.document_url} />
                ) : isEditing ? null : (
                  <DocumentActions
                    path={item.document_url}
                    itemId={item.id}
                    orgId={item.org_id ?? organizationId}
                    disabled={savingItem || Boolean(verifyingId)}
                    onChanged={() => onDocumentChanged?.()}
                  />
                )}
                {compact || !canMarkVerified ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onMarkVerified(item)}
                    disabled={
                      savingItem ||
                      (Boolean(verifyingId) && verifyingId !== item.id)
                    }
                  >
                    {verifyingId === item.id ? 'Saving…' : 'Mark verified today'}
                  </Button>
                )}
              </div>
            </div>
            {isEditing ? (
              <ComplianceItemForm
                onSubmit={(event) => onSaveItem(event, item)}
                onCancel={onCancelEdit}
                saving={savingItem}
                values={editValues}
                onChange={onEditValuesChange}
                showLastVerified={canMarkVerified}
                validityMonths={item.validity_months}
                disabled={savingItem}
                documentContext={{
                  itemId: item.id,
                  orgId: item.org_id ?? organizationId,
                }}
                onDocumentChange={() => onDocumentChanged?.()}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
