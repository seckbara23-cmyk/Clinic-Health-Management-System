'use client'

import { Loader2, AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useClinic } from '@/context/ClinicContext'
import { tenantGateView } from '@/lib/tenant'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'

// Gates the authenticated dashboard subtree so it is NEVER rendered with a
// generic/degraded tenant. If we have a profile → render (even while
// revalidating). No profile + hard failure → explicit blocking error. Otherwise
// → a loader. Separates "loading" from "missing profile".
export function TenantGate({ children }: { children: React.ReactNode }) {
  const { status, profile, refetch } = useClinic()
  const t = useTranslations('tenant')
  const view = tenantGateView(status, !!profile)

  if (view === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
          <p className="text-sm">{t('loading')}</p>
        </div>
      </div>
    )
  }

  if (view === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-2xl border bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="text-base font-semibold text-gray-900">{t('errorTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('errorMessage')}</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button onClick={() => refetch()}>{t('retry')}</Button>
            <form action={signOut}>
              <Button variant="outline" type="submit">{t('signOut')}</Button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
