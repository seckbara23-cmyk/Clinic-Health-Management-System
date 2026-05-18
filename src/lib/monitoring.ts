/**
 * Lightweight error monitoring wrapper.
 *
 * Currently logs to console in production. To enable full Sentry integration:
 *   1. npm install @sentry/nextjs
 *   2. Add NEXT_PUBLIC_SENTRY_DSN to .env.local and Vercel env vars
 *   3. Run: npx @sentry/wizard@latest -i nextjs
 *   4. Replace the body of captureException with:
 *        import * as Sentry from '@sentry/nextjs'
 *        Sentry.captureException(error, { extra: context })
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[captureException]', error, context ?? '')
    return
  }
  // Production: structured log until Sentry is wired.
  // The error.digest (Next.js server error code) is already logged by Next.js.
  const message = error instanceof Error ? error.message : String(error)
  console.error('[CHMS]', message, context ?? '')
}
