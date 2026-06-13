'use client'

import { useEffect } from 'react'

// Registers the hand-rolled service worker (public/sw.js). Renders nothing.
// updateViaCache:'none' ensures the SW script itself is always revalidated so
// a CACHE_VERSION bump is picked up promptly.
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return // avoid dev/HMR interference

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
