// Phase 2 expansion tools — pharmacy / laboratory / billing / patient.
// All read-only, clinic-scoped, soft-delete-aware, role-gated, cited. The
// client is injected (RLS) — no Supabase client imported here. Nothing
// produces clinical judgment; patient follow-ups are operational reminders only.

import type { AITool, AIToolResult } from '../types'
import { latestDate } from './helpers'

// ── Pharmacy: most-dispensed medicines today ──────────────────────
export const getFrequentlyDispensedToday: AITool = {
  id: 'get_frequently_dispensed_today',
  category: 'pharmacy',
  roles: ['pharmacist', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Most-dispensed medicines today.',
  async run(db, ctx): Promise<AIToolResult> {
    const day = new Date().toISOString().slice(0, 10)
    const { data, error } = await db
      .from('medication_dispensings')
      .select('medication_name, quantity_dispensed')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .gte('dispensed_at', `${day}T00:00:00`)
      .lte('dispensed_at', `${day}T23:59:59`)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { medication_name: string; quantity_dispensed: number }[]
    const counts = new Map<string, number>()
    for (const r of rows) {
      counts.set(r.medication_name, (counts.get(r.medication_name) ?? 0) + (r.quantity_dispensed ?? 0))
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      toolId: 'get_frequently_dispensed_today',
      category: 'pharmacy',
      dataCategory: 'frequently_dispensed',
      count: top.length,
      rows: top.map(([name, qty]) => ({ name, qty })),
      citation: { source: 'Dispensations', entity: 'medication_dispensings', date: day, detail: `${rows.length} today` },
      summaryLine: top.length
        ? `Top: ${top.map(([n, q]) => `${n} (${q})`).join(', ')}`
        : 'No dispensing yet today',
      warnings: [],
    }
  },
}

// ── Laboratory: urgent/emergency orders still pending ─────────────
export const getUrgentLabOrders: AITool = {
  id: 'get_urgent_lab_orders',
  category: 'lab',
  roles: ['doctor', 'nurse', 'lab_technician', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Urgent/emergency lab orders not yet completed.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('lab_orders')
      .select('id, patient_name, priority, status')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .in('status', ['ordered', 'sample_collected', 'in_progress'])
      .in('priority', ['urgent', 'emergency'])
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_urgent_lab_orders',
      category: 'lab',
      dataCategory: 'urgent_lab_orders',
      count: rows.length,
      rows,
      citation: { source: 'Laboratory', entity: 'lab_orders', detail: `${rows.length} urgent · clinic-scoped` },
      summaryLine: `${rows.length} urgent lab order(s)`,
      warnings: rows.length ? [{ level: 'warning', message: `${rows.length} urgent lab order(s) pending` }] : [],
    }
  },
}

// ── Laboratory: completed but not yet reviewed ────────────────────
export const getUnreviewedLabResults: AITool = {
  id: 'get_unreviewed_lab_results',
  category: 'lab',
  roles: ['doctor', 'lab_technician', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Lab orders completed but awaiting review.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('lab_orders')
      .select('id, patient_name, created_at')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .eq('status', 'completed')
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_unreviewed_lab_results',
      category: 'lab',
      dataCategory: 'unreviewed_lab_results',
      count: rows.length,
      rows,
      citation: { source: 'Laboratory', entity: 'lab_orders', detail: `${rows.length} to review · clinic-scoped` },
      summaryLine: `${rows.length} completed result(s) awaiting review`,
      warnings: rows.length ? [{ level: 'info', message: `${rows.length} result(s) to review` }] : [],
    }
  },
}

// ── Billing: overdue balances ─────────────────────────────────────
export const getOverdueBalances: AITool = {
  id: 'get_overdue_balances',
  category: 'billing',
  roles: ['cashier', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Invoices marked overdue and the amount owing.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('invoices')
      .select('id, total_amount, amount_paid')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .eq('status', 'overdue')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { total_amount?: number | null; amount_paid?: number | null }[]
    const outstanding = rows.reduce((s, r) => s + ((r.total_amount ?? 0) - (r.amount_paid ?? 0)), 0)
    return {
      toolId: 'get_overdue_balances',
      category: 'billing',
      dataCategory: 'overdue_balances',
      count: rows.length,
      rows,
      citation: { source: 'Invoices', entity: 'invoices', detail: `${rows.length} overdue · clinic-scoped` },
      summaryLine: `${rows.length} overdue invoice(s); ${outstanding} XOF owing`,
      warnings: rows.length ? [{ level: 'warning', message: `${rows.length} overdue invoice(s)` }] : [],
    }
  },
}

// ── Billing: payer split / insurance summary (aggregate) ──────────
export const getPayerSplit: AITool = {
  id: 'get_payer_split',
  category: 'billing',
  roles: ['cashier', 'admin'],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Insurance vs patient share across invoices (aggregate).',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('invoices')
      .select('total_amount, insurance_share')
      .eq('clinic_id', ctx.clinicId)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial', 'paid', 'overdue'])
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { total_amount?: number | null; insurance_share?: number | null }[]
    const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0)
    const insurance = rows.reduce((s, r) => s + (r.insurance_share ?? 0), 0)
    const patient = total - insurance
    return {
      toolId: 'get_payer_split',
      category: 'billing',
      dataCategory: 'payer_split',
      count: rows.length,
      rows: [{ total, insurance, patient }],
      citation: { source: 'Invoices', entity: 'invoices', detail: 'aggregate · clinic-scoped' },
      summaryLine: `Insurance: ${insurance} XOF · Patient: ${patient} XOF (of ${total} XOF)`,
      warnings: [],
    }
  },
}

// ── Patient: outstanding balance (requires patient context) ───────
export const getPatientOutstanding: AITool = {
  id: 'get_patient_outstanding',
  category: 'patient',
  roles: ['doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: true,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "This patient's outstanding invoice balance.",
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await db
      .from('invoices')
      .select('id, total_amount, amount_paid, status')
      .eq('clinic_id', ctx.clinicId)
      .eq('patient_id', ctx.patientId!)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial', 'overdue'])
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { total_amount?: number | null; amount_paid?: number | null }[]
    const outstanding = rows.reduce((s, r) => s + ((r.total_amount ?? 0) - (r.amount_paid ?? 0)), 0)
    return {
      toolId: 'get_patient_outstanding',
      category: 'patient',
      dataCategory: 'outstanding_balance',
      count: rows.length,
      rows,
      citation: { source: 'Invoices', entity: 'invoices', detail: `${rows.length} unpaid` },
      summaryLine: `Outstanding balance: ${outstanding} XOF (${rows.length} invoice(s))`,
      warnings: outstanding > 0 ? [{ level: 'info', message: `${outstanding} XOF outstanding` }] : [],
    }
  },
}

// ── Patient: operational follow-up reminders (NOT clinical advice) ─
export const getPatientFollowups: AITool = {
  id: 'get_patient_followups',
  category: 'patient',
  roles: ['doctor', 'nurse', 'admin'],
  writesData: false,
  requiresPatientContext: true,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Operational follow-up reminders derived from records (no clinical advice).',
  async run(db, ctx): Promise<AIToolResult> {
    const [consults, unreviewed, activeRx] = await Promise.all([
      db.from('consultations').select('created_at').eq('clinic_id', ctx.clinicId).eq('patient_id', ctx.patientId!).is('deleted_at', null).order('created_at', { ascending: false }).limit(1),
      db.from('lab_orders').select('id').eq('clinic_id', ctx.clinicId).eq('patient_id', ctx.patientId!).is('deleted_at', null).eq('status', 'completed'),
      db.from('prescriptions').select('id').eq('clinic_id', ctx.clinicId).eq('patient_id', ctx.patientId!).is('deleted_at', null).eq('status', 'active'),
    ])
    if (consults.error) throw new Error(consults.error.message)
    if (unreviewed.error) throw new Error(unreviewed.error.message)
    if (activeRx.error) throw new Error(activeRx.error.message)

    const items: string[] = []
    const last = (consults.data ?? [])[0]?.created_at as string | undefined
    const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86_400_000 : Infinity
    if (daysSince > 180) items.push('No consultation in the last 6 months')
    const unrev = (unreviewed.data ?? []).length
    if (unrev > 0) items.push(`${unrev} completed lab result(s) awaiting review`)
    const rx = (activeRx.data ?? []).length
    if (rx > 0) items.push(`${rx} active prescription(s)`)

    return {
      toolId: 'get_patient_followups',
      category: 'patient',
      dataCategory: 'follow_ups',
      count: items.length,
      rows: items.map((message) => ({ message })),
      citation: { source: 'Patient record', entity: 'consultations', date: latestDate(consults.data ?? []), detail: 'operational' },
      summaryLine: items.length ? items.join(' · ') : 'No follow-up items',
      warnings: [],
    }
  },
}
