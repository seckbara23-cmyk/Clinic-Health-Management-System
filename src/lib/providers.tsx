'use client'

import { useState } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { getQueryClient } from './query-client'
import { persistOptions } from '@/lib/offline/persister'
import { registerOfflineMutationDefaults } from '@/lib/offline/mutation-defaults'

export function Providers({ children }: { children: React.ReactNode }) {
  // Register replayable mutation defaults before hydration so paused mutations
  // restored from IndexedDB can resume with a valid mutationFn.
  const [queryClient] = useState(() => {
    const qc = getQueryClient()
    registerOfflineMutationDefaults(qc)
    return qc
  })

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => {
        // After the cache is restored, replay any queued offline mutations.
        if (onlineManager.isOnline()) void queryClient.resumePausedMutations()
      }}
    >
      {/* ClinicProvider is mounted per-dashboard (server-seeded) in the
          dashboard layout, so authenticated users never render a null tenant.
          Public pages don't need it. */}
      {children}
      <Toaster richColors position="top-right" />
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  )
}
