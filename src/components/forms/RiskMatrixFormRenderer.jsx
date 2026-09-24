import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '../ui/form'
import { FormFieldControl } from './FormFields'

const DEFAULT_LIKELIHOOD = [
  'Rare',
  'Unlikely',
  'Possible',
  'Likely',
  'Almost certain',
]

const DEFAULT_CONSEQUENCE = [
  'Insignificant',
  'Minor',
  'Moderate',
  'Major',
  'Catastrophic',
]

function scaleOptions(schema, key, fallback) {
  const raw = schema?.[key]
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) =>
      typeof item === 'string' ? item : item.label || item.value,
    )
  }
  return fallback
}

export function riskRating(likelihoodIndex, consequenceIndex) {
  if (likelihoodIndex < 0 || consequenceIndex < 0) return '—'
  const score = (likelihoodIndex + 1) * (consequenceIndex + 1)
  if (score >= 16) return 'Extreme'
  if (score >= 10) return 'High'
  if (score >= 5) return 'Moderate'
  return 'Low'
}

function ratingFor(scale, likelihoodValue, consequenceValue) {
  return riskRating(scale.likelihood.indexOf(likelihoodValue), scale.consequence.indexOf(consequenceValue))
}

export function emptyHazardRow() {
  return {
    id: crypto.randomUUID(),
    hazard: '',
    likelihood: '',
    consequence: '',
    rating: '—',
    controls: '',
    residualLikelihood: '',
    residualConsequence: '',
    residualRating: '—',
  }
}

function withRatings(row, scale) {
  return {
    ...row,
    rating: ratingFor(scale, row.likelihood, row.consequence),
    residualRating: ratingFor(scale, row.residualLikelihood, row.residualConsequence),
  }
}

function ScaleSelect({ label, value, options, onChange, readOnly }) {
  return (
    <Field label={label}>
      <Select value={value || ''} onChange={onChange} disabled={readOnly}>
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function RiskMatrixFormRenderer({
  schema,
  rows,
  values = {},
  notes = {},
  onChange,
  onFieldChange,
  onNoteChange,
  readOnly = false,
  signatureUrls = {},
}) {
  const scale = {
    likelihood: scaleOptions(schema, 'likelihood', DEFAULT_LIKELIHOOD),
    consequence: scaleOptions(schema, 'consequence', DEFAULT_CONSEQUENCE),
  }
  const contextFields = Array.isArray(schema?.fields) ? schema.fields : []

  function updateRow(id, patch) {
    onChange(
      rows.map((row) =>
        row.id === id ? withRatings({ ...row, ...patch }, scale) : row,
      ),
    )
  }

  return (
    <div className="space-y-6">
      {contextFields.length ? (
        <div className="space-y-5">
          {contextFields.map((field) => (
            <FormFieldControl
              key={field.id || field.label}
              field={field}
              value={values[field.id]}
              note={notes[field.id]}
              onChange={(next) => onFieldChange?.(field.id, next)}
              onNoteChange={(next) => onNoteChange?.(field.id, next)}
              readOnly={readOnly}
              signatureUrl={signatureUrls[field.id]}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-1 text-base text-muted-foreground md:text-sm">
        <p>Likelihood: {scale.likelihood.join(', ')}.</p>
        <p>Consequence: {scale.consequence.join(', ')}.</p>
      </div>

      {rows.map((row, index) => {
        const rated = withRatings(row, scale)

        return (
          <div
            key={row.id || index}
            className="space-y-4 rounded-xl border border-border p-4"
          >
            <p className="text-sm font-medium text-card-foreground">
              Hazard {index + 1}
            </p>
            <Field label="Hazard">
              <Textarea
                value={row.hazard || ''}
                onChange={(event) =>
                  updateRow(row.id, { hazard: event.target.value })
                }
                className="min-h-20"
                disabled={readOnly}
                readOnly={readOnly}
              />
            </Field>

            <div className="space-y-3">
              <p className="text-sm font-medium text-card-foreground">Initial risk</p>
              <ScaleSelect
                label="Initial likelihood"
                value={row.likelihood}
                options={scale.likelihood}
                onChange={(event) =>
                  updateRow(row.id, { likelihood: event.target.value })
                }
                readOnly={readOnly}
              />
              <ScaleSelect
                label="Initial consequence"
                value={row.consequence}
                options={scale.consequence}
                onChange={(event) =>
                  updateRow(row.id, { consequence: event.target.value })
                }
                readOnly={readOnly}
              />
              <Field label="Initial rating">
                <Input value={rated.rating} readOnly />
              </Field>
            </div>

            <Field label="Control measures">
              <Textarea
                value={row.controls || ''}
                onChange={(event) =>
                  updateRow(row.id, { controls: event.target.value })
                }
                className="min-h-20"
                disabled={readOnly}
                readOnly={readOnly}
              />
            </Field>

            <div className="space-y-3">
              <p className="text-sm font-medium text-card-foreground">Residual risk</p>
              <ScaleSelect
                label="Residual likelihood"
                value={row.residualLikelihood}
                options={scale.likelihood}
                onChange={(event) =>
                  updateRow(row.id, { residualLikelihood: event.target.value })
                }
                readOnly={readOnly}
              />
              <ScaleSelect
                label="Residual consequence"
                value={row.residualConsequence}
                options={scale.consequence}
                onChange={(event) =>
                  updateRow(row.id, { residualConsequence: event.target.value })
                }
                readOnly={readOnly}
              />
              <Field label="Residual rating">
                <Input value={rated.residualRating} readOnly />
              </Field>
            </div>
          </div>
        )
      })}

      {readOnly ? null : (
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...rows, emptyHazardRow()])}
        >
          Add hazard
        </Button>
      )}
    </div>
  )
}
