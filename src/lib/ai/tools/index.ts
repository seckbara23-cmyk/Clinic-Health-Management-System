// ── AI tool registry + selection ──────────────────────────────────
//
// Phase 1: every tool is read-only (writesData === false). Selection is purely
// declarative — role membership + satisfied context requirements. RLS remains
// the backstop: even if selection were wrong, a tool's query returns only rows
// the user's session may see. super_admin appears in NO tool's roles, so the
// Copilot exposes zero data tools to super_admin (medical lockout, defense-in-depth).

import type { AITool, AIContext } from '../types'
import type { Role } from '@/types/database'
import { getLowStock, getNearExpiry } from './pharmacy'
import { getUnpaidInvoices } from './billing'
import { getClinicActivitySummary } from './analytics'
import {
  getTodayQueue,
  getPendingLabOrders,
  getCriticalLabResults,
  getPatientConsultations,
  getPatientPrescriptions,
  getPatientLabResults,
} from './clinical'

export const ALL_TOOLS: AITool[] = [
  getTodayQueue,
  getUnpaidInvoices,
  getLowStock,
  getNearExpiry,
  getPendingLabOrders,
  getCriticalLabResults,
  getPatientConsultations,
  getPatientPrescriptions,
  getPatientLabResults,
  getClinicActivitySummary,
]

export function getTool(id: string): AITool | undefined {
  return ALL_TOOLS.find((t) => t.id === id)
}

/** All tools a role is permitted to use (ignores context requirements). */
export function toolsForRole(role: Role): AITool[] {
  return ALL_TOOLS.filter((t) => t.roles.includes(role))
}

/**
 * Tools runnable for the given context right now: role-permitted AND with all
 * required entity context present (e.g. patient tools need ctx.patientId).
 */
export function selectToolsForContext(ctx: AIContext): AITool[] {
  return toolsForRole(ctx.role).filter((t) => {
    if (t.requiresPatientContext && !ctx.patientId) return false
    if (t.requiresAppointmentContext && !ctx.appointmentId) return false
    if (t.requiresConsultationContext && !ctx.consultationId) return false
    return true
  })
}
