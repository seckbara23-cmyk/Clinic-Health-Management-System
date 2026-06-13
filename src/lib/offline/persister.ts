import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { idbStorage } from './idb-storage'
import { QUERY_CACHE_BUSTER, OFFLINE_CACHE_MAX_AGE_MS, isPersistedQueryKey, isQueueableMutationKey } from './config'

export const offlinePersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'chms-query-cache',
  throttleTime: 1000,
})

// Persist ONLY allowlisted, successful queries and queueable (paused) mutations.
// Everything else (medical/billing/audit/SMS, in-flight/error queries) stays
// memory-only and never touches IndexedDB. `buster` ties the persisted cache to
// CACHE_VERSION; `maxAge` caps offline staleness at 24h.
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: offlinePersister,
  maxAge: OFFLINE_CACHE_MAX_AGE_MS,
  buster: QUERY_CACHE_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && isPersistedQueryKey(query.queryKey),
    shouldDehydrateMutation: (mutation) =>
      isQueueableMutationKey(mutation.options.mutationKey),
  },
}
