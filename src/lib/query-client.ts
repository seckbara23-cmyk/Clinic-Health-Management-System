import { QueryClient, MutationCache, onlineManager } from '@tanstack/react-query'
import { toast } from 'sonner'
import { OFFLINE_CACHE_MAX_AGE_MS, isQueueableMutationKey } from '@/lib/offline/config'

export function makeQueryClient() {
  return new QueryClient({
    // Single place to give a clear message when a NON-queueable (restricted)
    // mutation is attempted offline. Queueable mutations pause/queue instead.
    mutationCache: new MutationCache({
      onError: (_error, _vars, _ctx, mutation) => {
        if (!onlineManager.isOnline() && !isQueueableMutationKey(mutation.options.mutationKey)) {
          toast.error('Action indisponible hors ligne — reconnectez-vous pour continuer.')
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        // Keep cached data long enough to be restored offline (matches persister maxAge).
        gcTime: OFFLINE_CACHE_MAX_AGE_MS,
        retry: (failureCount) => failureCount < 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
        refetchOnReconnect: true,
      },
      mutations: {
        // Default 'always' = restricted mutations run immediately and fail fast
        // offline (never silently queue). Queueable mutations opt into
        // networkMode 'online' (pause + persist + resume) via their defaults.
        networkMode: 'always',
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
