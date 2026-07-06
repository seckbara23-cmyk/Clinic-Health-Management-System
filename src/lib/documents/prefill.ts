// ── Clinical Documents — prefill (pure) (Phase 20) ─────────────────
//
// Resolves a field's initial value from EXISTING recorded data. Deterministic,
// framework-free, no I/O. It copies identity/administrative data and the
// clinician's OWN recorded consultation text — it NEVER generates a clinical
// finding, diagnosis, or recommendation. The clinician edits every value before
// printing.

import type { DocumentContext, DocumentDefinition, DocumentValues, PrefillSource } from './types'

function nonEmpty(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function ageYears(dob?: string | null, now: Date = new Date()): string {
  if (!dob) return ''
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return ''
  let age = now.getUTCFullYear() - d.getUTCFullYear()
  const m = now.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--
  return age >= 0 && age < 150 ? String(age) : ''
}

/** Resolve one prefill source against the context. Returns '' when unavailable —
 *  never throws, never fabricates. */
export function resolvePrefill(source: PrefillSource | undefined, ctx: DocumentContext): string {
  if (!source) return ''
  const p = ctx.patient, c = ctx.consultation, pr = ctx.profile, cl = ctx.clinic
  switch (source) {
    case 'patient.full_name': return nonEmpty(p?.full_name)
    case 'patient.patient_number': return nonEmpty(p?.patient_number)
    case 'patient.date_of_birth': return nonEmpty(p?.date_of_birth)
    case 'patient.age': return ageYears(p?.date_of_birth, ctx.now)
    case 'patient.gender': return nonEmpty(p?.gender)
    case 'patient.address': return nonEmpty(p?.address)
    case 'patient.phone': return nonEmpty(p?.phone)
    case 'patient.cni': return nonEmpty(p?.cni)
    case 'consultation.chief_complaint': return nonEmpty(c?.chief_complaint)
    case 'consultation.symptoms': return nonEmpty(c?.symptoms)
    case 'consultation.diagnosis': return nonEmpty(c?.diagnosis)
    case 'consultation.treatment_plan': return nonEmpty(c?.treatment_plan)
    case 'consultation.notes': return nonEmpty(c?.notes)
    case 'consultation.follow_up_date': return nonEmpty(c?.follow_up_date)
    case 'profile.full_name': return nonEmpty(pr?.full_name)
    case 'profile.title': return nonEmpty(pr?.professionalTitle)
    case 'clinic.name': return nonEmpty(cl?.name)
    case 'clinic.location': return nonEmpty(cl?.location)
    case 'clinic.phone': return nonEmpty(cl?.phone)
    case 'today': return ctx.now.toISOString().slice(0, 10)
    default: return ''
  }
}

/** Build the initial value map for a document from its context. Pure. */
export function buildInitialValues(def: DocumentDefinition, ctx: DocumentContext): DocumentValues {
  const out: DocumentValues = {}
  for (const f of def.fields) out[f.key] = resolvePrefill(f.prefill, ctx)
  return out
}

/** Which required fields are still empty (for a save/print gate). Pure. */
export function missingRequired(def: DocumentDefinition, values: DocumentValues): string[] {
  return def.fields.filter(f => f.required && !((values[f.key] ?? '').trim())).map(f => f.key)
}
