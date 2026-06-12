'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Users, Mail, KeyRound, Copy, Check, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { UserProfile, Clinic, Role } from '@/types/database'

interface ResetResult {
  temp_password: string
  user: { email: string; full_name: string }
}

const roleColors: Record<string, string> = {
  super_admin:   'bg-purple-100 text-purple-700',
  admin:         'bg-blue-100 text-blue-700',
  doctor:        'bg-emerald-100 text-emerald-700',
  receptionist:  'bg-amber-100 text-amber-700',
  nurse:         'bg-pink-100 text-pink-700',
  cashier:       'bg-orange-100 text-orange-700',
  lab_technician:'bg-cyan-100 text-cyan-700',
}

export default function AdminUsersPage() {
  const t = useTranslations('adminUsers')
  const { formatDate } = useFormatters()
  const { profile } = useClinic()
  const [open, setOpen] = useState(false)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [copied, setCopied] = useState(false)
  const supabase = createClient()

  const roleLabels: Record<string, string> = {
    super_admin:  t('roleSuperAdmin'),
    admin:        t('roleAdmin'),
    doctor:       t('roleDoctor'),
    receptionist: t('roleReceptionist'),
    nurse:        t('roleNurse'),
    cashier:      t('roleCashier'),
    lab_technician: t('roleLabTechnician'),
  }

  const inviteSchema = z.object({
    email:      z.string().email(t('zodEmailInvalid')),
    role:       z.enum(['admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician']),
    clinic_id:  z.string().min(1, t('zodClinicRequired')),
  })
  type InviteFormData = z.infer<typeof inviteSchema>

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    enabled: !!profile && isAdmin,
    queryFn: async () => {
      const q = profile?.role === 'super_admin'
        ? supabase.from('user_profiles').select('*, clinic:clinics(id, name)').order('created_at', { ascending: false })
        : supabase.from('user_profiles').select('*, clinic:clinics(id, name)').eq('clinic_id', profile!.clinic_id!).order('created_at', { ascending: false })
      const { data, error } = await q
      if (error) throw error
      return data as unknown as (UserProfile & { clinic: Clinic })[]
    },
  })

  const { data: clinics } = useQuery({
    queryKey: ['admin-clinics-select'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('id, name').order('name')
      if (error) throw error
      return data as Pick<Clinic, 'id' | 'name'>[]
    },
  })

  const isSuperAdmin = profile?.role === 'super_admin'

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Erreur')
      return body as ResetResult
    },
    onSuccess: (data) => setResetResult(data),
    onError: (e: Error) => toast.error(e.message),
  })

  function copyPassword(pwd: string) {
    navigator.clipboard.writeText(pwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inviteMutation = useMutation({
    mutationFn: async (input: InviteFormData) => {
      const { data, error } = await supabase
        .from('clinic_invitations')
        .insert({ email: input.email, role: input.role, clinic_id: input.clinic_id, invited_by: profile!.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success(t('toastInviteSent'))
      setOpen(false)
      reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { clinic_id: profile?.clinic_id ?? '' },
  })

  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t('title')} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
          <Users className="h-12 w-12 opacity-30" />
          <p>{t('noAccess')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-500">{t('userCount', { count: users?.length ?? 0 })}</p>
          <Button onClick={() => { reset({ clinic_id: profile?.clinic_id ?? '' }); setOpen(true) }}>
            <Mail className="h-4 w-4" /> {t('inviteBtn')}
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colEmail')}</TableHead>
                  <TableHead>{t('colRole')}</TableHead>
                  <TableHead>{t('colClinic')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colRegistered')}</TableHead>
                  {isSuperAdmin && <TableHead className="text-right">{t('colActions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 7 : 6} className="text-center py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (!users || users.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 7 : 6} className="text-center py-12 text-gray-400">
                      <Users className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>{t('emptyTitle')}</p>
                    </TableCell>
                  </TableRow>
                )}
                {users?.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {u.must_change_password && (
                          <span title={t('mustChangePassword')}>
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          </span>
                        )}
                        {u.full_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{u.email}</TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', roleColors[u.role])}>
                        {roleLabels[u.role]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{u.clinic?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'success' : 'destructive'} className="text-xs">
                        {u.is_active ? t('statusActive') : t('statusInactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">{formatDate(u.created_at)}</TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-right">
                        {u.role !== 'super_admin' && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1.5"
                            disabled={resetPasswordMutation.isPending}
                            onClick={() => resetPasswordMutation.mutate(u.id)}
                          >
                            {resetPasswordMutation.isPending && resetPasswordMutation.variables === u.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <KeyRound className="h-3 w-3" />
                            }
                            {t('resetPasswordBtn')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Temp password result dialog */}
      {resetResult && (
        <Dialog open onOpenChange={() => setResetResult(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-600" />
                {t('tempPasswordTitle')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="text-gray-600">
                {t('tempPasswordNote', { name: resetResult.user.full_name, email: resetResult.user.email })}
              </p>
              <div className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2">
                <code className="flex-1 font-mono text-base tracking-widest text-gray-900 select-all">
                  {resetResult.temp_password}
                </code>
                <button
                  type="button"
                  onClick={() => copyPassword(resetResult.temp_password)}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                  aria-label={t('copyAriaLabel')}
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {t('tempPasswordWarning')}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setResetResult(null)}>{t('close')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Invite dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('inviteTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => inviteMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('labelEmail')}</Label>
              <Input type="email" placeholder={t('emailPlaceholder')} {...register('email')} />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelRole')}</Label>
              <Select onValueChange={v => setValue('role', v as Exclude<Role, 'super_admin'>)}>
                <SelectTrigger><SelectValue placeholder={t('selectRole')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
                  <SelectItem value="doctor">{t('roleDoctor')}</SelectItem>
                  <SelectItem value="receptionist">{t('roleReceptionist')}</SelectItem>
                  <SelectItem value="nurse">{t('roleNurse')}</SelectItem>
                  <SelectItem value="cashier">{t('roleCashier')}</SelectItem>
                  <SelectItem value="lab_technician">{t('roleLabTechnician')}</SelectItem>
                </SelectContent>
              </Select>
              {errors.role && <p className="text-xs text-red-500">{errors.role.message}</p>}
            </div>
            {profile?.role === 'super_admin' && (
              <div className="space-y-1.5">
                <Label>{t('labelClinic')}</Label>
                <Select onValueChange={v => setValue('clinic_id', v)}>
                  <SelectTrigger><SelectValue placeholder={t('selectClinic')} /></SelectTrigger>
                  <SelectContent>
                    {clinics?.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.clinic_id && <p className="text-xs text-red-500">{errors.clinic_id.message}</p>}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                {t('sendInvite')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
