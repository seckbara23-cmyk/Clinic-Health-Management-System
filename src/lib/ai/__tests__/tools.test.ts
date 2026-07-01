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

  it('queue & appointment tools are read-only, categorised, and exclude super_admin', () => {
    const queueIds = ['get_waiting_time_summary', 'get_long_waiting_patients', 'get_called_not_seen']
    const apptIds = [
      'get_late_arrivals', 'get_no_show_risks', 'get_tomorrow_appointment_prep',
      'get_doctor_workload_summary', 'get_overbooked_slots',
    ]
    for (const id of [...queueIds, ...apptIds]) {
      const tool = getTool(id)
      expect(tool).toBeDefined()
      expect(tool!.writesData).toBe(false)
      expect(tool!.roles).not.toContain('super_admin')
    }
    for (const id of queueIds) expect(getTool(id)!.category).toBe('queue')
    for (const id of apptIds) expect(getTool(id)!.category).toBe('appointments')
  })

  it('scheduling tools go to front-desk/clinical roles, not pharmacy/lab/cashier', () => {
    const recIds = toolsForRole('receptionist').map((t) => t.id)
    expect(recIds).toContain('get_waiting_time_summary')
    expect(recIds).toContain('get_no_show_risks')
    for (const role of ['pharmacist', 'cashier', 'lab_technician'] as const) {
      const ids = toolsForRole(role).map((t) => t.id)
      expect(ids).not.toContain('get_waiting_time_summary')
      expect(ids).not.toContain('get_overbooked_slots')
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
