'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { captureException } from '@/lib/monitoring'

// Catches runtime errors thrown within any dashboard route segment.
// The surrounding dashboard layout (sidebar, nav) remains visible.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 mb-5">
        <AlertTriangle className="h-8 w-8 text-red-500" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Une erreur est survenue
      </h2>
      <p className="text-sm text-gray-500 max-w-sm mb-1">
        Impossible de charger cette page. L&apos;erreur a été enregistrée automatiquement.
      </p>
      {error.digest && (
        <p className="text-xs text-gray-400 font-mono mb-6">Réf : {error.digest}</p>
      )}
      {!error.digest && <div className="mb-6" />}
      <div className="flex gap-3">
        <Button variant="outline" asChild>
          <Link href="/dashboard">Tableau de bord</Link>
        </Button>
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Réessayer
        </Button>
      </div>
    </div>
  )
}
