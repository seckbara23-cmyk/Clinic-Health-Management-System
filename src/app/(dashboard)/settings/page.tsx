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
import { isValidPhone, toStoredPhone } from '@/lib/phone'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export default function SettingsPage() {
  const t = useTranslations('settings')
  const { clinic, profile, refetch } = useClinic()
  const supabase = createClient()

  const phoneField = z.string().optional().nullable().refine(isValidPhone, t('zodPhoneInvalid'))

  const clinicSchema = z.object({
    name: z.string().min(2),
    location: z.string().min(2),
    phone: phoneField,
    email: z.string().email().optional().or(z.literal('')).nullable(),
    ninea: z.string().optional().nullable(),
    rc_number: z.string().optional().nullable(),
  })
  type ClinicFormData = z.infer<typeof clinicSchema>

  const profileSchema = z.object({
    full_name: z.string().min(2),
    phone: phoneField,
  })
  type ProfileFormData = z.infer<typeof profileSchema>

  const clinicForm = useForm<ClinicFormData>({
    resolver: zodResolver(clinicSchema),
    defaultValues: {
      name: clinic?.name ?? '', location: clinic?.location ?? '',
      phone: clinic?.phone ?? '', email: clinic?.email ?? '',
      ninea: clinic?.ninea ?? '', rc_number: clinic?.rc_number ?? '',
    },
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
      phone: toStoredPhone(data.phone),
      email: data.email ?? null,
      ninea: data.ninea?.trim() || null,
      rc_number: data.rc_number?.trim() || null,
    }).eq('id', clinic.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('clinicSaved'))
    refetch()
  }

  async function saveProfile(data: ProfileFormData) {
    if (!profile) return
    const { error } = await supabase.from('user_profiles').update({
      full_name: data.full_name,
      phone: toStoredPhone(data.phone),
    }).eq('id', profile.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('profileSaved'))
    refetch()
  }

  const canEditClinic = profile?.role === 'admin' || profile?.role === 'super_admin'

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} />
      <div className="flex-1 p-6 max-w-2xl space-y-6">

        {/* Profile settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> {t('profileTitle')}
            </CardTitle>
            <CardDescription>{t('profileDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>{t('labelFullName')}</Label>
                  <Input {...profileForm.register('full_name')} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelPhone')}</Label>
                  <Input {...profileForm.register('phone')} placeholder="+221 77 123 45 67" />
                  {profileForm.formState.errors.phone && (
                    <p className="text-xs text-red-500">{profileForm.formState.errors.phone.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelEmail')}</Label>
                  <Input value={profile?.email ?? ''} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelRole')}</Label>
                  <Input value={profile?.role ?? ''} disabled className="bg-gray-50 capitalize" />
                </div>
              </div>
              <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                {profileForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                {t('saveProfile')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Clinic settings */}
        {canEditClinic && clinic && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> {t('clinicTitle')}
              </CardTitle>
              <CardDescription>{t('clinicDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={clinicForm.handleSubmit(saveClinic)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label>{t('labelClinicName')}</Label>
                    <Input {...clinicForm.register('name')} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>{t('labelLocation')}</Label>
                    <Input {...clinicForm.register('location')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('labelPhone')}</Label>
                    <Input {...clinicForm.register('phone')} placeholder="+221 33 821 00 00" />
                    {clinicForm.formState.errors.phone && (
                      <p className="text-xs text-red-500">{clinicForm.formState.errors.phone.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('labelEmail')}</Label>
                    <Input type="email" {...clinicForm.register('email')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('labelNinea')}</Label>
                    <Input {...clinicForm.register('ninea')} placeholder="0012345678" />
                    <p className="text-xs text-gray-400">{t('nineaHint')}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('labelRc')}</Label>
                    <Input {...clinicForm.register('rc_number')} placeholder="SN-DKR-2024-A-12345" />
                    <p className="text-xs text-gray-400">{t('rcHint')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={clinicForm.formState.isSubmitting}>
                    {clinicForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                    {t('saveClinic')}
                  </Button>
                  <span className="text-xs text-gray-400">
                    {t('planLabel', { plan: clinic.subscription_plan })}
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
