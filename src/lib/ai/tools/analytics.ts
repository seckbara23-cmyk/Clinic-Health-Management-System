import type { AITool, AIToolResult } from '../types'

// Aggregate clinic activity via the existing get_clinic_analytics RPC (admin).
// The RPC is clinic-scoped and returns aggregates only — no patient rows.
export const getClinicActivitySummary: AITool = {
  id: 'get_clinic_activity_summary',
  category: 'analytics',
  roles: ['admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "Aggregate summary of the clinic's recent activity.",
  async run(db): Promise<AIToolResult> {
    // get_clinic_analytics is not in the generated database.types.ts (same
    // pattern as useAnalytics); the RPC is clinic-scoped and aggregate-only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any).rpc('get_clinic_analytics', { p_months: 1 })
    if (error) throw new Error(error.message)
    const k = ((data ?? {}) as { kpis?: Record<string, number> }).kpis ?? {}
    const appts = k.totalAppointments ?? 0
    const patients = k.newPatients ?? 0
    const revenue = k.totalRevenue ?? 0
    return {
      toolId: 'get_clinic_activity_summary',
      category: 'analytics',
      dataCategory: 'activity_summary',
      count: 1,
      rows: [data ?? {}],
      citation: { source: 'Analytics', entity: 'get_clinic_analytics', detail: 'aggregate · clinic-scoped' },
      summaryLine: `Last 30 days: ${appts} appointment(s), ${patients} new patient(s), ${revenue} XOF revenue`,
      warnings: [],
    }
  },
}
