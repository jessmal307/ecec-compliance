import { retryOnJwtSkew } from './retry.ts'

export const IN_BATCH_SIZE = 100

type QueryError = { message?: string } | null

export function chunk<T>(items: T[], size = IN_BATCH_SIZE): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

// Keeps .in() lists short enough for the request URL. Each batch is a read,
// retried on clock skew; the first error is returned as-is.
export async function selectInBatches<Row>(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: Row[] | null; error: QueryError }>,
  label: string,
): Promise<{ data: Row[]; error: QueryError }> {
  const rows: Row[] = []
  for (const batch of chunk(ids)) {
    const result = await retryOnJwtSkew(() => run(batch), label)
    if (result.error) return { data: [], error: result.error }
    rows.push(...(result.data ?? []))
  }
  return { data: rows, error: null }
}
