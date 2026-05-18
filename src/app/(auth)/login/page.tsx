'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'

type FormData = { email: string; password: string }

// Race a promise against a timeout; rejects with Error('TIMEOUT') if ms elapses first.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ])
}

// Map Supabase error messages to translated keys.
function translateAuthError(message: string, t: (k: string) => string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('invalid email or password')) {
    return t('errorInvalidCredentials')
  }
  if (m.includes('email not confirmed')) return t('errorEmailNotConfirmed')
  if (m.includes('too many requests') || m.includes('rate limit') || m.includes('over_request_rate_limit')) {
    return t('errorTooManyRequests')
  }
  return t('errorGeneric')
}

export default function LoginPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [bgError, setBgError] = useState(false)
  const supabase = createClient()
  const t = useTranslations('auth.login')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(
      z.object({
        email: z.string().email(t('emailInvalid')),
        password: z.string().min(6, t('passwordTooShort')),
      })
    ),
  })

  async function onSubmit(data: FormData) {
    setServerError(null)
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword(data),
        15_000
      )
      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[Login] signInWithPassword error:', {
            message: error.message,
            status:  error.status,
            code:    (error as { code?: string }).code,
          })
        }
        setServerError(translateAuthError(error.message, t))
        return
      }
      // Navigation only — no router.refresh() to avoid RSC cache race with push
      router.push('/dashboard')
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'TIMEOUT'
      setServerError(isTimeout ? t('errorTimeout') : t('errorNetwork'))
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">

      {/* ── Gradient fallback (always visible, shown when no photo) ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-slate-800 to-cyan-900" />

      {/* ── Background photo ── */}
      {!bgError && (
        <Image
          src="/clinic-bg.jpg"
          alt=""
          fill
          priority
          quality={85}
          sizes="100vw"
          className="object-cover object-center"
          onError={() => setBgError(true)}
        />
      )}

      {/* ── Dark readability overlay ── */}
      <div className="absolute inset-0 bg-slate-900/55" />

      {/* ── Login card area ── */}
      <div className="relative z-10 flex w-full flex-1 items-center justify-center px-4 py-12 pb-24">
        <div className="w-full max-w-[400px]">

          {/* Card */}
          <div className="overflow-hidden rounded-2xl bg-white/90 shadow-2xl ring-1 ring-white/30 backdrop-blur-md">

            {/* Top colour strip */}
            <div className="h-1.5 bg-gradient-to-r from-teal-600 via-teal-500 to-cyan-500" />

            <div className="px-8 pb-6 pt-8">

              {/* ── Brand ── */}
              <div className="mb-6 flex flex-col items-center">
                {/* Logo mark */}
                <div
                  aria-hidden="true"
                  className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-teal-600 shadow-lg shadow-teal-900/30"
                >
                  {/* Medical cross with heartbeat line */}
                  <svg viewBox="0 0 40 40" className="h-8 w-8" fill="none">
                    <rect x="15" y="5"  width="10" height="30" rx="2.5" fill="white" />
                    <rect x="5"  y="15" width="30" height="10" rx="2.5" fill="white" />
                    <path
                      d="M7 20 L12 20 L14.5 14 L18 26 L21 14 L24.5 26 L27 20 L33 20"
                      stroke="#0d9488"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <span className="text-lg font-bold tracking-tight text-gray-900">CHMS</span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-teal-600">
                  Clinic Health Management System
                </span>
              </div>

              {/* ── Heading ── */}
              <div className="mb-6 text-center">
                <h1 className="text-xl font-semibold text-gray-900">{t('title')}</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
                  {t('subtitle')}
                </p>
              </div>

              {/* ── Form ── */}
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-4"
                noValidate
                aria-label="Formulaire de connexion"
              >

                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    {t('email')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('emailPlaceholder')}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    className="w-full rounded-lg border border-gray-300 bg-white/80 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p id="email-error" role="alert" className="mt-1 text-xs text-red-600">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-gray-700"
                    >
                      {t('password')}
                    </label>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-medium text-teal-600 transition-colors hover:text-teal-700 hover:underline"
                    >
                      {t('forgotPassword')}
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? 'password-error' : undefined}
                      className="w-full rounded-lg border border-gray-300 bg-white/80 px-3.5 py-2.5 pr-10 text-sm text-gray-900 shadow-sm transition-colors focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-600"
                    >
                      {showPassword
                        ? <EyeOff className="h-4 w-4" />
                        : <Eye    className="h-4 w-4" />
                      }
                    </button>
                  </div>
                  {errors.password && (
                    <p id="password-error" role="alert" className="mt-1 text-xs text-red-600">
                      {errors.password.message}
                    </p>
                  )}
                </div>

                {/* Server error */}
                {serverError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
                  >
                    {serverError}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-900/20 transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t('submitting')}
                    </>
                  ) : (
                    t('submit')
                  )}
                </button>

              </form>
            </div>

            {/* Card footer */}
            <div className="border-t border-gray-100 bg-gray-50/80 px-8 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {t('newClinic')}{' '}
                  <Link
                    href="/signup"
                    className="font-medium text-teal-600 transition-colors hover:text-teal-700 hover:underline"
                  >
                    {t('createAccount')}
                  </Link>
                </p>
                <LocaleSwitcher />
              </div>
            </div>
          </div>

          {/* Senegal flag strip below card */}
          <div
            aria-hidden="true"
            className="mx-auto mt-5 flex h-0.5 w-14 overflow-hidden rounded-full opacity-60"
          >
            <div className="flex-1 bg-[#009E60]" />
            <div className="flex-1 bg-[#FDEF42]" />
            <div className="flex-1 bg-[#E31B23]" />
          </div>
        </div>
      </div>

      {/* ── Bottom trust bar ── */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-slate-900/65 px-6 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-3">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-400" aria-hidden="true" />
          <p className="text-xs text-white/70">
            {t('trustBadge')}
          </p>
          <span className="hidden text-white/25 sm:inline" aria-hidden="true">|</span>
          <p className="hidden text-xs text-white/45 sm:block">
            {t('trustTagline')}
          </p>
        </div>
      </div>

    </main>
  )
}
