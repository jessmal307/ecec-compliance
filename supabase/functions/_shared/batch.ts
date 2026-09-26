import { retryOnJwtSkew } from './retry.ts'

export const IN_BATCH_SIZE = 100
export const PAGE_SIZE = 1000

// Pages a query that orders by id. run(from, to) applies .range(from, to).
// Stops when a page is shorter than PAGE_SIZE.
export async function selectAllPages<Row>(
  run: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: QueryError }>,
  label: string,
): Promise<{ data: Row[]; error: QueryError }> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await retryOnJwtSkew(() => run(from, from + PAGE_SIZE - 1), label)
    if (result.error) return { data: [], error: result.error }
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
  }
}

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
