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

// Must match the Supabase Auth password policy configured in the dashboard.
// Policy: lower_upper_letters_digits_symbols (strong)
const RULES = [
  { key: 'length',  label: 'Minimum 8 caractères',          test: (v: string) => v.length >= 8 },
  { key: 'lower',   label: 'Au moins une lettre minuscule', test: (v: string) => /[a-z]/.test(v) },
  { key: 'upper',   label: 'Au moins une lettre majuscule', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'digit',   label: 'Au moins un chiffre',           test: (v: string) => /[0-9]/.test(v) },
  { key: 'special', label: 'Au moins un caractère spécial (!@#$%…)', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
]

const schema = z.object({
  password: z.string()
    .min(8, 'Minimum 8 caractères')
    .regex(/[a-z]/, 'Doit contenir au moins une lettre minuscule')
    .regex(/[A-Z]/, 'Doit contenir au moins une lettre majuscule')
    .regex(/[0-9]/, 'Doit contenir au moins un chiffre')
    .regex(/[^A-Za-z0-9]/, 'Doit contenir au moins un caractère spécial'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm'],
})
type FormData = z.infer<typeof schema>


export default function ChangePasswordPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<'finalizing' | 'redirecting' | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }
      setChecking(false)
    })
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
            ? 'Session expirée — veuillez vous reconnecter.'
            : res.status === 429
            ? 'Trop de tentatives. Réessayez dans quelques minutes.'
            : (json.error ?? 'Erreur lors du changement de mot de passe. Veuillez réessayer.')
        )
        return
      }
      setStep('redirecting')
      router.replace(json.redirect_to ?? '/dashboard')
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.name === 'AbortError'
          ? 'La requête a expiré (15 s). Vérifiez votre connexion et réessayez.'
          : 'Erreur réseau. Vérifiez votre connexion et réessayez.'
      )
    } finally {
      clearTimeout(tid)
      // Keep spinner showing only while redirect is in progress; clear on any error.
      setStep(prev => prev === 'redirecting' ? prev : null)
    }
  }

  const stepLabel =
    step === 'finalizing'  ? 'Mise à jour en cours…' :
    step === 'redirecting' ? 'Redirection…' :
    'Enregistrer et continuer'

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
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-teal-700" />
              <CardTitle>Changer votre mot de passe</CardTitle>
            </div>
            <CardDescription>
              Un mot de passe temporaire vous a été fourni. Choisissez maintenant un mot de passe personnel sécurisé.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Nouveau mot de passe</Label>
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
                <Label htmlFor="confirm">Confirmer le mot de passe</Label>
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
