import type { MetadataRoute } from 'next'

// Web app manifest (Next built-in → served at /manifest.webmanifest).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CHMS — Gestion Clinique',
    short_name: 'CHMS',
    description: 'Système de gestion de clinique pour le Sénégal',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9fafb',
    theme_color: '#0f766e',
    lang: 'fr',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
