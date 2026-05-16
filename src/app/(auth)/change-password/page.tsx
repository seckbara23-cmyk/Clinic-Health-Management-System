'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Stethoscope, KeyRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  password: z.string()
    .min(8, 'Minimum 8 caractères')
    .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
    .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
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
  const supabase = createClient()

  // Guard: if user is not logged in, go to login; if not flagged, go to dashboard
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }
      setChecking(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [step, setStep] = useState<'password' | 'finalizing' | 'redirecting' | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError(null)

    // Step 1: update password via Supabase Auth
    setStep('password')
    const t0 = Date.now()
    console.log('[change-pw] step 1: updateUser start')
    const { error: authError } = await supabase.auth.updateUser({ password: data.password })
    console.log(`[change-pw] step 1: updateUser ${Date.now() - t0}ms`)
    if (authError) {
      setError(authError.message)
      setStep(null)
      return
    }

    // Step 2: clear flag + get redirect target (server handles both in parallel)
    setStep('finalizing')
    const t1 = Date.now()
    console.log('[change-pw] step 2: API call start')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    let redirectTo = '/dashboard'
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        signal: controller.signal,
      })
      clearTimeout(timeout)
      console.log(`[change-pw] step 2: API ${Date.now() - t1}ms status=${res.status}`)
      if (res.ok) {
        const json = await res.json() as { ok: boolean; redirect_to: string }
        redirectTo = json.redirect_to ?? '/dashboard'
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? 'Erreur lors de la mise à jour du profil')
        setStep(null)
        return
      }
    } catch {
      clearTimeout(timeout)
      console.warn(`[change-pw] step 2: timeout/error after ${Date.now() - t1}ms — falling back to /dashboard`)
      // Timeout or network error: fall back, the password update already succeeded
    }

    setStep('redirecting')
    console.log(`[change-pw] redirecting to ${redirectTo} total=${Date.now() - t0}ms`)
    router.replace(redirectTo)
  }

  const stepLabel =
    step === 'password'    ? 'Mise à jour du mot de passe…' :
    step === 'finalizing'  ? 'Finalisation…' :
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
                <p className="text-xs text-gray-400">Minimum 8 caractères, une majuscule, un chiffre</p>
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
