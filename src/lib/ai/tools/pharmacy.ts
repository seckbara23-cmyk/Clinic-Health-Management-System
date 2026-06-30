import type { AITool, AIToolResult } from '../types'

// Mirrors useLowStock(): column-vs-column (stock <= reorder) isn't expressible
// in PostgREST, so we filter in JS. Read-only, clinic-scoped, RLS-enforced.
export const getLowStock: AITool = {
  id: 'get_low_stock',
  category: 'pharmacy',
  roles: ['pharmacist', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Medicines at or below their reorder level.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('clinic_medication_inventory')
      .select('id, stock_quantity, reorder_level, medication:medications(name, strength)')
      .eq('clinic_id', ctx.clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
    if (error) throw new Error(error.message)
    const rows = (data ?? []).filter(
      (r: { stock_quantity: number; reorder_level: number }) => r.stock_quantity <= r.reorder_level,
    )
    return {
      toolId: 'get_low_stock',
      category: 'pharmacy',
      dataCategory: 'low_stock',
      count: rows.length,
      rows,
      citation: {
        source: 'Pharmacy inventory',
        entity: 'clinic_medication_inventory',
        detail: `${rows.length} row(s) · clinic-scoped`,
      },
      summaryLine: `${rows.length} medicine(s) at or below reorder level`,
      warnings: rows.length
        ? [{ level: 'warning', message: `${rows.length} medicine(s) low on stock` }]
        : [],
    }
  },
}

// Mirrors useNearExpiry(): batches with remaining stock expiring within `days`.
export const getNearExpiry: AITool = {
  id: 'get_near_expiry',
  category: 'pharmacy',
  roles: ['pharmacist', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Medication batches with stock expiring soon.',
  async run(db, ctx): Promise<AIToolResult> {
    const cutoff = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await db
      .from('medication_batches')
      .select('id, expiry_date, quantity_remaining, inventory:clinic_medication_inventory(medication:medications(name))')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .gt('quantity_remaining', 0)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', cutoff)
      .order('expiry_date', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_near_expiry',
      category: 'pharmacy',
      dataCategory: 'near_expiry',
      count: rows.length,
      rows,
      citation: {
        source: 'Medication batches',
        entity: 'medication_batches',
        detail: `${rows.length} batch(es) ≤ 90 days · clinic-scoped`,
      },
      summaryLine: `${rows.length} batch(es) expiring within 90 days`,
      warnings: rows.length
        ? [{ level: 'warning', message: `${rows.length} batch(es) near expiry` }]
        : [],
    }
  },
}
