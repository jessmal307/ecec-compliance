export function firstError(...results) {
  for (const result of results) {
    if (result?.error) return result.error
  }
  return null
}
