const JWT_SKEW_MESSAGE = 'JWT issued at future'
const MAX_ATTEMPTS = 3
const DELAY_MS = 1000

// Retries a read only on the transient clock-skew error from the gateway.
// Any other error, or the last failed attempt, is returned unchanged.
export async function retryOnJwtSkew<T extends { error: { message?: string } | null }>(
  run: () => PromiseLike<T>,
  label: string,
): Promise<T> {
  let result = await run()
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (!String(result.error?.message ?? '').includes(JWT_SKEW_MESSAGE)) return result
    console.warn('[jwt-skew-retry]', label, 'attempt', attempt)
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    result = await run()
  }
  return result
}
