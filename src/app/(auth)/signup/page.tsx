'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Stethoscope, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  clinic_name:     z.string().min(3, 'Nom de la clinique requis (3 caractères min.)'),
  location:        z.string().min(3, 'Localisation requise'),
  phone:           z.string().optional().nullable(),
  admin_full_name: z.string().min(2, 'Votre nom complet est requis'),
  admin_email:     z.string().email('Email invalide'),
  message:         z.string().optional().nullable(),
})
type FormData = z.infer<typeof schema>

export default function SignupPage() {
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError(null)
    const res = await fetch('/api/clinic-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Erreur lors de l\'envoi'); return }
    setSubmitted(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-100 p-4">
      <div className="w-full max-w-lg space-y-6">
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
            CHMS Sénégal <span className="text-[#009E60] text-xl" aria-hidden="true">★</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Demande d&apos;accès pour votre clinique</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inscription clinique</CardTitle>
            <CardDescription>
              Remplissez ce formulaire. Notre équipe examinera votre demande et vous contactera sous 24–48h.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="py-6 text-center space-y-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Demande envoyée !</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Vous recevrez un lien de connexion dès validation par notre équipe.
                    Vérifiez votre boîte mail et vos SMS.
                  </p>
                </div>
                <Link href="/login" className="block text-sm text-teal-700 hover:underline">
                  Retour à la connexion
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="border-b pb-4 space-y-4">
                  <p className="text-sm font-medium text-gray-700">Votre clinique</p>
                  <div className="space-y-1.5">
                    <Label>Nom de la clinique *</Label>
                    <Input placeholder="Clinique Sainte Marie" {...register('clinic_name')} />
                    {errors.clinic_name && <p className="text-xs text-red-500">{errors.clinic_name.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Ville / Localisation *</Label>
                      <Input placeholder="Dakar, Plateau" {...register('location')} />
                      {errors.location && <p className="text-xs text-red-500">{errors.location.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Téléphone</Label>
                      <Input placeholder="+221 77 000 00 00" {...register('phone')} />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-sm font-medium text-gray-700">Responsable / Administrateur</p>
                  <div className="space-y-1.5">
                    <Label>Nom complet *</Label>
                    <Input placeholder="Dr. Aminata Diallo" {...register('admin_full_name')} />
                    {errors.admin_full_name && <p className="text-xs text-red-500">{errors.admin_full_name.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email professionnel *</Label>
                    <Input type="email" placeholder="admin@clinique.sn" {...register('admin_email')} />
                    {errors.admin_email && <p className="text-xs text-red-500">{errors.admin_email.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Message (optionnel)</Label>
                    <Textarea
                      placeholder="Décrivez brièvement votre structure médicale..."
                      rows={3}
                      {...register('message')}
                      className="resize-none"
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
                )}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" />}
                  Envoyer ma demande
                </Button>
              </form>
            )}
          </CardContent>
          {!submitted && (
            <CardFooter className="justify-center">
              <p className="text-sm text-gray-500">
                Déjà un compte?{' '}
                <Link href="/login" className="font-medium text-teal-700 hover:underline">Se connecter</Link>
              </p>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  )
}
