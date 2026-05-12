'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, MapPin, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Clinic, SubscriptionPlan } from '@/types/database'

const schema = z.object({
  name: z.string().min(2, 'Nom requis'),
  location: z.string().min(2, 'Localisation requise'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  subscription_plan: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
})
type FormData = z.infer<typeof schema>

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  basic: 'bg-blue-100 text-blue-700',
  pro: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-700',
}

export default function AdminClinicsPage() {
  const { profile } = useClinic()
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const supabase = createClient()

  const { data: clinics, isLoading } = useQuery({
    queryKey: ['admin-clinics'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Clinic[]
    },
  })

  const createMutation = useMutation({
    mutationFn: async (input: FormData) => {
      const res = await fetch('/api/admin/create-clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur')
      return json.clinic
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-clinics'] })
      toast.success('Clinique créée')
      setOpen(false)
      reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { subscription_plan: 'free' },
  })

  if (profile?.role !== 'super_admin') {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Administration" />
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <Shield className="h-12 w-12 mb-3" />
          <p>Accès réservé aux super administrateurs</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Gestion des Cliniques" description="Vue super administrateur" />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">{clinics?.length ?? 0} clinique(s) enregistrée(s)</p>
          <Button onClick={() => { reset(); setOpen(true) }}>
            <Plus className="h-4 w-4" /> Nouvelle clinique
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading && <div className="col-span-3 text-center py-8"><Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" /></div>}
          {clinics?.map(clinic => (
            <Card key={clinic.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-sm">
                    {clinic.name[0]}
                  </div>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', planColors[clinic.subscription_plan])}>
                    {clinic.subscription_plan.toUpperCase()}
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900">{clinic.name}</h3>
                <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                  <MapPin className="h-3.5 w-3.5" />
                  {clinic.location}
                </div>
                {clinic.email && <p className="text-xs text-gray-400 mt-1">{clinic.email}</p>}
                <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-gray-400">
                  <span>Créée le {formatDate(clinic.created_at)}</span>
                  <Badge variant={clinic.subscription_status === 'active' ? 'success' : 'destructive'} className="text-xs">
                    {clinic.subscription_status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer une clinique</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d as FormData))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nom de la clinique *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Localisation *</Label>
              <Input {...register('location')} placeholder="Dakar, Plateau" />
              {errors.location && <p className="text-xs text-red-500">{errors.location.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Téléphone</Label>
                <Input {...register('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" {...register('email')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Plan d&apos;abonnement</Label>
              <Select defaultValue="free" onValueChange={v => setValue('subscription_plan', v as SubscriptionPlan)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Gratuit</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Créer
              </Button>

            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
