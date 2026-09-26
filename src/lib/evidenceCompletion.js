// Evidence is complete with a completion date (checked by the form) and at
// least one uploaded file. Notes are optional.
export function evidenceCompletionErrors(fileCount) {
  if (!Number.isInteger(fileCount) || fileCount < 1) {
    return ['Attach at least one file.']
  }
  return []
}
