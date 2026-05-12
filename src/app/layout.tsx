import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/lib/providers'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CHMS — Système de Gestion Clinique',
  description: 'Système multi-tenant de gestion de clinique pour le Sénégal',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full bg-gray-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
