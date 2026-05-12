'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Stethoscope } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  full_name: z.string().min(2, 'Nom requis'),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  clinic_name: z.string().min(3, 'Nom de la clinique requis'),
  clinic_location: z.string().min(3, 'Localisation requise'),
})
type FormData = z.infer<typeof schema>

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError(null)

    // Step 1 — create auth user + clinic via service-role API route
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.email,
        password: data.password,
        full_name: data.full_name,
        clinic_name: data.clinic_name,
        clinic_location: data.clinic_location,
      }),
    })

    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Erreur lors de l\'inscription'); return }

    // Step 2 — sign in on the client to get a real browser session
    // (signUp alone doesn't create a session when email confirmation is on)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (signInError) {
      // Account was created but email confirmation may be required
      setError('Compte créé. Veuillez vérifier votre email pour confirmer votre compte.')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
            <Stethoscope className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Créer votre clinique</h1>
          <p className="text-sm text-gray-500 mt-1">Démarrez gratuitement dès aujourd&apos;hui</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inscription</CardTitle>
            <CardDescription>Créez votre compte administrateur et votre clinique</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>Votre nom complet</Label>
                  <Input placeholder="Dr. Aminata Diallo" {...register('full_name')} />
                  {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Email professionnel</Label>
                  <Input type="email" placeholder="admin@clinique.sn" {...register('email')} />
                  {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Mot de passe</Label>
                  <Input type="password" {...register('password')} />
                  {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
                </div>
              </div>

              <div className="border-t pt-4 space-y-4">
                <p className="text-sm font-medium text-gray-700">Informations de la clinique</p>
                <div className="space-y-1.5">
                  <Label>Nom de la clinique</Label>
                  <Input placeholder="Clinique Sainte Marie" {...register('clinic_name')} />
                  {errors.clinic_name && <p className="text-xs text-red-500">{errors.clinic_name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Localisation</Label>
                  <Input placeholder="Dakar, Plateau" {...register('clinic_location')} />
                  {errors.clinic_location && <p className="text-xs text-red-500">{errors.clinic_location.message}</p>}
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Créer ma clinique
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <p className="text-sm text-gray-500">
              Déjà un compte?{' '}
              <Link href="/login" className="font-medium text-blue-600 hover:underline">Se connecter</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
