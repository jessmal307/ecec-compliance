import { cn } from '@/lib/utils'

const SLOT_CLASS = {
  label: 'max-md:col-start-1 max-md:row-start-1 max-md:min-w-0',
  status: 'max-md:col-start-2 max-md:row-start-1 max-md:self-start max-md:justify-self-end',
  expiry: 'max-md:col-span-2',
  meta: 'max-md:col-span-2',
  action: 'max-md:col-span-2',
  extra: 'max-md:hidden',
  expand: 'max-md:col-span-2',
  group: 'max-md:col-span-2',
}

const TR_SLOT_CLASS = {
  expand:
    'max-md:rounded-t-none max-md:border-t-0 max-md:pt-2',
  group:
    'max-md:mb-0 max-md:grid-cols-1 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:pt-2',
}

export function Table({ children, className }) {
  return (
    <div className="w-full min-w-0 max-w-full max-md:overflow-visible max-md:px-4 max-md:pb-4 md:overflow-x-auto md:overscroll-x-contain md:[-webkit-overflow-scrolling:touch]">
      <table
        className={cn(
          'w-full text-left text-sm max-md:block max-md:w-full max-md:min-w-0 max-md:[&>tbody]:block md:min-w-[36rem]',
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
    <thead className="max-md:hidden">
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

export function Td({ children, className, colSpan, slot, label, ...props }) {
  const extra = slot === 'extra'

  return (
    <td
      data-slot={slot}
      className={cn(
        'px-3 py-3 align-middle sm:px-4',
        extra
          ? 'max-md:hidden'
          : 'max-md:block max-md:px-0 max-md:py-0',
        extra ? null : slot ? SLOT_CLASS[slot] : 'max-md:col-span-2',
        className,
      )}
      colSpan={colSpan}
      {...props}
    >
      {label ? (
        <span className="mb-0.5 block text-xs font-medium text-muted-foreground md:hidden">
          {label}
        </span>
      ) : null}
      {children}
    </td>
  )
}

export function Tr({ children, className, slot, ...props }) {
  return (
    <tr
      data-slot={slot}
      className={cn(
        'border-b border-border last:border-b-0',
        'max-md:mb-3 max-md:grid max-md:w-full max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-start max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card max-md:p-4 max-md:last:mb-0 max-md:last:border-b max-md:has-[+[data-slot=expand]]:mb-0 max-md:has-[+[data-slot=expand]]:rounded-b-none max-md:has-[+[data-slot=expand]]:border-b-0',
        slot ? TR_SLOT_CLASS[slot] : null,
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  )
}
