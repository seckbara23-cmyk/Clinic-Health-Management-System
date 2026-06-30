import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Routes that do not require authentication
  // '/offline' is the service worker's navigation fallback (precached by
  // public/sw.js); it must render without auth so the SW can cache it and serve
  // it to logged-out or pre-auth visitors when the network is down.
  const publicRoutes = ['/login', '/signup', '/accept-invite', '/forgot-password', '/reset-password', '/offline']
  const isPublicRoute      = publicRoutes.some(r => pathname.startsWith(r))
  // API routes return JSON — never redirect them to an HTML page; let the
  // route handler return its own 401/403 so callers get proper HTTP codes.
  const isApiRoute         = pathname.startsWith('/api/')
  // The change-password page must remain reachable when must_change_password
  // is true, otherwise we'd create an infinite redirect loop.
  const isChangePassword   = pathname.startsWith('/change-password')

  // ── Unauthenticated access ────────────────────────────────────────
  if (!user && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── Root → dashboard redirect ─────────────────────────────────────
  if (user && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // ── must_change_password enforcement ─────────────────────────────
  // Users who must change their password are blocked from all protected
  // routes until they do so. This runs server-side on every page
  // navigation — it cannot be bypassed by the client.
  //
  // API routes are intentionally excluded: they handle their own session
  // checks and should not return HTML redirects to JSON callers.
  // The /change-password route itself is excluded to prevent a redirect loop.
  if (user && !isPublicRoute && !isApiRoute && !isChangePassword) {
    // must_change_password was added in migration 015 and is not yet in
    // the generated database.types.ts — cast to avoid a stale-type error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from('user_profiles')
      .select('must_change_password')
      .eq('id', user.id)
      .maybeSingle() as { data: { must_change_password: boolean } | null }

    if (profile?.must_change_password === true) {
      const url = request.nextUrl.clone()
      url.pathname = '/change-password'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
