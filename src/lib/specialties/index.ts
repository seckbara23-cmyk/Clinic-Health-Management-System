// ── Specialty registry (Layer 2) ──────────────────────────────────
//
// The single plug-in point. A future specialty is a definition file plus ONE
// line appended here — no page, resolver, or core change (the same model as
// ALL_TOOLS and SETTINGS_SECTIONS). Phase 14.1 registers only general_practice.

import type { SpecialtyDefinition, SpecialtyId } from '@/lib/workspace/types'
import { generalPractice } from './general-practice'

export const DEFAULT_SPECIALTY: SpecialtyId = 'general_practice'

export const SPECIALTIES: SpecialtyDefinition[] = [
  generalPractice,
  // ← future specialty packs plug in here (pediatrics, obgyn, cardiology…)
]

/** Resolve a specialty by id, falling back to general_practice (never throws). */
export function getSpecialty(id?: string | null): SpecialtyDefinition {
  return SPECIALTIES.find(s => s.id === id) ?? generalPractice
}

export function isRegisteredSpecialty(id?: string | null): boolean {
  return !!id && SPECIALTIES.some(s => s.id === id)
}
