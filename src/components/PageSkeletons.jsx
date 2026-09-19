import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function Line({ className }) {
  return <Skeleton className={className} />
}

export function DashboardSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Loading overview"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Line className="h-3 w-24" />
              <Line className="mt-2 h-8 w-16" />
            </CardHeader>
            <CardContent>
              <Line className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <Line className="h-4 w-40" />
            <Line className="h-3 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Line className="h-4 w-2/5" />
                  <Line className="h-3 w-1/3" />
                </div>
                <Line className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <Line className="h-4 w-32" />
              <Line className="h-3 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex items-center justify-between gap-3">
                  <Line className="h-4 w-28" />
                  <Line className="h-5 w-14 rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Line className="h-4 w-20" />
              <Line className="h-3 w-44" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between gap-3">
                    <Line className="h-4 w-24" />
                    <Line className="h-4 w-10" />
                  </div>
                  <Line className="h-1 w-full rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export function ListTableSkeleton({ rows = 5, columns = 5 }) {
  return (
    <div className="px-4 pb-2" aria-busy="true" aria-label="Loading list">
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: Math.min(rows, 4) }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <Line className="h-4 w-2/5" />
              <Line className="h-5 w-16 rounded-full" />
            </div>
            <Line className="h-3 w-24" />
            <Line className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="flex gap-3 border-y border-border bg-muted/40 px-0 py-2">
          {Array.from({ length: columns }, (_, index) => (
            <Line key={index} className="h-3 flex-1" />
          ))}
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-3">
              {Array.from({ length: columns }, (_, column) => (
                <Line key={column} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ProfileSkeleton({ showStaff = false }) {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Line className="h-3 w-20" />
              <Line className="mt-2 h-8 w-12" />
            </CardHeader>
            <CardContent>
              <Line className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <Card>
          <CardHeader>
            <Line className="h-4 w-40" />
            <Line className="h-3 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Line className="h-3 w-20" />
                  <Line className="h-8 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Line className="h-4 w-36" />
            <Line className="h-3 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-3 rounded-xl border border-border p-4 md:space-y-0 md:rounded-none md:border-0 md:p-0">
                <div className="flex items-center justify-between gap-3">
                  <Line className="h-4 w-2/5" />
                  <Line className="h-5 w-16 rounded-full" />
                </div>
                <Line className="h-3 w-24 md:hidden" />
              </div>
            ))}
          </CardContent>
        </Card>
        {showStaff ? (
          <Card className="md:col-span-2">
            <CardHeader>
              <Line className="h-4 w-24" />
              <Line className="h-3 w-64" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex items-center justify-between gap-3">
                  <Line className="h-4 w-1/3" />
                  <Line className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
