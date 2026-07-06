// ── Specialty Workspace Framework — types (Phase 14.1) ────────────
//
// Foundations only. These types describe the capability registries and the pure
// workspace resolver. NOTHING here renders, queries, or writes — the framework
// ships "empty" (only general_practice) and reproduces today's behaviour.
//
// The design mirrors the existing Settings registry (settings/registry.ts) and
// the AI tool registry: static capability definitions + a pure resolver.

import type { Role } from '@/types/database'

// ── Shared enums ───────────────────────────────────────────────────
export type NoteStyle = 'soap' | 'narrative' | 'structured' | 'voice_first'

/** Optional modules a clinic can enable; core modules (patients, appointments,
 *  billing, consultations) are always on and are NOT gated here. */
export type ModuleId =
  | 'lab' | 'pharmacy' | 'radiology' | 'vaccination' | 'growth'
  | 'pregnancy' | 'ecg' | 'procedures' | 'wound_photos' | 'nutrition'

export type WidgetSize = 'sm' | 'md' | 'lg'

// Full specialty space (Layer 2). Only general_practice is REGISTERED in 14.1;
// the rest are declared so future packs add a definition without a type change.
export type SpecialtyId =
  | 'general_practice' | 'internal_medicine' | 'family_medicine'
  | 'pediatrics' | 'obgyn' | 'emergency' | 'emergency_medicine' | 'general_surgery' | 'orthopedics'
  | 'cardiology' | 'dermatology' | 'ent' | 'ophthalmology' | 'psychiatry'
  | 'neurology' | 'oncology' | 'urology' | 'nephrology' | 'radiology_spec'
  | 'dentistry' | 'physiotherapy' | 'nutrition_spec' | 'mental_health'

export type SpecialtyCategory = 'primary_care' | 'medical' | 'surgical' | 'diagnostic' | 'support'

// ── Widget registry ────────────────────────────────────────────────
export interface WidgetDef {
  id: string
  labelKey: string
  icon: string
  size: WidgetSize
  roles: Role[]
  requiresModules?: ModuleId[]
  /** react-query key roots this widget reads — used later for dedup/lazy load. */
  dataDeps?: string[]
}
export interface WidgetRef {
  id: string
  /** Clinic-locked at the specialty level (user cannot hide it). */
  locked?: boolean
}

// ── Quick-action registry ──────────────────────────────────────────
export type QuickActionKind = 'navigate' | 'dialog' | 'template'
export interface QuickActionDef {
  id: string
  labelKey: string
  icon: string
  kind: QuickActionKind
  /** route for 'navigate', dialog id for 'dialog', template id for 'template'. */
  target: string
  roles: Role[]
  requiresModules?: ModuleId[]
}
export interface QuickActionRef { id: string }

// ── Template registry ──────────────────────────────────────────────
export type TemplateFieldType = 'text' | 'textarea' | 'date' | 'number' | 'select' | 'boolean'

/** Where a template field's value is persisted. Core narrative fields map to the
 *  EXISTING consultation columns (no schema change — the Phase 9 mapping);
 *  structured fields will map to clinical_entries (added in a later step). */
export type FieldTarget =
  | { store: 'consultation'; column: 'chief_complaint' | 'symptoms' | 'diagnosis' | 'treatment_plan' | 'notes' | 'follow_up_date' }
  | { store: 'clinical_entry'; kind: string }

export interface TemplateField {
  key: string
  type: TemplateFieldType
  labelKey: string
  target: FieldTarget
  required?: boolean
}
export interface TemplateSection {
  id: string
  labelKey: string
  fields: TemplateField[]
}
export interface ConsultationTemplate {
  id: string
  specialty: SpecialtyId
  noteStyle: NoteStyle
  sections: TemplateSection[]
}
export interface TemplateRef { id: string }

// ── Specialty definition (Layer 2) ─────────────────────────────────
export interface SpecialtyDefinition {
  id: SpecialtyId
  category: SpecialtyCategory
  labelKey: string
  icon: string
  roles: Role[]
  requiresModules: ModuleId[]
  defaultWidgets: WidgetRef[]
  quickActions: QuickActionRef[]
  consultationTemplates: TemplateRef[]
  /** clinical-entry kinds shown on the patient timeline for this specialty. */
  timelineEventTypes: string[]
  /** AITool ids feeding this specialty's operational briefing. */
  aiTools: string[]
  /** Capability negotiation — bump when the definition needs newer support. */
  schemaVersion: number
}

// ── Workspace resolution (the pure engine) ─────────────────────────
export interface ClinicWorkspaceConfig {
  enabledModules: ModuleId[]
  allowedSpecialties: SpecialtyId[]
  /** Widget ids the clinic mandates (users cannot hide). */
  lockedWidgets: string[]
  hospitalMode: boolean
}
export interface UserWorkspacePrefs {
  widgetOrder: string[]
  hiddenWidgets: string[]
  favoriteActions: string[]
  noteStyle: NoteStyle
}
export interface WorkspaceContext {
  role: Role
  specialty: SpecialtyId
  clinic: ClinicWorkspaceConfig
  prefs?: Partial<UserWorkspacePrefs>
}

export interface ResolvedWidget { id: string; def: WidgetDef; locked: boolean }
export interface ResolvedAction { id: string; def: QuickActionDef }

export interface WorkspaceSpec {
  specialty: SpecialtyId
  dashboardWidgets: ResolvedWidget[]
  quickActions: ResolvedAction[]
  consultationTemplate: ConsultationTemplate | null
  timelineEventTypes: string[]
  aiBriefingTools: string[]
}
