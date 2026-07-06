'use client'

// ── Workforce UI — shared presentational helpers (Phase 21) ────────
// Label-key maps + small badges. Purely presentational; no data logic.

import { cn } from '@/lib/utils'
import type { EmploymentStatus, EmploymentType, ReminderTier, VerificationStatus } from '@/lib/workforce/types'

export const STATUS_STYLES: Record<EmploymentStatus, string> = {
  active:     'bg-emerald-100 text-emerald-700',
  on_leave:   'bg-amber-100 text-amber-700',
  suspended:  'bg-orange-100 text-orange-700',
  retired:    'bg-gray-100 text-gray-600',
  terminated: 'bg-rose-100 text-rose-700',
}

export const STATUS_LABEL_KEY: Record<EmploymentStatus, string> = {
  active: 'status_active', on_leave: 'status_on_leave', suspended: 'status_suspended',
  retired: 'status_retired', terminated: 'status_terminated',
}

export const TYPE_LABEL_KEY: Record<EmploymentType, string> = {
  permanent: 'type_permanent', contract: 'type_contract', intern: 'type_intern',
  resident: 'type_resident', consultant: 'type_consultant', volunteer: 'type_volunteer',
}

export const CREDENTIAL_TYPE_KEY: Record<string, string> = {
  license: 'cred_license', board_certification: 'cred_board', diploma: 'cred_diploma',
  training: 'cred_training', council_registration: 'cred_council', other: 'cred_other',
}

export const VERIFICATION_STYLES: Record<VerificationStatus, string> = {
  verified: 'bg-emerald-100 text-emerald-700',
  unverified: 'bg-gray-100 text-gray-600',
  rejected: 'bg-rose-100 text-rose-700',
}

export function tierStyle(tier: ReminderTier): string {
  switch (tier) {
    case 'expired': return 'bg-rose-100 text-rose-700'
    case 'due_30':  return 'bg-orange-100 text-orange-700'
    case 'due_60':  return 'bg-amber-100 text-amber-700'
    case 'due_90':  return 'bg-yellow-100 text-yellow-700'
    default:        return 'bg-gray-100 text-gray-600'
  }
}

export const EVENT_LABEL_KEY: Record<string, string> = {
  hired: 'evt_hired', activated: 'evt_activated', leave_started: 'evt_leave_started',
  suspended: 'evt_suspended', returned: 'evt_returned', retired: 'evt_retired',
  terminated: 'evt_terminated', role_changed: 'evt_role_changed',
  department_changed: 'evt_department_changed', specialty_changed: 'evt_specialty_changed',
  credential_added: 'evt_credential_added', credential_renewed: 'evt_credential_renewed',
  password_reset: 'evt_password_reset', profile_updated: 'evt_profile_updated',
  training_completed: 'evt_training_completed', note: 'evt_note',
}

export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}>{children}</span>
}

/** Human-readable specialty label from a code (avoids coupling to the specialty
 *  i18n namespace; the registry only carries labelKeys). "general_practice" → "General practice". */
export function prettifySpecialty(id?: string | null): string {
  if (!id) return ''
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
