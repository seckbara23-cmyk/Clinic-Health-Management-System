'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, MapPin, Shield, Copy, CheckCircle2,
  AlertCircle, Ban, RefreshCw, Archive, Filter, AlertTriangle,
} from 'lucide-react'
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
import { useTranslations } from 'next-intl'
import type { Clinic, ClinicStatus, SubscriptionPlan } from '@/types/database'

const planColors: Record<string, string> = {
  free:       'bg-gray-100 text-gray-600',
  basic:      'bg-blue-100 text-blue-700',
  pro:        'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-700',
}

type LifecycleFilter = 'active' | 'all' | 'archived'

export default function AdminClinicsPage() {
  const t = useTranslations('adminClinics')
  const { profile } = useClinic()
  const [open, setOpen] = useState(false)
  const [tempPassword, setTempPassword] = useState<{ password: string; email: string } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Clinic | null>(null)
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('active')
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()

  const statusConfig: Record<string, { label: string; variant: string; dot: string }> = {
    pending:   { label: t('statusPending'),   variant: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400' },
    active:    { label: t('statusActive'),    variant: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
    rejected:  { label: t('statusRejected'),  variant: 'bg-red-100 text-red-700',         dot: 'bg-red-400' },
    suspended: { label: t('statusSuspended'), variant: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-400' },
    inactive:  { label: t('statusInactive'),  variant: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-400' },
    archived:  { label: t('statusArchived'),  variant: 'bg-slate-100 text-slate-500',     dot: 'bg-slate-400' },
  }

  const schema = z.object({
    name:              z.string().min(2, t('labelName')),
    location:          z.string().min(2, t('labelLocation')),
    phone:             z.string().optional().nullable(),
    email:             z.string().email().optional().or(z.literal('')).nullable(),
    subscription_plan: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
    admin_full_name:   z.string().min(2, t('labelAdminName')),
    admin_email:       z.string().email(t('labelAdminEmail')),
  })
  type FormData = z.infer<typeof schema>

  const { data: clinics, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-clinics'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data, error } = await supabase
        .from('clinics')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Clinic[]
    },
  })

  async function callLifecycleAPI(clinicId: string, action: string) {
    const res = await fetch(`/api/admin/clinics/${clinicId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Erreur')
    return json
  }

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
      toast.success(t('toastCreated'))
      reset()
      setTempPassword({ password: data.temp_password, email: data.clinic.email ?? '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const lifecycleMutation = useMutation({
    mutationFn: ({ clinicId, action }: { clinicId: string; action: string }) =>
      callLifecycleAPI(clinicId, action),
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ['admin-clinics'] })
      const messages: Record<string, string> = {
        suspend:      t('toastSuspended'),
        reactivate:   t('toastReactivated'),
        set_inactive: t('toastInactive'),
        archive:      t('toastArchived'),
      }
      toast.success(messages[action] ?? t('toastStatusUpdated'))
      setArchiveTarget(null)
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
        <Topbar title={t('noAccess')} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
          <Shield className="h-12 w-12 opacity-30" />
          <p>{t('noAccessMessage')}</p>
        </div>
      </div>
    )
  }

  const visibleClinics = clinics?.filter(c => {
    const status = ((c as { status?: string }).status ?? 'active') as ClinicStatus
    if (lifecycleFilter === 'archived') return status === 'archived'
    if (lifecycleFilter === 'active') return status !== 'archived'
    return true
  })

  const archivedCount = clinics?.filter(c => ((c as { status?: string }).status ?? 'active') === 'archived').length ?? 0

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3">
          {/* Filter tabs */}
          <div className="flex gap-1.5">
            {([
              { key: 'active',   label: t('filterActive') },
              { key: 'all',      label: t('filterAll') },
              { key: 'archived', label: t('filterArchived', { count: archivedCount }) },
            ] as { key: LifecycleFilter; label: string }[]).map(f => (
              <button
                key={f.key}
                onClick={() => setLifecycleFilter(f.key)}
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  lifecycleFilter === f.key
                    ? 'bg-teal-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {f.key === 'archived' && <Archive className="h-3 w-3" />}
                {f.key === 'all' && <Filter className="h-3 w-3" />}
                {f.label}
              </button>
            ))}
          </div>

          <p className="text-sm text-gray-500 ml-1">
            {t('clinicCount', { count: visibleClinics?.length ?? 0 })}
          </p>

          <Button className="ml-auto" onClick={() => { reset(); setTempPassword(null); setOpen(true) }}>
            <Plus className="h-4 w-4" /> {t('newClinic')}
          </Button>
        </div>

        {lifecycleFilter === 'archived' && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
            <Archive className="h-4 w-4 shrink-0" />
            {t('archivedNotice')}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading && (
            <div className="col-span-3 text-center py-12">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
            </div>
          )}
          {isError && (
            <div className="col-span-3 flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
                <AlertTriangle className="h-7 w-7 text-red-500" />
              </div>
              <p className="font-medium text-gray-900">{t('errorTitle')}</p>
              <p className="text-sm text-gray-500">{t('errorDesc')}</p>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="h-4 w-4" /> {t('retry')}
              </button>
            </div>
          )}
          {!isLoading && !isError && visibleClinics?.length === 0 && (
            <div className="col-span-3 flex flex-col items-center gap-3 py-16 text-center text-gray-400">
              <Shield className="h-12 w-12 opacity-20" />
              <p className="font-medium text-gray-600">
                {lifecycleFilter === 'archived' ? t('emptyArchived') : t('emptyNone')}
              </p>
              {lifecycleFilter !== 'archived' && (
                <p className="text-sm">{t('emptySubtext')}</p>
              )}
            </div>
          )}
          {visibleClinics?.map(clinic => {
            const status = ((clinic as { status?: string }).status ?? 'active') as ClinicStatus
            const sc = statusConfig[status] ?? statusConfig.active
            const isPending = lifecycleMutation.isPending && (lifecycleMutation.variables as { clinicId: string })?.clinicId === clinic.id
            return (
              <Card key={clinic.id} className={cn('hover:shadow-md transition-shadow', status === 'archived' && 'opacity-70')}>
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
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{clinic.location}</span>
                  </div>
                  {clinic.email && <p className="text-xs text-gray-400 mt-1 truncate">{clinic.email}</p>}

                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-gray-400">
                    <span className="shrink-0">{t('createdOn', { date: formatDate(clinic.created_at) })}</span>
                    <div className="flex gap-1 ml-2">
                      {status === 'active' && (
                        <>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-amber-600 hover:bg-amber-50"
                            onClick={() => lifecycleMutation.mutate({ clinicId: clinic.id, action: 'suspend' })}
                            disabled={isPending}
                            title={t('suspendTitle')}
                          >
                            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-slate-600 hover:bg-slate-50"
                            onClick={() => setArchiveTarget(clinic)}
                            disabled={isPending}
                            title={t('archiveTitle')}
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {(status === 'suspended' || status === 'inactive') && (
                        <>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
                            onClick={() => lifecycleMutation.mutate({ clinicId: clinic.id, action: 'reactivate' })}
                            disabled={isPending}
                            title={t('reactivateTitle')}
                          >
                            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-slate-600 hover:bg-slate-50"
                            onClick={() => setArchiveTarget(clinic)}
                            disabled={isPending}
                            title={t('archiveTitle')}
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(o) => { if (!o) setArchiveTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-700">
              <Archive className="h-5 w-5" /> {t('archiveDialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-600">
            <p>{t('archiveWarning', { name: archiveTarget?.name ?? '' })}</p>
            <ul className="space-y-1 text-xs text-gray-500 list-disc list-inside">
              <li>{t('archiveNote1')}</li>
              <li>{t('archiveNote2')}</li>
              <li>{t('archiveNote3')}</li>
              <li>{t('archiveNote4')}</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>{t('cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => archiveTarget && lifecycleMutation.mutate({ clinicId: archiveTarget.id, action: 'archive' })}
              disabled={lifecycleMutation.isPending}
            >
              {lifecycleMutation.isPending && <Loader2 className="animate-spin" />}
              {t('archiveBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create clinic dialog */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); setTempPassword(null) } setOpen(o) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>

          {tempPassword ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800 font-medium">{t('tempPasswordCreated')}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">{t('tempPasswordTitle')}</p>
                <div className="flex gap-2">
                  <Input value={tempPassword.password} readOnly className="font-mono tracking-widest bg-gray-50" />
                  <Button variant="outline" size="icon" onClick={copyPassword} title={t('close')}>
                    {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-amber-700 flex gap-1.5 items-start">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {t('tempPasswordWarning')}
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { setOpen(false); setTempPassword(null) }}>{t('close')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('sectionClinic')}</p>
                <div className="space-y-1.5">
                  <Label>{t('labelName')}</Label>
                  <Input {...register('name')} placeholder={t('namePlaceholder')} />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelLocation')}</Label>
                  <Input {...register('location')} placeholder={t('locationPlaceholder')} />
                  {errors.location && <p className="text-xs text-red-500">{errors.location.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('labelPhone')}</Label>
                    <Input {...register('phone')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('labelEmail')}</Label>
                    <Input type="email" {...register('email')} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelPlan')}</Label>
                  <Select defaultValue="free" onValueChange={v => setValue('subscription_plan', v as SubscriptionPlan)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">{t('planFree')}</SelectItem>
                      <SelectItem value="basic">{t('planBasic')}</SelectItem>
                      <SelectItem value="pro">{t('planPro')}</SelectItem>
                      <SelectItem value="enterprise">{t('planEnterprise')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('sectionAdmin')}</p>
                <div className="space-y-1.5">
                  <Label>{t('labelAdminName')}</Label>
                  <Input {...register('admin_full_name')} placeholder="Dr. Aminata Diallo" />
                  {errors.admin_full_name && <p className="text-xs text-red-500">{errors.admin_full_name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('labelAdminEmail')}</Label>
                  <Input type="email" {...register('admin_email')} placeholder={t('adminEmailPlaceholder')} />
                  {errors.admin_email && <p className="text-xs text-red-500">{errors.admin_email.message}</p>}
                </div>
                <p className="text-xs text-gray-400">{t('adminNote')}</p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
                  {(isSubmitting || createMutation.isPending) && <Loader2 className="animate-spin" />}
                  {t('create')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
