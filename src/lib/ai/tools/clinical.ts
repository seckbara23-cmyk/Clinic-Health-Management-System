import type { AITool, AIToolResult } from '../types'
import { latestDate } from './helpers'

// Today's appointments + how many are waiting. Mirrors useTodayQueue().
export const getTodayQueue: AITool = {
  id: 'get_today_queue',
  category: 'queue',
  roles: ['receptionist', 'doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "Today's appointments and who is waiting.",
  async run(db, ctx): Promise<AIToolResult> {
    const day = new Date().toISOString().slice(0, 10)
    const { data, error } = await db
      .from('appointments')
      .select('id, status, scheduled_at, patient:patients(full_name, patient_number)')
      .eq('clinic_id', ctx.clinicId)
      .gte('scheduled_at', `${day}T00:00:00`)
      .lte('scheduled_at', `${day}T23:59:59`)
      .order('scheduled_at', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = data ?? []
    const waiting = rows.filter((r: { status?: string | null }) => r.status === 'waiting').length
    return {
      toolId: 'get_today_queue',
      category: 'queue',
      dataCategory: 'queue',
      count: rows.length,
      rows,
      citation: { source: 'Queue', entity: 'appointments', date: day, detail: `${rows.length} today · clinic-scoped` },
      summaryLine: `${rows.length} appointment(s) today; ${waiting} waiting`,
      warnings: [],
    }
  },
}

// Lab orders not yet completed/reviewed.
export const getPendingLabOrders: AITool = {
  id: 'get_pending_lab_orders',
  category: 'lab',
  roles: ['doctor', 'nurse', 'lab_technician', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Lab orders awaiting collection, processing or results.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('lab_orders')
      .select('id, status, patient_name, created_at')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .in('status', ['ordered', 'sample_collected', 'in_progress'])
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_pending_lab_orders',
      category: 'lab',
      dataCategory: 'pending_lab_orders',
      count: rows.length,
      rows,
      citation: { source: 'Laboratory', entity: 'lab_orders', detail: `${rows.length} pending · clinic-scoped` },
      summaryLine: `${rows.length} pending lab order(s)`,
      warnings: [],
    }
  },
}

// Lab result items flagged critical.
export const getCriticalLabResults: AITool = {
  id: 'get_critical_lab_results',
  category: 'lab',
  roles: ['doctor', 'lab_technician', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Lab result items flagged critical.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('lab_order_items')
      .select('id, test_name, result_value, flag, lab_order:lab_orders(patient_name)')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .eq('flag', 'critical')
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_critical_lab_results',
      category: 'lab',
      dataCategory: 'critical_lab_results',
      count: rows.length,
      rows,
      citation: { source: 'Laboratory', entity: 'lab_order_items', detail: `${rows.length} critical · clinic-scoped` },
      summaryLine: `${rows.length} critical lab result(s)`,
      warnings: rows.length
        ? [{ level: 'critical', message: `${rows.length} critical lab result(s) need attention` }]
        : [],
    }
  },
}

// ── Per-patient history (requires patient context) ────────────────
// Three separate tools so a history summary cites consultations + prescriptions
// + labs independently and earns HIGH confidence when all three return data.
export const getPatientConsultations: AITool = {
  id: 'get_patient_consultations',
  category: 'patient',
  roles: ['doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: true,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "A patient's past consultations (dates/counts).",
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('consultations')
      .select('id, created_at')
      .eq('clinic_id', ctx.clinicId)
      .eq('patient_id', ctx.patientId!)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_patient_consultations',
      category: 'patient',
      dataCategory: 'consultations',
      count: rows.length,
      rows,
      citation: { source: 'Consultation', entity: 'consultations', date: latestDate(rows), detail: `${rows.length} record(s)` },
      summaryLine: `${rows.length} previous consultation(s)`,
      warnings: [],
    }
  },
}

export const getPatientPrescriptions: AITool = {
  id: 'get_patient_prescriptions',
  category: 'patient',
  roles: ['doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: true,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "A patient's prescriptions (dates/counts/status).",
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('prescriptions')
      .select('id, created_at, status')
      .eq('clinic_id', ctx.clinicId)
      .eq('patient_id', ctx.patientId!)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_patient_prescriptions',
      category: 'patient',
      dataCategory: 'prescriptions',
      count: rows.length,
      rows,
      citation: { source: 'Prescription', entity: 'prescriptions', date: latestDate(rows), detail: `${rows.length} record(s)` },
      summaryLine: `${rows.length} prescription(s) on record`,
      warnings: [],
    }
  },
}

export const getPatientLabResults: AITool = {
  id: 'get_patient_lab_results',
  category: 'patient',
  roles: ['doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: true,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "A patient's laboratory orders/results (dates/counts).",
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('lab_orders')
      .select('id, created_at, status')
      .eq('clinic_id', ctx.clinicId)
      .eq('patient_id', ctx.patientId!)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_patient_lab_results',
      category: 'patient',
      dataCategory: 'labs',
      count: rows.length,
      rows,
      citation: { source: 'Laboratory', entity: 'lab_orders', date: latestDate(rows), detail: `${rows.length} order(s)` },
      summaryLine: `${rows.length} laboratory order(s)`,
      warnings: [],
    }
  },
}
