import { Button } from '@/components/ui/button'

export const LIST_PAGE_SIZE = 25

export function paginateItems(items, page, pageSize = LIST_PAGE_SIZE) {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1)
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize

  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    pageSize,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  }
}

export function ListPagination({ page, pageCount, from, to, total, onPageChange }) {
  if (total <= LIST_PAGE_SIZE) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-(--card-spacing) py-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <p className="text-xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
