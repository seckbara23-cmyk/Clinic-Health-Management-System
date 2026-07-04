// ── Professional Registry & Profile — types (Phase 14.2.1) ─────────
//
// Foundation only. These types describe the Professional Registry (the profession
// layer that sits ABOVE specialties) and the authoritative professional-profile
// model — one per (user, clinic). NOTHING here renders, queries, or writes.
//
// Design constraints (frozen Phase 14.2 architecture, §1–§3):
//   • A profession maps to an EXISTING RBAC Role — professions never invent roles
//     or RLS. Profession is an identity/presentation layer over the role.
//   • This layer is generic: it knows nothing about any specific specialty or
//     Copilot Pack. Packs/pathways attach in later phases via string ids only.

import type { Role } from '@/types/database'

// ── Profession (the root classifier) ───────────────────────────────
export type ProfessionId =
  | 'doctor'
  | 'nurse'
  | 'midwife'
  | 'pharmacist'
  | 'lab_technologist'
  | 'radiographer'
  | 'receptionist'
  | 'cashier'
  | 'administrator'

export interface ProfessionDefinition {
  id: ProfessionId
  labelKey: string
  icon: string
  /** The EXISTING platform RBAC role this profession maps to. RLS is unchanged. */
  role: Role
  /** Only specialty-practising professions use the specialty hierarchy (14.2 later). */
  usesSpecialties: boolean
  /** Which credential kinds are relevant — drives the profile form & reminders. */
  credentialKinds: CredentialKind[]
  /**
   * Conventional Copilot-Pack ids auto-available to the profession. Kept EMPTY in
   * this foundation phase (packs do not exist yet) and typed as bare strings so the
   * registry imports nothing pack-specific — no coupling. Populated in a later phase.
   */
  basePacks: string[]
}

// ── Credentials (metadata only — no external verification) ─────────
export type CredentialKind =
  | 'medical_license'
  | 'board_certification'
  | 'specialty_certification'
  | 'fellowship'
  | 'professional_membership'
  | 'cme'
  | 'hospital_privilege'
  | 'diploma'

export interface Credential {
  kind: CredentialKind
  authority?: string | null      // e.g. "Ordre des Médecins du Sénégal"
  identifier?: string | null     // license / registration / certificate number
  title?: string | null
  specialty?: string | null      // specialty id for specialty/board certs (bare string — no coupling)
  issuedAt?: string | null       // ISO date
  expiresAt?: string | null      // ISO date — drives expiry reminders (operational only)
  attestedBy?: string | null     // clinic admin who attested (NOT external proof)
  attestedAt?: string | null
  cmeCredits?: number | null
}

// ── Professional profile (domain model) ────────────────────────────
// The application-facing shape. The DB row (migration 038) is normalised into
// this by the pure mapper in `professional-profile.ts`, tolerant of missing
// columns / a missing table entirely.
export interface ProfessionalProfile {
  userId: string
  clinicId: string
  profession: ProfessionId | null
  displayName: string | null
  professionalTitle: string | null
  department: string | null
  position: string | null
  yearsExperience: number | null
  languages: string[]
  photoPath: string | null
  signaturePath: string | null
  credentials: Credential[]
  onboardingCompleted: boolean
  /** True when this profile was synthesised as a fallback (no DB row / no table). */
  isFallback: boolean
}

// The raw DB row (migration 038) — used by the tolerant hook. All fields optional
// so the mapper degrades gracefully against an un-migrated database.
export interface ProfessionalProfileRow {
  id?: string
  user_id?: string
  clinic_id?: string
  profession?: string | null
  display_name?: string | null
  professional_title?: string | null
  department?: string | null
  position?: string | null
  years_experience?: number | null
  languages?: string[] | null
  photo_path?: string | null
  signature_path?: string | null
  credentials?: unknown
  onboarding_completed?: boolean | null
}

// ── Credential expiry reminders (operational only) ─────────────────
export type ReminderSeverity = 'expired' | 'expiring_soon'

export interface CredentialReminder {
  kind: CredentialKind
  title: string
  severity: ReminderSeverity
  expiresAt: string
  /** Negative = already expired N days ago; positive = expires in N days. */
  daysUntilExpiry: number
}

export type ProfessionalMediaKind = 'photo' | 'signature'
