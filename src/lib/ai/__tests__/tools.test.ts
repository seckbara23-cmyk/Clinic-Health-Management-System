import { ALL_TOOLS, toolsForRole, selectToolsForContext, getTool } from '../tools'
import type { AIContext } from '../types'

describe('tool registry & selection', () => {
  it('every Phase 1 tool is read-only', () => {
    for (const t of ALL_TOOLS) expect(t.writesData).toBe(false)
  })

  it('tool ids are unique', () => {
    const ids = ALL_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('super_admin gets ZERO tools (medical lockout, defense-in-depth)', () => {
    expect(toolsForRole('super_admin')).toEqual([])
  })

  it('pharmacist is limited to pharmacy tools', () => {
    expect(toolsForRole('pharmacist').map((t) => t.id).sort()).toEqual([
      'get_frequently_dispensed_today',
      'get_low_stock',
      'get_near_expiry',
    ])
  })

  it('cashier is limited to billing tools', () => {
    expect(toolsForRole('cashier').map((t) => t.id).sort()).toEqual([
      'get_overdue_balances',
      'get_payer_split',
      'get_unpaid_invoices',
    ])
  })

  it('all pharmacy/lab/billing tools stay read-only and role-scoped (no super_admin)', () => {
    for (const id of [
      'get_frequently_dispensed_today', 'get_urgent_lab_orders', 'get_unreviewed_lab_results',
      'get_overdue_balances', 'get_payer_split', 'get_patient_outstanding', 'get_patient_followups',
    ]) {
      const tool = getTool(id)
      expect(tool?.writesData).toBe(false)
      expect(tool?.roles).not.toContain('super_admin')
    }
  })

  it('lab_technician cannot access patient-history tools', () => {
    const ids = toolsForRole('lab_technician').map((t) => t.id)
    expect(ids).not.toContain('get_patient_consultations')
    expect(ids).not.toContain('get_patient_prescriptions')
    expect(ids).toContain('get_pending_lab_orders')
  })

  it('pharmacist cannot access queue/lab/patient/billing tools', () => {
    const ids = toolsForRole('pharmacist').map((t) => t.id)
    for (const forbidden of [
      'get_today_queue',
      'get_pending_lab_orders',
      'get_patient_consultations',
      'get_unpaid_invoices',
    ]) {
      expect(ids).not.toContain(forbidden)
    }
  })

  it('drops patient tools when patient context is absent', () => {
    const ctx: AIContext = { role: 'doctor', clinicId: 'c1', userId: 'u1' }
    const ids = selectToolsForContext(ctx).map((t) => t.id)
    expect(ids).not.toContain('get_patient_consultations')
  })

  it('includes patient tools when patientId is present', () => {
    const ctx: AIContext = { role: 'doctor', clinicId: 'c1', userId: 'u1', patientId: 'p1' }
    const ids = selectToolsForContext(ctx).map((t) => t.id)
    expect(ids).toContain('get_patient_consultations')
    expect(ids).toContain('get_patient_prescriptions')
    expect(ids).toContain('get_patient_lab_results')
  })

  it('getTool resolves by id', () => {
    expect(getTool('get_low_stock')?.category).toBe('pharmacy')
    expect(getTool('nope')).toBeUndefined()
  })
})
