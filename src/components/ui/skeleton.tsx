import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-gray-100', className)}
      {...props}
    />
  )
}

export function PatientRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4 border-b last:border-0">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-8 w-8 rounded-md shrink-0" />
    </div>
  )
}

export function PatientCardSkeleton() {
  return (
    <div className="rounded-xl border bg-white p-5 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

export function InvoiceRowSkeleton() {
  return (
    <div className="p-4 border-b last:border-0 space-y-2">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <Skeleton className="h-9 flex-1 rounded-md" />
      </div>
    </div>
  )
}

export function QueueRowSkeleton() {
  return (
    <tr className="border-b">
      <td className="px-4 py-3"><Skeleton className="h-7 w-7 rounded-full" /></td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-28 mb-1.5" />
        <Skeleton className="h-3 w-16" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-24" /></td>
      <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-14" /></td>
      <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-14" /></td>
      <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
      <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1">
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </td>
    </tr>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-white p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
    </div>
  )
}
