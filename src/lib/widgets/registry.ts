// ── Widget registry (shared, generic) ─────────────────────────────
//
// Widgets are owned by the platform, registered once, and REFERENCED by
// specialties. They are role- and module-gated. Phase 14.1 defines the generic
// set only; specialty-specific widgets (growth chart, etc.) are added by their
// packs. Nothing renders yet — these are capability descriptors.

import type { WidgetDef } from '@/lib/workspace/types'

const CLINICAL: WidgetDef['roles'] = ['super_admin', 'admin', 'doctor', 'nurse']

export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'ai_brief',       labelKey: 'widget_ai_brief',       icon: 'Sparkles',     size: 'lg', roles: [...CLINICAL, 'receptionist', 'cashier', 'lab_technician', 'pharmacist'], dataDeps: ['ai-insights'] },
  { id: 'kpis',           labelKey: 'widget_kpis',           icon: 'BarChart2',    size: 'lg', roles: [...CLINICAL, 'receptionist', 'cashier'], dataDeps: ['dashboard-stats'] },
  { id: 'today_queue',    labelKey: 'widget_today_queue',    icon: 'ClipboardList', size: 'md', roles: [...CLINICAL, 'receptionist'], dataDeps: ['appointments'] },
  { id: 'quick_actions',  labelKey: 'widget_quick_actions',  icon: 'Zap',          size: 'md', roles: [...CLINICAL, 'receptionist', 'cashier'] },
  { id: 'appointments',   labelKey: 'widget_appointments',   icon: 'CalendarDays', size: 'md', roles: [...CLINICAL, 'receptionist'], dataDeps: ['appointments'] },
  { id: 'follow_ups',     labelKey: 'widget_follow_ups',     icon: 'CalendarClock', size: 'sm', roles: CLINICAL, dataDeps: ['consultations'] },
  { id: 'lab_results',    labelKey: 'widget_lab_results',    icon: 'FlaskConical', size: 'md', roles: [...CLINICAL, 'lab_technician'], requiresModules: ['lab'], dataDeps: ['lab_orders'] },
  { id: 'critical_alerts',labelKey: 'widget_critical_alerts',icon: 'AlertOctagon', size: 'sm', roles: CLINICAL, dataDeps: ['lab_orders'] },
  { id: 'revenue',        labelKey: 'widget_revenue',        icon: 'TrendingUp',   size: 'sm', roles: ['super_admin', 'admin', 'cashier', 'doctor'], dataDeps: ['dashboard-stats'] },
  { id: 'radiology',      labelKey: 'widget_radiology',      icon: 'ScanLine',     size: 'md', roles: CLINICAL, requiresModules: ['radiology'], dataDeps: ['clinical_documents'] },
]

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find(w => w.id === id)
}
