import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '../ui/form'

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

export function emptyHazardRow() {
  return {
    id: crypto.randomUUID(),
    hazard: '',
    likelihood: '',
    consequence: '',
    controls: '',
  }
}

export function RiskMatrixFormRenderer({
  schema,
  rows,
  onChange,
  readOnly = false,
}) {
  const likelihood = scaleOptions(schema, 'likelihood', DEFAULT_LIKELIHOOD)
  const consequence = scaleOptions(schema, 'consequence', DEFAULT_CONSEQUENCE)

  function updateRow(id, patch) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-base text-muted-foreground md:text-sm">
        <p>
          Likelihood: {likelihood.join(', ')}.
        </p>
        <p>
          Consequence: {consequence.join(', ')}.
        </p>
      </div>

      {rows.map((row, index) => {
        const likelihoodIndex = likelihood.indexOf(row.likelihood)
        const consequenceIndex = consequence.indexOf(row.consequence)
        const rating = riskRating(likelihoodIndex, consequenceIndex)

        return (
          <div
            key={row.id}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <p className="text-sm font-medium text-card-foreground">
              Hazard {index + 1}
            </p>
            <Field label="Hazard">
              <Textarea
                value={row.hazard}
                onChange={(event) =>
                  updateRow(row.id, { hazard: event.target.value })
                }
                className="min-h-20"
                disabled={readOnly}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Likelihood">
              <Select
                value={row.likelihood}
                onChange={(event) =>
                  updateRow(row.id, { likelihood: event.target.value })
                }
                disabled={readOnly}
              >
                <option value="">Select…</option>
                {likelihood.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Consequence">
              <Select
                value={row.consequence}
                onChange={(event) =>
                  updateRow(row.id, { consequence: event.target.value })
                }
                disabled={readOnly}
              >
                <option value="">Select…</option>
                {consequence.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rating">
              <Input value={rating} readOnly />
            </Field>
            <Field label="Controls">
              <Textarea
                value={row.controls}
                onChange={(event) =>
                  updateRow(row.id, { controls: event.target.value })
                }
                className="min-h-20"
                disabled={readOnly}
                readOnly={readOnly}
              />
            </Field>
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
