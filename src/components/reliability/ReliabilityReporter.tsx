'use client'

// ── Client reliability reporter (Phase 15.0B) ──────────────────────
//
// Invisible listener that captures uncaught client errors + unhandled promise
// rejections and posts a SANITIZED report to /api/reliability/report. It renders
// nothing, changes no behaviour, and can never throw into the app (every path is
// guarded). It sends only: module, errorType, sanitized route, sanitized
// message, and a stack HASH — never the raw stack, request bodies, or any
// clinical data. The server re-sanitizes and derives clinic_id from the session.

import { useEffect } from 'react'
import { sanitizeErrorMessage, sanitizeRoute, hashString } from '@/lib/reliability'

const MAX_PER_SESSION = 50 // hard cap so a render loop can't flood the endpoint

export function ReliabilityReporter() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const seen = new Set<string>() // de-dupe identical errors within the session
    let sent = 0

    function report(errorType: 'client_error' | 'unhandled_rejection', message: unknown, stack?: unknown) {
      try {
        if (sent >= MAX_PER_SESSION) return
        const msg = sanitizeErrorMessage(message)
        const route = sanitizeRoute(window.location?.pathname ?? '/')
        const stackHash = stack ? hashString(stack) : ''
        const key = `${errorType}|${route}|${msg}|${stackHash}`
        if (seen.has(key)) return
        seen.add(key)
        sent++

        const payload = JSON.stringify({ module: 'client', errorType, route, message: msg, stackHash })
        // keepalive lets the report survive a navigation/unload.
        void fetch('/api/reliability/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => { /* monitoring must never surface an error */ })
      } catch {
        /* never let the reporter itself throw */
      }
    }

    const onError = (e: ErrorEvent) => report('client_error', e.message || e.error?.message, e.error?.stack)
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; stack?: string } | string | undefined
      const message = typeof reason === 'string' ? reason : reason?.message
      const stack = typeof reason === 'object' ? reason?.stack : undefined
      report('unhandled_rejection', message, stack)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
