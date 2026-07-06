// ── Enterprise Workforce — domain types (Phase 21) ─────────────────
//
// Pure type definitions for the workforce/HR tier. This tier is about
// PROFESSIONALS AND EMPLOYEES — never patients. It joins to user_profiles
// (identity + role) and professional_profiles (photo/specialty/languages) but
// owns only employment/HR data. Department and employment status are
// ORGANISATIONAL ONLY — they never grant or change permissions.

import type { Role } from '@/types/database'

export type EmploymentType =
  | 'permanent' | 'contract' | 'intern' | 'resident' | 'consultant' | 'volunteer'

// Steady employment states (the CURRENT status). 'hired' and 'returned' are
// lifecycle EVENTS/transitions, not steady states — they resolve to 'active'.
export type EmploymentStatus =
  | 'active' | 'on_leave' | 'suspended' | 'retired' | 'terminated'

export type CredentialType =
  | 'license' | 'board_certification' | 'diploma' | 'training'
  | 'council_registration' | 'other'

export type CredentialStatus = 'active' | 'expired' | 'revoked' | 'pending'

// Verification is NEVER automated — only a human sets 'verified'/'rejected'.
export type VerificationStatus = 'unverified' | 'verified' | 'rejected'

// Employment-lifecycle + change events (the professional timeline).
export type EmployeeEventType =
  | 'hired' | 'activated' | 'leave_started' | 'suspended' | 'returned'
  | 'retired' | 'terminated'
  | 'role_changed' | 'department_changed' | 'specialty_changed'
  | 'credential_added' | 'credential_renewed'
  | 'password_reset' | 'profile_updated' | 'training_completed' | 'note'

// Credential expiry reminder tiers.
export type ReminderTier = 'expired' | 'due_30' | 'due_60' | 'due_90' | null

export interface EmployeeProfile {
  id: string
  userId: string
  clinicId: string
  matricule: string | null
  nationalId: string | null
  medicalLicenseNumber: string | null
  councilRegistration: string | null
  department: string | null
  position: string | null
  employmentType: EmploymentType | null
  employmentStatus: EmploymentStatus
  hireDate: string | null
  contractEndDate: string | null
  primaryClinicId: string | null
  biography: string | null
  emergencyContact: EmergencyContact
}

export interface EmergencyContact {
  name?: string | null
  phone?: string | null
  relation?: string | null
}

export interface Credential {
  id: string
  employeeId: string
  clinicId: string
  credentialType: CredentialType
  number: string | null
  issuingAuthority: string | null
  issueDate: string | null
  expiryDate: string | null
  status: CredentialStatus
  attachmentPath: string | null
  verificationStatus: VerificationStatus
  notes: string | null
}

export interface EmployeeEvent {
  id: string
  employeeId: string
  clinicId: string
  eventType: EmployeeEventType
  fromValue: string | null
  toValue: string | null
  note: string | null
  effectiveDate: string | null
  createdAt: string
}

export interface TrainingRecord {
  id: string
  employeeId: string
  clinicId: string
  title: string
  provider: string | null
  completedDate: string | null
  expiryDate: string | null
  certificatePath: string | null
}

// The workforce row = user identity + role + (optional) employment record +
// (optional) professional identity. Assembled by the hook from a JOIN.
export interface WorkforceMember {
  userId: string
  clinicId: string
  fullName: string
  email: string | null
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  // Professional identity (from professional_profiles — may be absent)
  primarySpecialty: string | null
  languages: string[]
  // Employment record (from employee_profiles — may be absent until onboarded)
  employee: EmployeeProfile | null
}
