// ── Specialty: General Practice (the baseline / default) ──────────
//
// This definition reproduces TODAY's doctor workspace. Any user without a
// configured specialty resolves to this, guaranteeing zero behaviour change
// while the framework ships "empty". Every other specialty is an additive pack
// layered on this shape.

import type { SpecialtyDefinition } from '@/lib/workspace/types'

export const generalPractice: SpecialtyDefinition = {
  id: 'general_practice',
  category: 'primary_care',
  labelKey: 'specialty_general_practice',
  icon: 'Stethoscope',
  roles: ['doctor', 'nurse', 'admin'],
  requiresModules: [],
  // Today's dashboard: executive briefing + KPIs + today's queue + quick actions.
  defaultWidgets: [
    { id: 'ai_brief' },
    { id: 'kpis' },
    { id: 'today_queue' },
    { id: 'quick_actions' },
  ],
  // Today's in-workspace clinical actions (Phase 9/10), minus pharmacy dispense.
  quickActions: [
    { id: 'new_consultation' },
    { id: 'new_prescription' },
    { id: 'order_lab' },
    { id: 'schedule_appointment' },
    { id: 'new_invoice' },
  ],
  consultationTemplates: [{ id: 'gp_consultation' }],
  // Today's patient timeline sources (Phase 10 mergePatientTimeline).
  timelineEventTypes: ['consultation', 'appointment', 'prescription', 'lab', 'invoice', 'dispensing'],
  // Existing operational AI tools that feed the general dashboard briefing.
  aiTools: [
    'get_today_queue',
    'get_long_waiting_patients',
    'get_pending_lab_orders',
    'get_critical_lab_results',
    'get_unpaid_invoices',
  ],
  schemaVersion: 1,
}
