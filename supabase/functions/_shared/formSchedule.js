// Org schedule for system forms. One copy for the app, the digest, the
// same-day alert, and the floor link.

export function isDailyChecklist(template) {
  return template?.category === 'checklist' && template?.cadence === 'daily'
}

// No row: daily checklists are off, everything else is on.
export function scheduleEnabled(template, row) {
  if (row && typeof row.enabled === 'boolean') return row.enabled
  return !isDailyChecklist(template)
}

// Null months on the org row means the template's library months.
export function effectiveCadenceMonths(template, row) {
  if (Array.isArray(row?.cadence_months) && row.cadence_months.length) {
    return row.cadence_months.map(Number)
  }
  return Array.isArray(template?.cadence_months) ? template.cadence_months.map(Number) : null
}
