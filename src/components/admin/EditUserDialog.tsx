'use client'

// ── Edit user identity (Phase 42) ─────────────────────────────────
//
// Lets an administrator change a user's DEPARTMENT and (for doctors) PRIMARY
// SPECIALTY. It updates ONLY those two organizational/identity fields on
// user_profiles — role, permissions, clinic and authentication are never touched.
// The write goes through the standard RLS-scoped client (an admin may update users
// in their own clinic; super_admin anywhere) — no RLS change, no service role.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listDepartments } from '@/lib/workforce/departments'
import { specialtyOptions, requiresSpecialty, normalizeIdentity } from '@/lib/identity/model'
import { toast } from 'sonner'
import type { UserProfile } from '@/types/database'

export function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserProfile
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('adminUsers')
  const ts = useTranslations('specialties')
  const tw = useTranslations('workforce')
  const supabase = createClient()

  const isDoctor = requiresSpecialty(user.role)
  const [department, setDepartment] = useState<string>(user.department ?? '')
  const [specialty, setSpecialty] = useState<string>(user.primary_specialty ?? '')

  const save = useMutation({
    mutationFn: async () => {
      // Enforce the identity rule (non-doctor never keeps a specialty) before write.
      const identity = normalizeIdentity({ role: user.role, department, primary_specialty: specialty })
      const { error } = await supabase
        .from('user_profiles')
        .update({ department: identity.department, primary_specialty: identity.primary_specialty } as never)
        .eq('id', user.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success(t('toastUserUpdated')); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{user.full_name} · {t(`role${roleKey(user.role)}`)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('labelDepartment')}</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger><SelectValue placeholder={t('selectDepartment')} /></SelectTrigger>
              <SelectContent>
                {listDepartments().map(d => <SelectItem key={d.code} value={d.code}>{tw(d.labelKey)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isDoctor && (
            <div className="space-y-1.5">
              <Label>{t('labelSpecialty')}</Label>
              <Select value={specialty} onValueChange={setSpecialty}>
                <SelectTrigger><SelectValue placeholder={t('selectSpecialty')} /></SelectTrigger>
                <SelectContent>
                  {specialtyOptions().map(s => <SelectItem key={s.id} value={s.id}>{ts(s.labelKey)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">{t('specialtyActivationHint')}</p>
            </div>
          )}

          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            {t('editIdentityNote')}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Map a role id to the PascalCase suffix used by the adminUsers role keys.
function roleKey(role: string): string {
  const map: Record<string, string> = {
    super_admin: 'SuperAdmin', admin: 'Admin', doctor: 'Doctor', receptionist: 'Receptionist',
    nurse: 'Nurse', cashier: 'Cashier', lab_technician: 'LabTechnician', pharmacist: 'Pharmacist',
  }
  return map[role] ?? 'Admin'
}
