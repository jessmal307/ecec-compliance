import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  COMPLIANCE_ITEM_STATUSES,
  suggestedExpiryFromIssuedDate,
  todayIsoDate,
} from '../lib/compliance'
import { isIsoDate, validateIsoDate } from '../lib/dates'
import { DocumentActions } from './DocumentLink'
import { AlertTimingHint } from './AlertTimingHint'
import {
  DOCUMENT_ACCEPT,
  documentFileName,
  validateComplianceDocument,
} from '../lib/documents'
import {
  DateInput,
  Field,
  FieldGrid,
  FormActions,
  FormSection,
  Input,
  Select,
} from './ui/form'

export const EMPTY_COMPLIANCE_ITEM_VALUES = {
  label: '',
  expiryDate: '',
  referenceNumber: '',
  issuedDate: '',
  issuer: '',
  status: 'current',
  lastVerifiedDate: '',
  documentUrl: '',
  documentFile: null,
}

export function validateComplianceItemValues(values) {
  const errors = {}

  if (!String(values.label ?? '').trim()) {
    errors.label = 'Enter a label.'
  }

  const issuedError = validateIsoDate(values.issuedDate, {
    allowFuture: false,
    invalidLabel: 'issued date',
  })
  if (issuedError) errors.issuedDate = issuedError

  const expiryError = validateIsoDate(values.expiryDate, {
    required: true,
    emptyLabel: 'expiry date',
    invalidLabel: 'expiry date',
  })
  if (expiryError) errors.expiryDate = expiryError
  else if (
    isIsoDate(values.issuedDate) &&
    isIsoDate(values.expiryDate) &&
    values.issuedDate > values.expiryDate
  ) {
    errors.issuedDate = 'Issued date cannot be after expiry.'
  }

  const verifiedError = validateIsoDate(values.lastVerifiedDate, {
    allowFuture: false,
    invalidLabel: 'date',
  })
  if (verifiedError) errors.lastVerifiedDate = verifiedError

  if (values.documentFile) {
    const documentError = validateComplianceDocument(values.documentFile).error
    if (documentError) errors.document = documentError
  }

  return errors
}

export function ComplianceItemFields({
  values,
  onChange,
  showLastVerified,
  disabled,
  validityMonths,
  errors,
  documentContext,
  onDocumentChange,
  item,
  requirementType,
}) {
  const fieldErrors = errors ?? {}
  const managed = errors != null
  const [fileError, setFileError] = useState('')
  const documentError = fieldErrors.document || fileError

  function setField(field, value) {
    if (field === 'issuedDate') {
      const next = { ...values, issuedDate: value }
      const suggested = suggestedExpiryFromIssuedDate(value, validityMonths)
      if (suggested) {
        next.expiryDate = suggested
      }
      onChange(next)
      return
    }

    onChange({ ...values, [field]: value })
  }

  return (
    <div className="space-y-5">
      <FormSection title="Certificate">
        <FieldGrid>
          <Field label="Label" error={fieldErrors.label}>
            <Input
              type="text"
              name="label"
              value={values.label}
              onChange={(event) => setField('label', event.target.value)}
              required={!managed}
              aria-invalid={Boolean(fieldErrors.label)}
              disabled={disabled}
            />
          </Field>
          <Field label="Reference number">
            <Input
              type="text"
              name="reference_number"
              value={values.referenceNumber}
              onChange={(event) => setField('referenceNumber', event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field label="Issuer">
            <Input
              type="text"
              name="issuer"
              value={values.issuer}
              onChange={(event) => setField('issuer', event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field label="Recorded status">
            <Select
              name="status"
              value={values.status}
              onChange={(event) => setField('status', event.target.value)}
              required={!managed}
              disabled={disabled}
            >
              {COMPLIANCE_ITEM_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </FormSection>

      <FormSection title="Dates">
        <FieldGrid>
          <Field label="Issued date" error={fieldErrors.issuedDate}>
            <DateInput
              name="issued_date"
              value={values.issuedDate}
              onChange={(event) => setField('issuedDate', event.target.value)}
              allowFuture={false}
              aria-invalid={Boolean(fieldErrors.issuedDate)}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Expiry date"
            error={fieldErrors.expiryDate}
            hint={
              validityMonths
                ? `Valid for ${validityMonths} months from the issued date. You can override the expiry.`
                : undefined
            }
          >
            <DateInput
              name="expiry_date"
              value={values.expiryDate}
              onChange={(event) => setField('expiryDate', event.target.value)}
              required={!managed}
              aria-invalid={Boolean(fieldErrors.expiryDate)}
              disabled={disabled}
            />
          </Field>
          {showLastVerified ? (
            <Field label="Last verified date" error={fieldErrors.lastVerifiedDate}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <DateInput
                  name="last_verified_date"
                  value={values.lastVerifiedDate}
                  onChange={(event) =>
                    setField('lastVerifiedDate', event.target.value)
                  }
                  allowFuture={false}
                  aria-invalid={Boolean(fieldErrors.lastVerifiedDate)}
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setField('lastVerifiedDate', todayIsoDate())}
                  disabled={disabled}
                >
                  Mark verified today
                </Button>
              </div>
            </Field>
          ) : null}
        </FieldGrid>
        <AlertTimingHint
          className="mt-3"
          item={item}
          type={requirementType}
          expiryDate={values.expiryDate}
          lastVerifiedDate={values.lastVerifiedDate}
        />
      </FormSection>

      <FormSection title="Certificate file">
        <Field
          label="PDF or image"
          error={documentError}
          hint="PDF or image, maximum 10MB."
        >
          {values.documentUrl && documentContext?.itemId ? (
            <div className="space-y-2">
              <p className="text-xs font-normal text-muted-foreground">
                Current file: {documentFileName(values.documentUrl)}
              </p>
              <DocumentActions
                path={values.documentUrl}
                itemId={documentContext.itemId}
                orgId={documentContext.orgId}
                disabled={disabled}
                onChanged={(nextPath) => {
                  onChange({
                    ...values,
                    documentUrl: nextPath ?? '',
                    documentFile: null,
                  })
                  onDocumentChange?.(nextPath ?? null)
                }}
              />
            </div>
          ) : (
            <Input
              type="file"
              name="document"
              accept={DOCUMENT_ACCEPT}
              aria-invalid={Boolean(documentError)}
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                event.target.value = ''
                if (!file) return
                const { error } = validateComplianceDocument(file)
                setFileError(error ?? '')
                onChange({
                  ...values,
                  documentFile: error ? null : file,
                })
              }}
            />
          )}
          {values.documentFile ? (
            <p className="text-xs font-normal text-muted-foreground">
              Ready to upload: {values.documentFile.name}
            </p>
          ) : null}
        </Field>
      </FormSection>
    </div>
  )
}

export function ComplianceItemForm({
  onSubmit,
  onCancel,
  saving,
  submitLabel = 'Save',
  children,
  errors: errorsProp,
  documentContext,
  onDocumentChange,
  item,
  requirementType,
  ...fieldProps
}) {
  const [localErrors, setLocalErrors] = useState({})
  const errors = errorsProp ?? localErrors

  function handleChange(next) {
    fieldProps.onChange?.(next)
    if (!errorsProp && Object.keys(localErrors).length > 0) {
      setLocalErrors({})
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = validateComplianceItemValues(fieldProps.values ?? {})
    if (Object.keys(nextErrors).length > 0) {
      if (!errorsProp) setLocalErrors(nextErrors)
      return
    }
    if (!errorsProp) setLocalErrors({})
    onSubmit(event)
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      {children}
      <ComplianceItemFields
        {...fieldProps}
        errors={errors}
        onChange={handleChange}
        documentContext={documentContext}
        onDocumentChange={onDocumentChange}
        item={item}
        requirementType={requirementType}
      />
      <FormActions>
        <Button type="submit" disabled={fieldProps.disabled || saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        ) : null}
      </FormActions>
    </form>
  )
}

export function MarkVerifiedButton({ onClick, disabled, saving }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      {saving ? 'Saving…' : 'Mark verified today'}
    </Button>
  )
}
