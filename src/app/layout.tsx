import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/lib/providers'
import { RegisterSW } from '@/components/offline/RegisterSW'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CHMS — Système de Gestion Clinique',
  description: 'Système multi-tenant de gestion de clinique pour le Sénégal',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CHMS' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#0f766e',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="h-full bg-gray-50">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <RegisterSW />
      </body>
    </html>
  )
}
