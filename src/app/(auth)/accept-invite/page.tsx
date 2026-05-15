'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Stethoscope } from 'lucide-react'
import { acceptInvite } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  full_name: z.string().min(2, 'Prénom et nom requis'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm'],
})
type FormData = z.infer<typeof schema>

export default function AcceptInvitePage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError(null)
    if (!token) {
      setError('Lien d\'invitation invalide ou manquant.')
      return
    }
    const formData = new FormData()
    formData.set('full_name', data.full_name)
    formData.set('password', data.password)
    const result = await acceptInvite(token, formData)
    if (result?.error) setError(result.error)
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
          <p className="text-sm text-gray-500 mt-1.5">
            Créez votre compte pour rejoindre votre clinique
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Accepter l&apos;invitation</CardTitle>
            <CardDescription>
              Complétez votre profil pour accéder à votre espace
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!token ? (
              <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                Lien d&apos;invitation invalide. Demandez un nouvel email à votre administrateur.
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Nom complet</Label>
                  <Input
                    id="full_name"
                    type="text"
                    placeholder="Amadou Diallo"
                    {...register('full_name')}
                  />
                  {errors.full_name && (
                    <p className="text-xs text-red-500">{errors.full_name.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input id="password" type="password" {...register('password')} />
                  {errors.password && (
                    <p className="text-xs text-red-500">{errors.password.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirmer le mot de passe</Label>
                  <Input id="confirm" type="password" {...register('confirm')} />
                  {errors.confirm && (
                    <p className="text-xs text-red-500">{errors.confirm.message}</p>
                  )}
                </div>
                {error && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                    {error}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" />}
                  Créer mon compte
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
