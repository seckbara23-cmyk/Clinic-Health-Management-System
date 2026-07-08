'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Users, Mail, KeyRound, Copy, Check, ShieldAlert, UserPlus, Pencil } from 'lucide-react'
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
import { RolePermissionPreview } from '@/components/admin/RolePermissionPreview'
import { EditUserDialog } from '@/components/admin/EditUserDialog'
import { listDepartments, departmentLabelKey } from '@/lib/workforce/departments'
import { specialtyOptions } from '@/lib/identity/model'
import { getClinicalSpecialty } from '@/lib/specialties/taxonomy'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { UserProfile, Clinic, Role } from '@/types/database'

// Distinct badge palettes per identity axis — Role, Department and Specialty must
// never share a colour (Phase 42). Role keeps its per-role colours below;
// Department is indigo; Specialty is teal.
const DEPT_BADGE = 'bg-indigo-100 text-indigo-700'
const SPECIALTY_BADGE = 'bg-teal-100 text-teal-700'

interface ResetResult {
  temp_password: string
  user: { email: string; full_name: string }
  // Distinguishes the reveal-dialog copy: an existing user's password was reset,
  // or a brand-new user was created with a temporary password.
  kind?: 'reset' | 'created'
}

const roleColors: Record<string, string> = {
  super_admin:   'bg-purple-100 text-purple-700',
  admin:         'bg-blue-100 text-blue-700',
  doctor:        'bg-emerald-100 text-emerald-700',
  receptionist:  'bg-amber-100 text-amber-700',
  nurse:         'bg-pink-100 text-pink-700',
  cashier:       'bg-orange-100 text-orange-700',
  lab_technician:'bg-cyan-100 text-cyan-700',
  pharmacist:    'bg-lime-100 text-lime-700',
}

export default function AdminUsersPage() {
  const t = useTranslations('adminUsers')
  const ts = useTranslations('specialties')
  const tw = useTranslations('workforce')
  const { formatDate } = useFormatters()
  const { profile } = useClinic()
  const [open, setOpen] = useState(false)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null)
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all')
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Registry-driven labels — specialty from the taxonomy (single source of truth),
  // department from the identity registry. Unknown/legacy ids degrade to the raw id.
  const specLabel = (id?: string | null) => { const s = getClinicalSpecialty(id); return s ? ts(s.labelKey) : (id ?? '—') }
  const deptLabel = (id?: string | null) => (id ? tw(departmentLabelKey(id)) : '—')

  const roleLabels: Record<string, string> = {
    super_admin:  t('roleSuperAdmin'),
    admin:        t('roleAdmin'),
    doctor:       t('roleDoctor'),
    receptionist: t('roleReceptionist'),
    nurse:        t('roleNurse'),
    cashier:      t('roleCashier'),
    lab_technician: t('roleLabTechnician'),
    pharmacist:   t('rolePharmacist'),
  }

  // One dialog, two onboarding methods: an email invitation (unchanged flow) or
  // immediate creation with a temporary password. full_name is only required for
  // the temp-password method (invited users set their own name on accept).
  const onboardSchema = z.object({
    method:     z.enum(['invite', 'temp']),
    email:      z.string().email(t('zodEmailInvalid')),
    full_name:  z.string().optional(),
    role:       z.enum(['admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician', 'pharmacist']),
    clinic_id:  z.string().min(1, t('zodClinicRequired')),
    department: z.string().min(1, t('zodDepartmentRequired')),
    primary_specialty: z.string().optional(),
  }).superRefine((val, ctx) => {
    if (val.method === 'temp' && !val.full_name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['full_name'], message: t('zodFullNameRequired') })
    }
    // A primary specialty is required for — and only for — doctors.
    if (val.role === 'doctor' && !val.primary_specialty?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primary_specialty'], message: t('zodSpecialtyRequired') })
    }
  })
  type OnboardFormData = z.infer<typeof onboardSchema>

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    enabled: !!profile && isAdmin,
    queryFn: async () => {
      // Explicit FK hint (migration 037 made user_profiles↔clinics ambiguous).
      const embed = '*, clinic:clinics!user_profiles_clinic_id_fkey(id, name)'
      const q = profile?.role === 'super_admin'
        ? supabase.from('user_profiles').select(embed).order('created_at', { ascending: false })
        : supabase.from('user_profiles').select(embed).eq('clinic_id', profile!.clinic_id!).order('created_at', { ascending: false })
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

  // Department / Specialty filters (search is unchanged). Organizational filtering
  // only — never affects what the user can do.
  const filteredUsers = (users ?? []).filter(u =>
    (deptFilter === 'all' || u.department === deptFilter) &&
    (specialtyFilter === 'all' || u.primary_specialty === specialtyFilter),
  )

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
    onSuccess: (data) => setResetResult({ ...data, kind: 'reset' }),
    onError: (e: Error) => toast.error(e.message),
  })

  // Temp-password onboarding — creation happens server-side only (Admin API).
  // The browser never generates the password nor creates the auth user.
  const createUserMutation = useMutation({
    mutationFn: async (input: OnboardFormData) => {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email, full_name: input.full_name, role: input.role, clinic_id: input.clinic_id,
          department: input.department,
          // Only doctors carry a specialty; the server also enforces this.
          primary_specialty: input.role === 'doctor' ? input.primary_specialty : null,
        }),
      })
      const bodyJson = await res.json()
      if (!res.ok) throw new Error(bodyJson.error ?? 'Erreur')
      return bodyJson as ResetResult
    },
    onSuccess: (data) => {
      setResetResult({ ...data, kind: 'created' })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setOpen(false)
      reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function copyPassword(pwd: string) {
    navigator.clipboard.writeText(pwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inviteMutation = useMutation({
    mutationFn: async (input: OnboardFormData) => {
      const { data, error } = await supabase
        .from('clinic_invitations')
        .insert({
          email: input.email, role: input.role, clinic_id: input.clinic_id, invited_by: profile!.id,
          department: input.department,
          primary_specialty: input.role === 'doctor' ? input.primary_specialty : null,
        } as never)
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

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<OnboardFormData>({
    resolver: zodResolver(onboardSchema),
    defaultValues: { method: 'invite', clinic_id: profile?.clinic_id ?? '' },
  })
  const selectedRole = watch('role')
  const method = watch('method')
  const department = watch('department')
  const specialty = watch('primary_specialty')

  // Route the single form to the chosen onboarding method.
  function onSubmit(d: OnboardFormData) {
    if (d.method === 'temp') createUserMutation.mutate(d)
    else inviteMutation.mutate(d)
  }
  const submitting = isSubmitting || inviteMutation.isPending || createUserMutation.isPending

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
          <Button onClick={() => { reset({ method: 'invite', clinic_id: profile?.clinic_id ?? '', department: '', primary_specialty: '' }); setOpen(true) }}>
            <UserPlus className="h-4 w-4" /> {t('addUserBtn')}
          </Button>
        </div>

        {/* Organizational filters — never affect access, only the view. */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 w-48 text-sm"><SelectValue placeholder={t('filterDepartment')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allDepartments')}</SelectItem>
              {listDepartments().map(d => <SelectItem key={d.code} value={d.code}>{tw(d.labelKey)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
            <SelectTrigger className="h-8 w-56 text-sm"><SelectValue placeholder={t('filterSpecialty')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allSpecialties')}</SelectItem>
              {specialtyOptions().map(s => <SelectItem key={s.id} value={s.id}>{ts(s.labelKey)}</SelectItem>)}
            </SelectContent>
          </Select>
          {(deptFilter !== 'all' || specialtyFilter !== 'all') && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setDeptFilter('all'); setSpecialtyFilter('all') }}>
              {t('clearFilters')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colEmail')}</TableHead>
                  <TableHead>{t('colRole')}</TableHead>
                  <TableHead>{t('colDepartment')}</TableHead>
                  <TableHead>{t('colSpecialty')}</TableHead>
                  <TableHead>{t('colClinic')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colRegistered')}</TableHead>
                  <TableHead className="text-right">{t('colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                      <Users className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>{t('emptyTitle')}</p>
                    </TableCell>
                  </TableRow>
                )}
                {filteredUsers.map(u => (
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
                    <TableCell>
                      {u.department
                        ? <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', DEPT_BADGE)}>{deptLabel(u.department)}</span>
                        : <span className="text-sm text-gray-300">—</span>}
                    </TableCell>
                    <TableCell>
                      {u.role === 'doctor' && u.primary_specialty
                        ? <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', SPECIALTY_BADGE)}>{specLabel(u.primary_specialty)}</span>
                        : <span className="text-sm text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{u.clinic?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'success' : 'destructive'} className="text-xs">
                        {u.is_active ? t('statusActive') : t('statusInactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {u.role !== 'super_admin' && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1.5"
                            onClick={() => setEditTarget(u)}
                          >
                            <Pencil className="h-3 w-3" /> {t('editBtn')}
                          </Button>
                        )}
                        {isSuperAdmin && u.role !== 'super_admin' && (
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Edit identity (department + specialty) — never touches role/permissions/auth */}
      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); queryClient.invalidateQueries({ queryKey: ['admin-users'] }) }}
        />
      )}

      {/* Temp password result dialog */}
      {resetResult && (
        <Dialog open onOpenChange={() => setResetResult(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-600" />
                {resetResult.kind === 'created' ? t('createdTitle') : t('tempPasswordTitle')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="text-gray-600">
                {resetResult.kind === 'created'
                  ? t('createdNote', { name: resetResult.user.full_name, email: resetResult.user.email })
                  : t('tempPasswordNote', { name: resetResult.user.full_name, email: resetResult.user.email })}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Onboarding method selector */}
            <div className="space-y-1.5">
              <Label>{t('methodLabel')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['invite', 'temp'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setValue('method', m, { shouldValidate: false })}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                      method === m
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-input hover:border-gray-300',
                    )}
                  >
                    {m === 'invite'
                      ? <Mail className="h-4 w-4 mt-0.5 shrink-0 text-gray-500" />
                      : <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-gray-500" />}
                    <span>
                      <span className="block text-sm font-medium">{m === 'invite' ? t('methodInvite') : t('methodTemp')}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{m === 'invite' ? t('methodInviteHint') : t('methodTempHint')}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {method === 'temp' && (
              <div className="space-y-1.5">
                <Label>{t('labelFullName')}</Label>
                <Input placeholder={t('fullNamePlaceholder')} {...register('full_name')} />
                {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('labelEmail')}</Label>
              <Input type="email" placeholder={t('emailPlaceholder')} {...register('email')} />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelRole')}</Label>
              <Select
                value={selectedRole ?? ''}
                onValueChange={v => {
                  setValue('role', v as Exclude<Role, 'super_admin'>, { shouldValidate: true })
                  // Specialty belongs to doctors only — clear it when the role changes away.
                  if (v !== 'doctor') setValue('primary_specialty', '', { shouldValidate: true })
                }}
              >
                <SelectTrigger><SelectValue placeholder={t('selectRole')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
                  <SelectItem value="doctor">{t('roleDoctor')}</SelectItem>
                  <SelectItem value="receptionist">{t('roleReceptionist')}</SelectItem>
                  <SelectItem value="nurse">{t('roleNurse')}</SelectItem>
                  <SelectItem value="cashier">{t('roleCashier')}</SelectItem>
                  <SelectItem value="lab_technician">{t('roleLabTechnician')}</SelectItem>
                  <SelectItem value="pharmacist">{t('rolePharmacist')}</SelectItem>
                </SelectContent>
              </Select>
              {errors.role && <p className="text-xs text-red-500">{errors.role.message}</p>}
            </div>

            {/* Department — organizational metadata for every role (never a permission). */}
            <div className="space-y-1.5">
              <Label>{t('labelDepartment')}</Label>
              <Select value={department ?? ''} onValueChange={v => setValue('department', v, { shouldValidate: true })}>
                <SelectTrigger><SelectValue placeholder={t('selectDepartment')} /></SelectTrigger>
                <SelectContent>
                  {listDepartments().map(d => <SelectItem key={d.code} value={d.code}>{tw(d.labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.department && <p className="text-xs text-red-500">{errors.department.message}</p>}
            </div>

            {/* Primary Specialty — DOCTORS ONLY. Activates exactly one specialty copilot. */}
            {selectedRole === 'doctor' && (
              <div className="space-y-1.5">
                <Label>{t('labelSpecialty')}</Label>
                <Select value={specialty ?? ''} onValueChange={v => setValue('primary_specialty', v, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder={t('selectSpecialty')} /></SelectTrigger>
                  <SelectContent>
                    {specialtyOptions().map(s => <SelectItem key={s.id} value={s.id}>{ts(s.labelKey)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.primary_specialty && <p className="text-xs text-red-500">{errors.primary_specialty.message}</p>}
                <p className="text-xs text-gray-400">{t('specialtyActivationHint')}</p>
              </div>
            )}

            {/* Live duty description + permission preview */}
            {selectedRole
              ? <RolePermissionPreview role={selectedRole} />
              : <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-4 text-center text-xs text-gray-400">{t('previewHint')}</p>}
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
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {method === 'temp' ? t('createUserBtn') : t('sendInvite')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
