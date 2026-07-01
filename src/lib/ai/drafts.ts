// ── Assisted drafting (Layer 3) — pure, deterministic builders ────
//
// Every builder composes a StructuredDraft from already-available structured
// data. It produces TEMPLATES and factual context only — never a diagnosis,
// never a treatment decision, never an auto-selected medication. The clinician
// reviews, edits and saves through the normal flows. Nothing here writes data
// or calls anything external; these functions are pure and unit-tested.

import type {
  AIConfidence,
  AIWarning,
  Citation,
  DraftData,
  DraftSection,
  DraftType,
  StructuredDraft,
} from './types'
import type { Role } from '@/types/database'

// The mandatory notice shown on every draft.
export const DRAFT_DISCLAIMER = 'AI-generated draft. Requires clinician review.'

// Only doctors and admins (authorised clinicians) may generate drafts.
export const DRAFT_ROLES: Role[] = ['doctor', 'admin']

export function canGenerateDraft(role: Role): boolean {
  return DRAFT_ROLES.includes(role)
}

const TODO = '[À compléter par le clinicien]'

function confidenceFrom(data: DraftData): AIConfidence {
  const basedOn: string[] = []
  if (data.patient) basedOn.push('patient')
  if (data.activeMedications.length) basedOn.push('medications')
  if (data.recentConsultationCount) basedOn.push('consultations')
  if (data.pendingLabCount) basedOn.push('labs')
  const level = basedOn.length >= 3 ? 'high' : basedOn.length >= 1 ? 'medium' : 'low'
  return { level, basedOn, note: basedOn.length ? undefined : 'Limited existing data — draft is a template only.' }
}

function citationsFrom(data: DraftData): Citation[] {
  const c: Citation[] = []
  if (data.patient) c.push({ source: 'Patient record', entity: 'patients', detail: 'identity + allergies' })
  if (data.activeMedications.length) c.push({ source: 'Prescriptions', entity: 'prescriptions', detail: `${data.activeMedications.length} active` })
  if (data.recentConsultationCount) c.push({ source: 'Consultation', entity: 'consultations', date: data.lastConsultationDate, detail: `${data.recentConsultationCount} recent` })
  if (data.pendingLabCount) c.push({ source: 'Laboratory', entity: 'lab_orders', detail: `${data.pendingLabCount} pending` })
  return c
}

function allergyWarnings(data: DraftData): AIWarning[] {
  const allergies = data.patient?.allergies?.trim()
  if (allergies) return [{ level: 'critical', message: `Allergies connues : ${allergies}` }]
  return []
}

function envelope(
  type: DraftType,
  title: string,
  sections: DraftSection[],
  warnings: AIWarning[],
  data: DraftData,
  generatedAt: string,
): StructuredDraft {
  return {
    type,
    title,
    disclaimer: DRAFT_DISCLAIMER,
    sections,
    warnings,
    citations: citationsFrom(data),
    confidence: confidenceFrom(data),
    generatedAt,
    isDraft: true,
  }
}

function historyText(data: DraftData): string {
  const parts: string[] = []
  parts.push(
    data.recentConsultationCount
      ? `Consultations récentes : ${data.recentConsultationCount}${data.lastConsultationDate ? ` (dernière : ${data.lastConsultationDate})` : ''}.`
      : 'Aucune consultation antérieure enregistrée.',
  )
  parts.push(
    data.activeMedications.length
      ? `Traitements en cours : ${data.activeMedications.join(', ')}.`
      : 'Aucun traitement en cours enregistré.',
  )
  parts.push(`Antécédents : ${TODO}`)
  return parts.join('\n')
}

// ── Builders ──────────────────────────────────────────────────────
function buildConsultation(data: DraftData, generatedAt: string): StructuredDraft {
  const sections: DraftSection[] = [
    { key: 'chief_complaint', label: 'Motif de consultation', content: data.appointmentReason || TODO, editable: true },
    { key: 'history', label: 'Anamnèse', content: historyText(data), editable: true },
    { key: 'examination', label: 'Examen clinique', content: TODO, editable: true },
    // No diagnosis is generated — the clinician fills the assessment.
    { key: 'assessment', label: 'Évaluation', content: `${TODO} (aucun diagnostic généré automatiquement)`, editable: true },
    {
      key: 'plan',
      label: 'Plan de soins',
      content: data.pendingLabCount
        ? `Revoir ${data.pendingLabCount} résultat(s) de laboratoire en attente.\n${TODO}`
        : TODO,
      editable: true,
    },
  ]
  return envelope('consultation', 'Brouillon de consultation', sections, allergyWarnings(data), data, generatedAt)
}

function buildPrescription(data: DraftData, generatedAt: string): StructuredDraft {
  const sections: DraftSection[] = [
    {
      key: 'safety',
      label: 'Sécurité',
      content: `Allergies : ${data.patient?.allergies?.trim() || 'aucune connue'}.\nTraitements en cours : ${data.activeMedications.length ? data.activeMedications.join(', ') : 'aucun'}.`,
      editable: false,
    },
    { key: 'indication', label: 'Indication', content: data.diagnosis || `[Indication — ${TODO}]`, editable: true },
    // Deliberately EMPTY — no medication is auto-selected. The clinician chooses
    // from the formulary in the prescription form.
    {
      key: 'medications',
      label: 'Médicaments',
      content: `[Médicament — posologie — durée] (à sélectionner dans le formulaire)\n${TODO}`,
      editable: true,
    },
  ]
  return envelope('prescription', 'Brouillon d’ordonnance', sections, allergyWarnings(data), data, generatedAt)
}

function buildFollowUp(data: DraftData, generatedAt: string): StructuredDraft {
  const sections: DraftSection[] = [
    { key: 'interval', label: 'Intervalle de suivi suggéré', content: `[À préciser par le clinicien, ex. dans 4 semaines]`, editable: true },
    {
      key: 'lab_follow_up',
      label: 'Suivi de laboratoire',
      content: data.pendingLabCount
        ? `${data.pendingLabCount} résultat(s) de laboratoire à revoir.`
        : 'Aucun résultat de laboratoire en attente.',
      editable: true,
    },
    {
      key: 'reminders',
      label: 'Rappels opérationnels',
      content: [
        data.activeMedications.length ? `Renouvellement éventuel : ${data.activeMedications.length} traitement(s) en cours.` : null,
        data.recentConsultationCount ? null : 'Première consultation — planifier un suivi initial.',
      ].filter(Boolean).join('\n') || TODO,
      editable: true,
    },
  ]
  return envelope('follow_up', 'Brouillon de suivi', sections, [], data, generatedAt)
}

function buildReferral(data: DraftData, generatedAt: string): StructuredDraft {
  const date = generatedAt.slice(0, 10)
  const letter =
    `${data.clinicName ?? '[Clinique]'}\n` +
    `Date : ${date}\n\n` +
    `Objet : Lettre de référencement\n\n` +
    `Concerne : ${data.patient?.fullName ?? '[Patient]'}` +
    `${data.patient?.patientNumber ? ` (${data.patient.patientNumber})` : ''}` +
    `${data.patient?.dateOfBirth ? `, né(e) le ${data.patient.dateOfBirth}` : ''}\n\n` +
    `Motif du référencement : ${TODO}\n\n` +
    `Résumé clinique : ${TODO}\n\n` +
    `Confraternellement,\nDr ${data.doctorName ?? '[Médecin]'}`
  return envelope('referral', 'Brouillon de lettre de référencement', [
    { key: 'letter', label: 'Lettre', content: letter, editable: true },
  ], [], data, generatedAt)
}

function buildCertificate(data: DraftData, generatedAt: string): StructuredDraft {
  const date = generatedAt.slice(0, 10)
  const body =
    `Je soussigné(e), Dr ${data.doctorName ?? '[Médecin]'}, certifie avoir examiné ` +
    `${data.patient?.fullName ?? '[Patient]'}` +
    `${data.patient?.patientNumber ? ` (${data.patient.patientNumber})` : ''}.\n\n` +
    `${TODO}\n\n` +
    `Certificat établi à la demande de l’intéressé(e) et remis en main propre pour faire valoir ce que de droit.\n\n` +
    `Fait à ${data.clinicName ?? '[Clinique]'}, le ${date}.\n\nDr ${data.doctorName ?? '[Médecin]'}`
  return envelope('certificate', 'Brouillon de certificat médical', [
    { key: 'certificate', label: 'Certificat', content: body, editable: true },
  ], [], data, generatedAt)
}

const BUILDERS: Record<DraftType, (data: DraftData, generatedAt: string) => StructuredDraft> = {
  consultation: buildConsultation,
  prescription: buildPrescription,
  follow_up: buildFollowUp,
  referral: buildReferral,
  certificate: buildCertificate,
}

export function buildDraft(type: DraftType, data: DraftData, generatedAt: string): StructuredDraft {
  return BUILDERS[type](data, generatedAt)
}

export const DRAFT_TYPES: DraftType[] = ['consultation', 'prescription', 'follow_up', 'referral', 'certificate']
