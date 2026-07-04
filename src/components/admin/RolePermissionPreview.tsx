'use client'

import { useTranslations } from 'next-intl'
import { Check, X, ShieldCheck } from 'lucide-react'
import { modulesForRole } from '@/lib/role-permissions'
import type { Role } from '@/types/database'

/**
 * Live, read-only preview of what a role can and cannot reach, shown under the
 * role selector in the invite dialog. Derived from `role-permissions` (which
 * mirrors the sidebar nav gates). Documentation only — renders nothing that
 * affects real authorization.
 */
export function RolePermissionPreview({ role }: { role: Role }) {
  const t = useTranslations('adminUsers')
  const { accessible, restricted } = modulesForRole(role)

  return (
    <div className="rounded-xl border bg-gray-50/60 p-4">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-gray-900">{t(`role${roleSuffix(role)}`)}</h3>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-gray-500">{t(`duty_${role}`)}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            {t('previewAccessible')}
          </p>
          <ul className="space-y-1">
            {accessible.map(m => (
              <li key={m.key} className="flex items-start gap-1.5 text-xs text-gray-700">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                {t(`module_${m.key}`)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            {t('previewRestricted')}
          </p>
          {restricted.length === 0 ? (
            <p className="text-xs text-gray-400">{t('previewFullAccess')}</p>
          ) : (
            <ul className="space-y-1">
              {restricted.map(m => (
                <li key={m.key} className="flex items-start gap-1.5 text-xs text-gray-400">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  {t(`module_${m.key}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// Maps a role id to the existing `role<Suffix>` label key (e.g. lab_technician
// → roleLabTechnician) so we reuse the labels already in the messages files.
function roleSuffix(role: Role): string {
  return {
    super_admin: 'SuperAdmin',
    admin: 'Admin',
    doctor: 'Doctor',
    receptionist: 'Receptionist',
    nurse: 'Nurse',
    cashier: 'Cashier',
    lab_technician: 'LabTechnician',
    pharmacist: 'Pharmacist',
  }[role]
}
