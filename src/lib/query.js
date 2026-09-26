export function firstError(...results) {
  for (const result of results) {
    if (result?.error) return result.error
  }
  return null
}

export const PAGE_SIZE = 1000

// Reads every page. fetchPage(from, to) uses an inclusive range and must
// return rows in a stable order. Stops when a page is shorter than pageSize.
export async function collectPages(fetchPage, pageSize = PAGE_SIZE) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// PostgREST returns at most 1000 rows unless the query pages. Order by id
// so a row cannot move between pages.
export async function fetchAllPages(makeQuery) {
  try {
    const data = await collectPages(async (from, to) => {
      const { data: page, error } = await makeQuery()
        .order('id', { ascending: true })
        .range(from, to)
      if (error) throw error
      return page ?? []
    })
    return { data, error: null }
  } catch (error) {
    return { data: [], error }
  }
}
