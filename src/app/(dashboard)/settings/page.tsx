'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Building2, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'

const clinicSchema = z.object({
  name: z.string().min(2),
  location: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
})
type ClinicFormData = z.infer<typeof clinicSchema>

const profileSchema = z.object({
  full_name: z.string().min(2),
  phone: z.string().optional().nullable(),
})
type ProfileFormData = z.infer<typeof profileSchema>

export default function SettingsPage() {
  const { clinic, profile, refetch } = useClinic()
  const supabase = createClient()

  const clinicForm = useForm<ClinicFormData>({
    resolver: zodResolver(clinicSchema),
    defaultValues: { name: clinic?.name ?? '', location: clinic?.location ?? '', phone: clinic?.phone ?? '', email: clinic?.email ?? '' },
  })

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' },
  })

  async function saveClinic(data: ClinicFormData) {
    if (!clinic) return
    const { error } = await supabase.from('clinics').update({
      name: data.name,
      location: data.location,
      phone: data.phone ?? null,
      email: data.email ?? null,
    }).eq('id', clinic.id)
    if (error) { toast.error(error.message); return }
    toast.success('Clinique mise à jour')
    refetch()
  }

  async function saveProfile(data: ProfileFormData) {
    if (!profile) return
    const { error } = await supabase.from('user_profiles').update({
      full_name: data.full_name,
      phone: data.phone ?? null,
    }).eq('id', profile.id)
    if (error) { toast.error(error.message); return }
    toast.success('Profil mis à jour')
    refetch()
  }

  const canEditClinic = profile?.role === 'admin' || profile?.role === 'super_admin'

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Paramètres" />
      <div className="flex-1 p-6 max-w-2xl space-y-6">

        {/* Profile settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Mon profil
            </CardTitle>
            <CardDescription>Modifiez vos informations personnelles</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>Nom complet</Label>
                  <Input {...profileForm.register('full_name')} />
                </div>
                <div className="space-y-1.5">
                  <Label>Téléphone</Label>
                  <Input {...profileForm.register('phone')} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={profile?.email ?? ''} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label>Rôle</Label>
                  <Input value={profile?.role ?? ''} disabled className="bg-gray-50 capitalize" />
                </div>
              </div>
              <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                {profileForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                Enregistrer le profil
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Clinic settings */}
        {canEditClinic && clinic && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> Ma clinique
              </CardTitle>
              <CardDescription>Modifiez les informations de votre clinique</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={clinicForm.handleSubmit(saveClinic)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label>Nom de la clinique</Label>
                    <Input {...clinicForm.register('name')} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Localisation</Label>
                    <Input {...clinicForm.register('location')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Téléphone</Label>
                    <Input {...clinicForm.register('phone')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" {...clinicForm.register('email')} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={clinicForm.formState.isSubmitting}>
                    {clinicForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                    Enregistrer la clinique
                  </Button>
                  <span className="text-xs text-gray-400">
                    Plan: <strong className="capitalize">{clinic.subscription_plan}</strong>
                  </span>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
