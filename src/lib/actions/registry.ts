// ── Quick-action registry (shared, generic) ───────────────────────
//
// Actions are reusable, role/module-gated capability descriptors referenced by
// specialties. Phase 14.1 registers the general clinical set that mirrors the
// existing in-workspace actions (Phase 9/10). Specialty-specific actions
// (Vaccination, ANC Visit…) are added by their packs. Nothing is wired yet.

import type { QuickActionDef } from '@/lib/workspace/types'

const CLINICAL: QuickActionDef['roles'] = ['super_admin', 'admin', 'doctor', 'nurse']

export const QUICK_ACTION_REGISTRY: QuickActionDef[] = [
  { id: 'new_consultation',    labelKey: 'action_new_consultation',   icon: 'Stethoscope', kind: 'navigate', target: '/consultations',           roles: CLINICAL },
  { id: 'new_prescription',    labelKey: 'action_new_prescription',   icon: 'Pill',        kind: 'dialog',   target: 'prescription',              roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
  { id: 'order_lab',           labelKey: 'action_order_lab',          icon: 'FlaskConical', kind: 'dialog',  target: 'lab_order',                 roles: CLINICAL, requiresModules: ['lab'] },
  { id: 'schedule_appointment',labelKey: 'action_schedule_appointment',icon: 'CalendarPlus',kind: 'dialog',  target: 'appointment',               roles: [...CLINICAL, 'receptionist'] },
  { id: 'new_invoice',         labelKey: 'action_new_invoice',        icon: 'Receipt',     kind: 'dialog',   target: 'invoice',                   roles: ['super_admin', 'admin', 'doctor', 'cashier', 'receptionist'] },
  { id: 'dispense',            labelKey: 'action_dispense',           icon: 'PackageCheck', kind: 'navigate', target: '/pharmacy',                roles: ['super_admin', 'admin', 'pharmacist'], requiresModules: ['pharmacy'] },
]

export function getAction(id: string): QuickActionDef | undefined {
  return QUICK_ACTION_REGISTRY.find(a => a.id === id)
}
