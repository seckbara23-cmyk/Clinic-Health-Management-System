// ── Administration Hub — modular settings registry ────────────────
//
// The registry is the architectural core of Phase 12: every configurable area
// is a self-contained SettingsSection with typed fields. Future modules register
// a section here instead of adding to a giant settings file. The hub renders and
// persists sections generically — it knows nothing about any specific setting.
//
// Pure data + types. No React, no DB, no diagnosis. Values persist to the
// additive `clinic_settings` store (migration 036); the 'clinic'/'profile'/'link'
// sections reuse existing behaviour and are handled specially by the hub.

export type SettingsCategory =
  | 'clinic' | 'organization' | 'clinical' | 'pharmacy' | 'laboratory'
  | 'billing' | 'communication' | 'ai' | 'users' | 'security' | 'audit'

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'color'
export type SettingValue = string | number | boolean
export type SectionValues = Record<string, SettingValue>

export interface SettingsField {
  key: string
  type: FieldType
  labelKey: string
  default: SettingValue
  options?: { value: string; labelKey: string }[]
  min?: number
  max?: number
  helpKey?: string
}

export interface SettingsSection {
  id: string
  category: SettingsCategory
  titleKey: string
  descKey?: string
  /** lucide icon name, resolved in the hub component. */
  icon: string
  /** Persisted, editable fields (empty for link/special sections). */
  fields: SettingsField[]
  /** Extra keywords for global search. */
  searchTerms: string[]
  /** How the hub handles this section:
   *  - 'settings' generic registry-driven form persisted to clinic_settings
   *  - 'native'   bespoke form writing to an existing table (no regression)
   *  - 'link'     opens an existing route
   *  - 'audit'    read-only history / compliance surface */
  kind: 'settings' | 'native' | 'link' | 'audit'
  /** For kind 'link': the route to open. */
  href?: string
  /** Roles allowed to VIEW this section. Omitted → all authenticated roles. */
  viewRoles?: string[]
}

const ADMINS = ['admin', 'super_admin']

// ── Sections ───────────────────────────────────────────────────────
export const SETTINGS_SECTIONS: SettingsSection[] = [
  // Native sections reuse existing, working forms (no regression).
  {
    id: 'profile', category: 'clinic', titleKey: 'sec_profile_title', descKey: 'sec_profile_desc',
    icon: 'User', kind: 'native', fields: [], searchTerms: ['profile', 'account', 'me', 'profil', 'compte', 'name', 'phone'],
  },
  {
    // Phase 14.2.2 — the professional's own identity (professional_profiles).
    // Visible to every authenticated role; each user edits only their own row (RLS).
    id: 'professional_identity', category: 'clinic', titleKey: 'sec_prof_identity_title', descKey: 'sec_prof_identity_desc',
    icon: 'IdCard', kind: 'native', fields: [],
    searchTerms: ['profession', 'credentials', 'license', 'signature', 'department', 'position', 'languages', 'identity', 'diplome', 'licence', 'credentials', 'profil professionnel', 'medecin', 'infirmier'],
  },
  {
    // Phase 14.2.6 — READ-ONLY preview of the resolved workspace (widgets +
    // quick actions). Foundation only: general_practice today, no editing.
    id: 'my_workspace', category: 'clinic', titleKey: 'sec_my_workspace_title', descKey: 'sec_my_workspace_desc',
    icon: 'LayoutGrid', kind: 'native', fields: [],
    searchTerms: ['workspace', 'widgets', 'dashboard', 'preview', 'espace de travail', 'tableau de bord'],
  },
  {
    id: 'clinic_identity', category: 'clinic', titleKey: 'sec_identity_title', descKey: 'sec_identity_desc',
    icon: 'Building2', kind: 'native', viewRoles: ADMINS, fields: [],
    searchTerms: ['clinic', 'identity', 'name', 'address', 'ninea', 'rc', 'phone', 'email', 'clinique', 'identite', 'adresse'],
  },
  {
    id: 'sms', category: 'communication', titleKey: 'sec_sms_title', descKey: 'sec_sms_desc',
    icon: 'MessageSquare', kind: 'native', viewRoles: ADMINS, fields: [],
    searchTerms: ['sms', 'reminder', 'sender', 'appointment', 'rappel', 'expediteur', 'rendez-vous'],
  },
  {
    id: 'clinic_profile', category: 'clinic', titleKey: 'sec_clinic_title', descKey: 'sec_clinic_desc',
    icon: 'Building2', kind: 'settings', searchTerms: ['clinic', 'name', 'address', 'ninea', 'rc', 'timezone', 'currency', 'clinique', 'adresse'],
    fields: [
      { key: 'timezone', type: 'select', labelKey: 'f_timezone', default: 'Africa/Dakar', options: [
        { value: 'Africa/Dakar', labelKey: 'tz_dakar' }, { value: 'Africa/Abidjan', labelKey: 'tz_abidjan' }, { value: 'UTC', labelKey: 'tz_utc' },
      ] },
      { key: 'language', type: 'select', labelKey: 'f_language', default: 'fr', options: [
        { value: 'fr', labelKey: 'lang_fr' }, { value: 'en', labelKey: 'lang_en' },
      ] },
      { key: 'currency', type: 'select', labelKey: 'f_currency', default: 'XOF', options: [
        { value: 'XOF', labelKey: 'cur_xof' }, { value: 'EUR', labelKey: 'cur_eur' }, { value: 'USD', labelKey: 'cur_usd' },
      ] },
      { key: 'website', type: 'text', labelKey: 'f_website', default: '' },
      { key: 'description', type: 'textarea', labelKey: 'f_description', default: '' },
    ],
  },
  {
    id: 'branding', category: 'clinic', titleKey: 'sec_branding_title', descKey: 'sec_branding_desc',
    icon: 'Palette', kind: 'settings', searchTerms: ['branding', 'logo', 'color', 'couleur', 'theme', 'pdf', 'receipt', 'signature'],
    fields: [
      { key: 'primary_color', type: 'color', labelKey: 'f_primary_color', default: '#0d9488' },
      { key: 'accent_color', type: 'color', labelKey: 'f_accent_color', default: '#0891b2' },
      { key: 'pdf_header', type: 'text', labelKey: 'f_pdf_header', default: '' },
      { key: 'receipt_footer', type: 'textarea', labelKey: 'f_receipt_footer', default: '' },
      { key: 'email_signature', type: 'textarea', labelKey: 'f_email_signature', default: '' },
    ],
  },
  {
    id: 'working_hours', category: 'organization', titleKey: 'sec_hours_title', descKey: 'sec_hours_desc',
    icon: 'Clock', kind: 'settings', searchTerms: ['hours', 'opening', 'closing', 'lunch', 'weekend', 'slot', 'buffer', 'horaires', 'ouverture'],
    fields: [
      { key: 'open_time', type: 'text', labelKey: 'f_open_time', default: '08:00' },
      { key: 'close_time', type: 'text', labelKey: 'f_close_time', default: '18:00' },
      { key: 'lunch_start', type: 'text', labelKey: 'f_lunch_start', default: '13:00' },
      { key: 'lunch_end', type: 'text', labelKey: 'f_lunch_end', default: '14:00' },
      { key: 'weekend_open', type: 'boolean', labelKey: 'f_weekend_open', default: false },
      { key: 'slot_minutes', type: 'number', labelKey: 'f_slot_minutes', default: 30, min: 5, max: 240 },
      { key: 'buffer_minutes', type: 'number', labelKey: 'f_buffer_minutes', default: 0, min: 0, max: 120 },
    ],
  },
  {
    id: 'consultation', category: 'clinical', titleKey: 'sec_consult_title', descKey: 'sec_consult_desc',
    icon: 'Stethoscope', kind: 'settings', searchTerms: ['consultation', 'soap', 'diagnosis', 'follow-up', 'duration', 'suivi', 'diagnostic'],
    fields: [
      { key: 'default_duration', type: 'number', labelKey: 'f_default_duration', default: 20, min: 5, max: 180 },
      { key: 'require_diagnosis', type: 'boolean', labelKey: 'f_require_diagnosis', default: false },
      { key: 'require_chief_complaint', type: 'boolean', labelKey: 'f_require_chief_complaint', default: true },
      { key: 'followup_default_days', type: 'number', labelKey: 'f_followup_days', default: 7, min: 0, max: 365 },
    ],
  },
  {
    id: 'pharmacy', category: 'pharmacy', titleKey: 'sec_pharmacy_title', descKey: 'sec_pharmacy_desc',
    icon: 'Pill', kind: 'settings', searchTerms: ['pharmacy', 'stock', 'expiry', 'fefo', 'barcode', 'shelf', 'dispensing', 'pharmacie', 'peremption'],
    fields: [
      { key: 'low_stock_threshold', type: 'number', labelKey: 'f_low_stock', default: 10, min: 0, max: 10000 },
      { key: 'expiry_warning_days', type: 'number', labelKey: 'f_expiry_days', default: 90, min: 1, max: 3650 },
      { key: 'fefo_enabled', type: 'boolean', labelKey: 'f_fefo', default: true },
      { key: 'barcode_verification_required', type: 'boolean', labelKey: 'f_barcode_required', default: false },
      { key: 'shelf_location_format', type: 'text', labelKey: 'f_shelf_format', default: 'A-0-0-0' },
    ],
  },
  {
    id: 'laboratory', category: 'laboratory', titleKey: 'sec_lab_title', descKey: 'sec_lab_desc',
    icon: 'FlaskConical', kind: 'settings', searchTerms: ['lab', 'laboratory', 'sample', 'critical', 'barcode', 'reference', 'approval', 'laboratoire', 'echantillon'],
    fields: [
      { key: 'critical_color', type: 'color', labelKey: 'f_critical_color', default: '#dc2626' },
      { key: 'sample_id_format', type: 'text', labelKey: 'f_sample_format', default: 'S-{YYYY}-{SEQ}' },
      { key: 'result_approval_required', type: 'boolean', labelKey: 'f_approval_required', default: true },
      { key: 'report_footer', type: 'textarea', labelKey: 'f_report_footer', default: '' },
    ],
  },
  {
    id: 'billing', category: 'billing', titleKey: 'sec_billing_title', descKey: 'sec_billing_desc',
    icon: 'Receipt', kind: 'settings', searchTerms: ['billing', 'invoice', 'tax', 'currency', 'payment', 'insurance', 'mutuelle', 'facturation', 'taxe'],
    fields: [
      { key: 'invoice_prefix', type: 'text', labelKey: 'f_invoice_prefix', default: 'INV-' },
      { key: 'tax_percent', type: 'number', labelKey: 'f_tax_percent', default: 0, min: 0, max: 100 },
      { key: 'insurance_default_coverage', type: 'number', labelKey: 'f_default_coverage', default: 80, min: 0, max: 100 },
      { key: 'accept_cash', type: 'boolean', labelKey: 'f_accept_cash', default: true },
      { key: 'accept_mobile_money', type: 'boolean', labelKey: 'f_accept_mobile', default: true },
      { key: 'accept_insurance', type: 'boolean', labelKey: 'f_accept_insurance', default: true },
    ],
  },
  {
    id: 'communication', category: 'communication', titleKey: 'sec_comm_title', descKey: 'sec_comm_desc',
    icon: 'MessageSquare', kind: 'settings', searchTerms: ['email', 'whatsapp', 'reminder', 'notification', 'timing', 'notification', 'communication'],
    fields: [
      { key: 'email_enabled', type: 'boolean', labelKey: 'f_email_enabled', default: false },
      { key: 'whatsapp_enabled', type: 'boolean', labelKey: 'f_whatsapp_enabled', default: false },
      { key: 'reminder_hours_before', type: 'number', labelKey: 'f_reminder_hours', default: 24, min: 1, max: 168 },
      { key: 'notification_sender', type: 'text', labelKey: 'f_notif_sender', default: '' },
    ],
  },
  {
    id: 'ai', category: 'ai', titleKey: 'sec_ai_title', descKey: 'sec_ai_desc',
    icon: 'Sparkles', kind: 'settings', searchTerms: ['ai', 'intelligence', 'briefing', 'copilot', 'confidence', 'safety', 'ia'],
    fields: [
      { key: 'ai_enabled', type: 'boolean', labelKey: 'f_ai_enabled', default: true },
      { key: 'executive_briefings', type: 'boolean', labelKey: 'f_exec_briefings', default: true },
      { key: 'patient_intelligence', type: 'boolean', labelKey: 'f_patient_intel', default: true },
      { key: 'consultation_intelligence', type: 'boolean', labelKey: 'f_consult_intel', default: true },
      { key: 'medication_safety', type: 'boolean', labelKey: 'f_med_safety', default: true },
      { key: 'lab_intelligence', type: 'boolean', labelKey: 'f_lab_intel', default: true },
      { key: 'confidence_badges', type: 'boolean', labelKey: 'f_confidence_badges', default: true },
      { key: 'operational_reminders', type: 'boolean', labelKey: 'f_operational_reminders', default: true },
    ],
  },
  {
    id: 'users', category: 'users', titleKey: 'sec_users_title', descKey: 'sec_users_desc',
    icon: 'ShieldCheck', kind: 'link', href: '/admin/users', viewRoles: ADMINS, searchTerms: ['users', 'roles', 'invitations', 'permissions', 'utilisateurs', 'roles', 'invitations'], fields: [],
  },
  {
    id: 'audit', category: 'audit', titleKey: 'sec_audit_title', descKey: 'sec_audit_desc',
    icon: 'History', kind: 'audit', viewRoles: ADMINS, searchTerms: ['audit', 'compliance', 'consent', 'retention', 'privacy', 'logs', 'conformite', 'consentement'], fields: [],
  },
  {
    id: 'export', category: 'audit', titleKey: 'sec_export_title', descKey: 'sec_export_desc',
    icon: 'Download', kind: 'native', viewRoles: ['admin'], fields: [],
    searchTerms: ['export', 'data', 'download', 'cdp', 'donnees', 'gdpr'],
  },
]

/** Default values for a section (used before anything is saved). */
export function sectionDefaults(section: SettingsSection): SectionValues {
  const out: SectionValues = {}
  for (const f of section.fields) out[f.key] = f.default
  return out
}

export function getSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find(s => s.id === id)
}

export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = [
  'clinic', 'organization', 'clinical', 'pharmacy', 'laboratory',
  'billing', 'communication', 'ai', 'users', 'security', 'audit',
]
