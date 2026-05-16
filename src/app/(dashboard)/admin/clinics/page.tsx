'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, MapPin, Shield, Copy, CheckCircle2,
  AlertCircle, Ban, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Clinic, ClinicStatus, SubscriptionPlan } from '@/types/database'

const schema = z.object({
  name:              z.string().min(2, 'Nom requis'),
  location:          z.string().min(2, 'Localisation requise'),
  phone:             z.string().optional().nullable(),
  email:             z.string().email().optional().or(z.literal('')).nullable(),
  subscription_plan: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
  admin_full_name:   z.string().min(2, 'Nom de l\'admin requis'),
  admin_email:       z.string().email('Email admin invalide'),
})
type FormData = z.infer<typeof schema>

const planColors: Record<string, string> = {
  free:       'bg-gray-100 text-gray-600',
  basic:      'bg-blue-100 text-blue-700',
  pro:        'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-700',
}

const statusConfig: Record<string, { label: string; variant: string; dot: string }> = {
  pending:   { label: 'En attente',  variant: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400' },
  active:    { label: 'Active',      variant: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Rejetée',    variant: 'bg-red-100 text-red-700',         dot: 'bg-red-400' },
  suspended: { label: 'Suspendue',  variant: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
}

export default function AdminClinicsPage() {
  const { profile } = useClinic()
  const [open, setOpen] = useState(false)
  const [tempPassword, setTempPassword] = useState<{ password: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()
  const supabase = createClient()

  const { data: clinics, isLoading } = useQuery({
    queryKey: ['admin-clinics'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .order('created_at', { ascending: false })
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
      return json as { clinic: Clinic; temp_password: string }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-clinics'] })
      toast.success('Clinique et compte admin créés')
      reset()
      setTempPassword({ password: data.temp_password, email: data.clinic.email ?? '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const suspendMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ClinicStatus }) => {
      const { error } = await supabase
        .from('clinics')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status } as any)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-clinics'] })
      toast.success('Statut mis à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { subscription_plan: 'free' },
  })

  async function copyPassword() {
    if (!tempPassword) return
    await navigator.clipboard.writeText(tempPassword.password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (profile?.role !== 'super_admin') {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Administration" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
          <Shield className="h-12 w-12 opacity-30" />
          <p>Accès réservé aux super administrateurs</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Gestion des Cliniques" description="Vue super administrateur" />

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">{clinics?.length ?? 0} clinique(s) enregistrée(s)</p>
          <Button onClick={() => { reset(); setTempPassword(null); setOpen(true) }}>
            <Plus className="h-4 w-4" /> Nouvelle clinique
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading && (
            <div className="col-span-3 text-center py-8">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
            </div>
          )}
          {clinics?.map(clinic => {
            const status = ((clinic as { status?: string }).status ?? 'active') as ClinicStatus
            const sc = statusConfig[status] ?? statusConfig.active
            return (
              <Card key={clinic.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white font-bold text-sm shrink-0">
                      {clinic.name[0]}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', sc.variant)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', sc.dot)} />
                        {sc.label}
                      </span>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', planColors[clinic.subscription_plan])}>
                        {clinic.subscription_plan.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-semibold text-gray-900">{clinic.name}</h3>
                  <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {clinic.location}
                  </div>
                  {clinic.email && <p className="text-xs text-gray-400 mt-1">{clinic.email}</p>}
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-gray-400">
                    <span>Créée le {formatDate(clinic.created_at)}</span>
                    <div className="flex gap-1">
                      {status === 'active' && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 px-2 text-xs text-amber-600 hover:bg-amber-50"
                          onClick={() => suspendMutation.mutate({ id: clinic.id, status: 'suspended' })}
                          disabled={suspendMutation.isPending}
                          title="Suspendre"
                        >
                          <Ban className="h-3 w-3" />
                        </Button>
                      )}
                      {status === 'suspended' && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
                          onClick={() => suspendMutation.mutate({ id: clinic.id, status: 'active' })}
                          disabled={suspendMutation.isPending}
                          title="Réactiver"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Create clinic dialog */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); setTempPassword(null) } setOpen(o) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Créer une clinique</DialogTitle>
          </DialogHeader>

          {tempPassword ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800 font-medium">Clinique et compte admin créés.</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Mot de passe temporaire de l&apos;admin</p>
                <div className="flex gap-2">
                  <Input value={tempPassword.password} readOnly className="font-mono tracking-widest bg-gray-50" />
                  <Button variant="outline" size="icon" onClick={copyPassword} title="Copier">
                    {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-amber-700 flex gap-1.5 items-start">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Ce mot de passe ne s&apos;affichera qu&apos;une seule fois. L&apos;admin devra le changer à la première connexion.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { setOpen(false); setTempPassword(null) }}>Fermer</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Clinique</p>
                <div className="space-y-1.5">
                  <Label>Nom *</Label>
                  <Input {...register('name')} placeholder="Clinique Sainte Marie" />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Localisation *</Label>
                  <Input {...register('location')} placeholder="Dakar, Plateau" />
                  {errors.location && <p className="text-xs text-red-500">{errors.location.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                  <Label>Plan</Label>
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
              </div>

              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Administrateur</p>
                <div className="space-y-1.5">
                  <Label>Nom complet *</Label>
                  <Input {...register('admin_full_name')} placeholder="Dr. Aminata Diallo" />
                  {errors.admin_full_name && <p className="text-xs text-red-500">{errors.admin_full_name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input type="email" {...register('admin_email')} placeholder="admin@clinique.sn" />
                  {errors.admin_email && <p className="text-xs text-red-500">{errors.admin_email.message}</p>}
                </div>
                <p className="text-xs text-gray-400">
                  Un mot de passe temporaire sera généré. L&apos;admin devra le changer à la première connexion.
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
                  {(isSubmitting || createMutation.isPending) && <Loader2 className="animate-spin" />}
                  Créer
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
