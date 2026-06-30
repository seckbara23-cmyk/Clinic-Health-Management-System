import type { AITool, AIToolResult } from '../types'

// Unpaid = invoices still owing (sent / partial / overdue). Read-only,
// clinic-scoped, soft-deleted excluded. RLS limits this to billing-capable roles.
export const getUnpaidInvoices: AITool = {
  id: 'get_unpaid_invoices',
  category: 'billing',
  roles: ['cashier', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Invoices with an outstanding balance.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('invoices')
      .select('id, status, total_amount, amount_paid, patient:patients(full_name, patient_number)')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial', 'overdue'])
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const rows = data ?? []
    const outstanding = rows.reduce(
      (sum: number, r: { total_amount?: number | null; amount_paid?: number | null }) =>
        sum + ((r.total_amount ?? 0) - (r.amount_paid ?? 0)),
      0,
    )
    return {
      toolId: 'get_unpaid_invoices',
      category: 'billing',
      dataCategory: 'unpaid_invoices',
      count: rows.length,
      rows,
      citation: {
        source: 'Invoices',
        entity: 'invoices',
        detail: `${rows.length} unpaid · clinic-scoped`,
      },
      summaryLine: `${rows.length} unpaid invoice(s); ${outstanding} XOF outstanding`,
      warnings: [],
    }
  },
}
