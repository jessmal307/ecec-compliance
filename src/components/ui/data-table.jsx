import { cn } from '@/lib/utils'

export function Table({ children, className }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
      <table
        className={cn(
          'w-full min-w-[36rem] text-left text-sm',
          className,
        )}
      >
        {children}
      </table>
    </div>
  )
}

export function THead({ children }) {
  return (
    <thead>
      <tr className="border-y border-border bg-muted/40">{children}</tr>
    </thead>
  )
}

export function Th({ children, className }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-xs font-medium text-muted-foreground sm:px-4',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className, colSpan, ...props }) {
  return (
    <td
      className={cn('px-3 py-3 align-middle sm:px-4', className)}
      colSpan={colSpan}
      {...props}
    >
      {children}
    </td>
  )
}

export function Tr({ children, className }) {
  return (
    <tr className={cn('border-b border-border last:border-b-0', className)}>
      {children}
    </tr>
  )
}
