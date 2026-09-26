import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DocumentActions, DocumentLink } from './DocumentLink'
import { StatusBadge, WorkingTowardsBadge } from './StatusBadge'
import {
  ComplianceItemForm,
} from './ComplianceItemFields'
import {
  attentionStatus,
  canMarkVerifiedToday,
  isWorkingTowards,
  recheckDueDate,
  workingTowardsNeedsDocument,
} from '../lib/compliance'
import { ownerRequirementPath } from '../lib/paths'
import { daysUntil, formatDate } from '../lib/format'

function relativeExpiry(expiryDate) {
  const days = daysUntil(expiryDate)
  if (days == null) return ''
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Expires today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function relativeRecheck(dueDate) {
  const days = daysUntil(dueDate)
  if (days == null) return ''
  if (days < 0) {
    const overdue = Math.abs(days)
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
  }
  if (days === 0) return 'Due today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

function attentionMeta(item, status, dueDate) {
  if (workingTowardsNeedsDocument(item)) {
    return 'Needs transcript or enrolment evidence'
  }
  if (status === 'Missing') return 'No record · Recheck due'
  if (status === 'Recheck due') {
    return item.last_verified_date && dueDate
      ? `Recheck due ${formatDate(dueDate)} · ${relativeRecheck(dueDate)}`
      : 'Not verified · Recheck due'
  }
  return `Expires ${formatDate(item.expiry_date)} · ${relativeExpiry(item.expiry_date)}`
}

export function UrgentAttentionList({
  items,
  kind,
  requirementTypes,
  compact = false,
  emptyMessage,
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
        {emptyMessage ??
          (kind === 'staff'
            ? 'Nothing needs attention for staff.'
            : kind === 'sites'
              ? 'Nothing needs attention for centres.'
              : 'Nothing needs attention.')}
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
          (status === 'Expired' ||
            status === 'Expiring soon' ||
            workingTowardsNeedsDocument(item))
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
              compact ? 'min-h-11 py-2 first:pt-0 last:pb-0' : 'flex flex-col gap-3 py-3 first:pt-0 last:pb-0'
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
                  to={ownerRequirementPath(item)}
                  className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-2"
                >
                  {item.typeName}
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {item.ownerName}
                  </span>
                </Link>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.ownerKind === 'staff' ? 'Staff' : 'Centre'}
                  {' · '}
                  {attentionMeta(item, status, dueDate)}
                  {item.label && item.label !== item.typeName
                    ? ` · ${item.label}`
                    : ''}
                </p>
                {isWorkingTowards(item) ? (
                  <div className="mt-1">
                    <WorkingTowardsBadge item={item} />
                  </div>
                ) : null}
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
                item={item}
                requirementType={requirementType}
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
