'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Stethoscope, KeyRound, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'

// Must match the Supabase Auth password policy configured in the dashboard.
// Policy: lower_upper_letters_digits_symbols (strong)
function makeRules(t: ReturnType<typeof useTranslations>) {
  return [
    { key: 'length',  label: t('ruleLength'),  test: (v: string) => v.length >= 8 },
    { key: 'lower',   label: t('ruleLower'),   test: (v: string) => /[a-z]/.test(v) },
    { key: 'upper',   label: t('ruleUpper'),   test: (v: string) => /[A-Z]/.test(v) },
    { key: 'digit',   label: t('ruleDigit'),   test: (v: string) => /[0-9]/.test(v) },
    { key: 'special', label: t('ruleSpecial'), test: (v: string) => /[^A-Za-z0-9]/.test(v) },
  ]
}

type FormData = { password: string; confirm: string }

export default function ChangePasswordPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<'finalizing' | 'redirecting' | null>(null)
  const supabase = createClient()
  const t = useTranslations('auth.changePassword')

  const RULES = makeRules(t)

  const schema = z.object({
    password: z.string()
      .min(8, t('zodMinLength'))
      .regex(/[a-z]/, t('zodLower'))
      .regex(/[A-Z]/, t('zodUpper'))
      .regex(/[0-9]/, t('zodDigit'))
      .regex(/[^A-Za-z0-9]/, t('zodSpecial')),
    confirm: z.string(),
  }).refine(d => d.password === d.confirm, {
    message: t('zodConfirmMatch'),
    path: ['confirm'],
  })

  // Gate the form on a LOCAL session check, not getUser(). getUser() makes a
  // network round-trip that can hang in a must_change_password session (the
  // restricted JWT stalls on token refresh) — with no timeout that left the
  // page spinning forever. getSession() reads the session from the cookie and
  // cannot hang. The real auth check still happens server-side in the API
  // route (getUser), so this does not weaken security. A safety timeout
  // guarantees the spinner always resolves.
  useEffect(() => {
    let settled = false
    const finish = (action: 'form' | 'login') => {
      if (settled) return
      settled = true
      if (action === 'login') { router.replace('/login'); return }
      setChecking(false)
    }

    supabase.auth.getSession()
      .then(({ data: { session } }) => finish(session ? 'form' : 'login'))
      // On any error, show the form rather than spin — the API enforces auth
      // and returns 401 (handled as errorSessionExpired) if the session is bad.
      .catch(() => finish('form'))

    // Safety net: never spin forever, whatever happens to the auth check.
    const tid = setTimeout(() => finish('form'), 4000)
    return () => clearTimeout(tid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
  })

  const passwordValue = useWatch({ control, name: 'password', defaultValue: '' })

  async function onSubmit(data: FormData) {
    setError(null)
    setStep('finalizing')
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: data.password }),
        signal: controller.signal,
      })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; redirect_to?: string; error?: string }
      if (!res.ok) {
        setError(
          res.status === 401
            ? t('errorSessionExpired')
            : res.status === 429
            ? t('errorTooManyAttempts')
            : (json.error ?? t('errorGeneric'))
        )
        return
      }
      setStep('redirecting')
      router.replace(json.redirect_to ?? '/dashboard')
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.name === 'AbortError'
          ? t('errorTimeout')
          : t('errorNetwork')
      )
    } finally {
      clearTimeout(tid)
      setStep(prev => prev === 'redirecting' ? prev : null)
    }
  }

  const stepLabel =
    step === 'finalizing'  ? t('finalizing') :
    step === 'redirecting' ? t('redirecting') :
    t('submit')

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-700 shadow-lg">
            <Stethoscope className="h-7 w-7 text-white" />
          </div>
          <div aria-hidden="true" className="mx-auto mb-3 flex h-1 w-20 overflow-hidden rounded-full">
            <div className="flex-1 bg-[#009E60]" />
            <div className="flex-1 bg-[#FDEF42]" />
            <div className="flex-1 bg-[#E31B23]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            CHMS Sénégal{' '}
            <span className="text-[#009E60] text-xl" aria-hidden="true">★</span>
          </h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-teal-700" />
                <CardTitle>{t('title')}</CardTitle>
              </div>
              <LocaleSwitcher />
            </div>
            <CardDescription>
              {t('description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('newPassword')}</Label>
                <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
                {errors.password && (
                  <p className="text-xs text-red-500">{errors.password.message}</p>
                )}

                {/* Live requirement checklist */}
                <ul className="mt-2 space-y-1">
                  {RULES.map(rule => {
                    const ok = rule.test(passwordValue ?? '')
                    return (
                      <li key={rule.key} className={`flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {ok
                          ? <Check className="h-3 w-3 shrink-0" />
                          : <X className="h-3 w-3 shrink-0" />}
                        {rule.label}
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t('confirmPassword')}</Label>
                <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
                {errors.confirm && (
                  <p className="text-xs text-red-500">{errors.confirm.message}</p>
                )}
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full bg-teal-700 hover:bg-teal-800" disabled={isSubmitting || !!step}>
                {(isSubmitting || !!step) && <Loader2 className="h-4 w-4 animate-spin" />}
                {stepLabel}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
