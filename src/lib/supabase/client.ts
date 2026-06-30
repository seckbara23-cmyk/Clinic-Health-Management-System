import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Browser Supabase client — SINGLETON per tab.
//
// Every hook/component used to call createClient() and get a NEW client. Each
// new client spins up its own GoTrueClient, but they all share the same storage
// key (sb-<ref>-auth-token) and the same auth lock (navigator.locks). Multiple
// clients therefore contend on that lock and run competing auto-refresh loops,
// which can deadlock signInWithPassword() — observed as a hard ~15s login
// timeout. One client per tab eliminates the contention.
let browserClient: SupabaseClient<Database> | undefined

export function createClient(): SupabaseClient<Database> {
  // Never memoize on the server — a module-level singleton there would leak one
  // user's auth state across requests. Each server render gets a fresh client.
  if (typeof window === 'undefined') {
    return createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return browserClient
}
