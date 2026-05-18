'use client'

import { useEffect } from 'react'

// global-error.tsx replaces the root layout when it throws, so no layout
// CSS is loaded. Inline styles are intentional here — do not switch to
// Tailwind classes.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Replace this with Sentry.captureException(error) once wired up.
    // See src/lib/monitoring.ts for setup instructions.
    if (process.env.NODE_ENV === 'production') {
      console.error('[GlobalError]', error.message, error.digest)
    }
  }, [error])

  return (
    <html lang="fr">
      <body style={{
        margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb',
        display: 'flex', minHeight: '100vh', alignItems: 'center',
        justifyContent: 'center', padding: '1rem',
      }}>
        <div style={{
          maxWidth: 420, width: '100%', background: '#fff',
          borderRadius: 16, border: '1px solid #e5e7eb',
          padding: 32, textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>
            Une erreur est survenue
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 8px', lineHeight: 1.6 }}>
            Une erreur inattendue a interrompu l&apos;application. Réessayez ou rafraîchissez la page.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', margin: '0 0 24px' }}>
              Réf : {error.digest}
            </p>
          )}
          {!error.digest && <div style={{ marginBottom: 24 }} />}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer', fontSize: 14, color: '#374151',
                fontWeight: 500,
              }}
            >
              Rafraîchir la page
            </button>
            <button
              onClick={reset}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: '#0f766e', color: '#fff', cursor: 'pointer',
                fontSize: 14, fontWeight: 500,
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
