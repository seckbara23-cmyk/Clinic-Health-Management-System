import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // PWA assets (sw.js, manifest.webmanifest) and static images are excluded so
    // the proxy never redirects them to /login. A service worker served via a
    // 3xx redirect is rejected by browsers, which would break PWA registration
    // and offline support for anyone not yet authenticated.
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
