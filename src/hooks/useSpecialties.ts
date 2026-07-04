import { useMemo } from 'react'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useSaveProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { SPECIALTY_TAXONOMY, type ClinicalSpecialty } from '@/lib/specialties/taxonomy'
import {
  allowedSpecialtiesForProfession,
  resolveSpecialtySelection,
  validateSpecialtySelection,
  normalizeSelection,
  type SpecialtySelection,
  type ResolvedSubSpecialty,
} from '@/lib/specialties/selection'

// ── Specialty hooks (Phase 14.2.3) ─────────────────────────────────
//
// Tolerant by construction: the taxonomy is a CODE registry (no DB read can
// fail), and the professional's selection arrives via the already-tolerant
// profile hook (missing table/row/migration → fallback profile → empty
// selection). Nothing here can block login, the dashboard, or navigation.

/** The full taxonomy plus the slice the current professional may practice. */
export function useSpecialties() {
  const { profession } = useProfessionalIdentity()
  const allowed = useMemo(() => allowedSpecialtiesForProfession(profession.id), [profession.id])
  return {
    taxonomy: SPECIALTY_TAXONOMY,
    allowed,
    usesSpecialties: profession.usesSpecialties,
    profession,
  }
}

/** The professional's primary specialty, resolved against the registry (or null). */
export function usePrimarySpecialty(): ClinicalSpecialty | null {
  const { specialties } = useProfessionalIdentity()
  return specialties.primary
}

/** The professional's secondary specialties, resolved (unknown ids dropped). */
export function useSecondarySpecialties(): ClinicalSpecialty[] {
  const { specialties } = useProfessionalIdentity()
  return specialties.secondaries
}

/** The professional's sub-specialties, resolved with their parent specialty. */
export function useSubSpecialties(): ResolvedSubSpecialty[] {
  const { specialties } = useProfessionalIdentity()
  return specialties.subs
}

/** Validate-then-save a specialty selection onto the caller's own profile.
 *  Rejects (with the first error code) instead of persisting an invalid state. */
export function useSaveSpecialtySelection() {
  const { profession } = useProfessionalIdentity()
  const save = useSaveProfessionalProfile()

  async function saveSelection(sel: SpecialtySelection): Promise<void> {
    const clean = normalizeSelection(profession.id, sel)
    const errors = validateSpecialtySelection(profession.id, clean)
    const first = Object.values(errors)[0]
    if (first) throw new Error(first)
    await save.mutateAsync({
      primarySpecialty: clean.primary,
      secondarySpecialties: clean.secondaries,
      subSpecialties: clean.subs,
    })
  }

  return { saveSelection, isPending: save.isPending }
}

// Re-exported for consumers that only need the pure resolver.
export { resolveSpecialtySelection }
