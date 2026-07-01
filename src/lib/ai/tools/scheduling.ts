// Layer 2C — queue & appointment intelligence tools.
// All read-only, clinic-scoped, role-gated, cited. Client injected (RLS) — no
// Supabase client imported here. No clinical judgment, no writes.

import type { AITool, AIToolResult, RlsClient } from '../types'

// The generated database.types.ts is stale for some appointment columns
// (arrived_at / called_at were added in migration 011) and for the doctor FK
// hint, so use an untyped table handle for appointments — the same approach the
// rest of the app uses for such columns. RLS is unaffected: this is still the
// caller's injected, RLS-scoped client; only the compile-time types are relaxed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tbl(db: RlsClient, name: string): any {
  return (db as unknown as { from: (t: string) => unknown }).from(name)
}

const SCHEDULING_ROLES = ['receptionist', 'doctor', 'nurse', 'admin'] as const
// Statuses that mean "arrived and waiting" (incl. the legacy value).
const WAITING_STATUSES = ['waiting', 'in_queue']

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}
function minutesSince(ts: string | null | undefined): number | null {
  if (!ts) return null
  return Math.round((Date.now() - new Date(ts).getTime()) / 60_000)
}

// ── Queue: average waiting time (today) ───────────────────────────
export const getWaitingTimeSummary: AITool = {
  id: 'get_waiting_time_summary',
  category: 'queue',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Average current waiting time for patients in the queue today.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('id, arrived_at, status')
      .eq('clinic_id', ctx.clinicId)
      .in('status', [...WAITING_STATUSES, 'called'])
      .gte('arrived_at', `${today()}T00:00:00`)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { arrived_at: string | null }[]
    const waits = rows.map((r) => minutesSince(r.arrived_at)).filter((m): m is number => m !== null)
    const avg = waits.length ? Math.round(waits.reduce((s, m) => s + m, 0) / waits.length) : 0
    return {
      toolId: 'get_waiting_time_summary',
      category: 'queue',
      dataCategory: 'waiting_time',
      count: waits.length,
      rows,
      citation: { source: 'Queue', entity: 'appointments', date: today(), detail: `${waits.length} waiting · clinic-scoped` },
      summaryLine: `Average wait: ${avg} min across ${waits.length} patient(s)`,
      warnings: [],
    }
  },
}

// ── Queue: patients waiting more than 30 minutes ──────────────────
export const getLongWaitingPatients: AITool = {
  id: 'get_long_waiting_patients',
  category: 'queue',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Patients who have been waiting more than 30 minutes.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('id, arrived_at, patient:patients(full_name)')
      .eq('clinic_id', ctx.clinicId)
      .in('status', [...WAITING_STATUSES, 'called'])
      .gte('arrived_at', `${today()}T00:00:00`)
    if (error) throw new Error(error.message)
    const rows = ((data ?? []) as { arrived_at: string | null }[]).filter((r) => (minutesSince(r.arrived_at) ?? 0) > 30)
    return {
      toolId: 'get_long_waiting_patients',
      category: 'queue',
      dataCategory: 'long_waiting',
      count: rows.length,
      rows,
      citation: { source: 'Queue', entity: 'appointments', date: today(), detail: `${rows.length} > 30 min · clinic-scoped` },
      summaryLine: `${rows.length} patient(s) waiting more than 30 minutes`,
      warnings: rows.length ? [{ level: 'warning', message: `${rows.length} patient(s) waiting > 30 min` }] : [],
    }
  },
}

// ── Queue: called but not yet seen ────────────────────────────────
export const getCalledNotSeen: AITool = {
  id: 'get_called_not_seen',
  category: 'queue',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Patients called but not yet in consultation.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('id, called_at, patient:patients(full_name)')
      .eq('clinic_id', ctx.clinicId)
      .eq('status', 'called')
      .gte('called_at', `${today()}T00:00:00`)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_called_not_seen',
      category: 'queue',
      dataCategory: 'called_not_seen',
      count: rows.length,
      rows,
      citation: { source: 'Queue', entity: 'appointments', date: today(), detail: `${rows.length} called · clinic-scoped` },
      summaryLine: `${rows.length} patient(s) called but not yet seen`,
      warnings: rows.length ? [{ level: 'info', message: `${rows.length} called, awaiting consultation` }] : [],
    }
  },
}

// ── Appointments: late arrivals (today) ───────────────────────────
export const getLateArrivals: AITool = {
  id: 'get_late_arrivals',
  category: 'appointments',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Patients who arrived after their scheduled time today.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('id, scheduled_at, arrived_at, patient:patients(full_name)')
      .eq('clinic_id', ctx.clinicId)
      .gte('scheduled_at', `${today()}T00:00:00`)
      .lte('scheduled_at', `${today()}T23:59:59`)
      .not('arrived_at', 'is', null)
    if (error) throw new Error(error.message)
    const rows = ((data ?? []) as { scheduled_at: string; arrived_at: string }[]).filter(
      (r) => new Date(r.arrived_at).getTime() > new Date(r.scheduled_at).getTime(),
    )
    return {
      toolId: 'get_late_arrivals',
      category: 'appointments',
      dataCategory: 'late_arrivals',
      count: rows.length,
      rows,
      citation: { source: 'Appointments', entity: 'appointments', date: today(), detail: `${rows.length} late · clinic-scoped` },
      summaryLine: `${rows.length} late arrival(s) today`,
      warnings: [],
    }
  },
}

// ── Appointments: patients with repeated missed appointments ──────
export const getNoShowRisks: AITool = {
  id: 'get_no_show_risks',
  category: 'appointments',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Patients with repeated missed (no-show) appointments.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('patient_id, patient:patients(full_name)')
      .eq('clinic_id', ctx.clinicId)
      .eq('status', 'no_show')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { patient_id: string; patient?: { full_name?: string } }[]
    const byPatient = new Map<string, { name: string; count: number }>()
    for (const r of rows) {
      const entry = byPatient.get(r.patient_id) ?? { name: r.patient?.full_name ?? '—', count: 0 }
      entry.count += 1
      byPatient.set(r.patient_id, entry)
    }
    const repeated = [...byPatient.values()].filter((p) => p.count >= 2).sort((a, b) => b.count - a.count)
    return {
      toolId: 'get_no_show_risks',
      category: 'appointments',
      dataCategory: 'no_show_risks',
      count: repeated.length,
      rows: repeated,
      citation: { source: 'Appointments', entity: 'appointments', detail: `${rows.length} no-shows · clinic-scoped` },
      summaryLine: `${repeated.length} patient(s) with repeated missed appointments`,
      warnings: repeated.length ? [{ level: 'info', message: `${repeated.length} repeat no-show patient(s)` }] : [],
    }
  },
}

// ── Appointments: tomorrow's prep ─────────────────────────────────
export const getTomorrowAppointmentPrep: AITool = {
  id: 'get_tomorrow_appointment_prep',
  category: 'appointments',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "Tomorrow's scheduled appointments to prepare for.",
  async run(db, ctx): Promise<AIToolResult> {
    const day = tomorrow()
    const { data, error } = await tbl(db, 'appointments')
      .select('id, status')
      .eq('clinic_id', ctx.clinicId)
      .gte('scheduled_at', `${day}T00:00:00`)
      .lte('scheduled_at', `${day}T23:59:59`)
      .not('status', 'in', '("cancelled","no_show")')
    if (error) throw new Error(error.message)
    const rows = data ?? []
    return {
      toolId: 'get_tomorrow_appointment_prep',
      category: 'appointments',
      dataCategory: 'tomorrow_prep',
      count: rows.length,
      rows,
      citation: { source: 'Appointments', entity: 'appointments', date: day, detail: `${rows.length} tomorrow · clinic-scoped` },
      summaryLine: `${rows.length} appointment(s) scheduled tomorrow`,
      warnings: [],
    }
  },
}

// ── Appointments: doctor workload (today) ─────────────────────────
export const getDoctorWorkloadSummary: AITool = {
  id: 'get_doctor_workload_summary',
  category: 'appointments',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: "Today's appointment load per doctor.",
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('doctor_id, doctor:user_profiles!appointments_doctor_profiles_fkey(full_name)')
      .eq('clinic_id', ctx.clinicId)
      .gte('scheduled_at', `${today()}T00:00:00`)
      .lte('scheduled_at', `${today()}T23:59:59`)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { doctor_id: string | null; doctor?: { full_name?: string } }[]
    const byDoctor = new Map<string, number>()
    for (const r of rows) {
      const name = r.doctor?.full_name ?? 'Unassigned'
      byDoctor.set(name, (byDoctor.get(name) ?? 0) + 1)
    }
    const top = [...byDoctor.entries()].sort((a, b) => b[1] - a[1])
    return {
      toolId: 'get_doctor_workload_summary',
      category: 'appointments',
      dataCategory: 'doctor_workload',
      count: top.length,
      rows: top.map(([name, n]) => ({ name, count: n })),
      citation: { source: 'Appointments', entity: 'appointments', date: today(), detail: `${rows.length} today · clinic-scoped` },
      summaryLine: top.length ? top.map(([n, c]) => `${n}: ${c}`).join(' · ') : 'No appointments today',
      warnings: [],
    }
  },
}

// ── Appointments: overbooked time slots (today, by hour) ──────────
export const getOverbookedSlots: AITool = {
  id: 'get_overbooked_slots',
  category: 'appointments',
  roles: [...SCHEDULING_ROLES],
  writesData: false,
  requiresPatientContext: false,
  requiresAppointmentContext: false,
  requiresConsultationContext: false,
  description: 'Hours today with an unusually high number of appointments.',
  async run(db, ctx): Promise<AIToolResult> {
    const { data, error } = await tbl(db, 'appointments')
      .select('scheduled_at')
      .eq('clinic_id', ctx.clinicId)
      .gte('scheduled_at', `${today()}T00:00:00`)
      .lte('scheduled_at', `${today()}T23:59:59`)
      .not('status', 'in', '("cancelled","no_show")')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { scheduled_at: string }[]
    const byHour = new Map<string, number>()
    for (const r of rows) {
      const hour = r.scheduled_at.slice(11, 13) + 'h'
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1)
    }
    const OVERBOOK = 4
    const over = [...byHour.entries()].filter(([, n]) => n >= OVERBOOK).sort((a, b) => b[1] - a[1])
    return {
      toolId: 'get_overbooked_slots',
      category: 'appointments',
      dataCategory: 'overbooked_slots',
      count: over.length,
      rows: over.map(([hour, n]) => ({ hour, count: n })),
      citation: { source: 'Appointments', entity: 'appointments', date: today(), detail: `≥${OVERBOOK}/hour · clinic-scoped` },
      summaryLine: over.length
        ? `Overbooked: ${over.map(([h, c]) => `${h} (${c})`).join(', ')}`
        : 'No overbooked slots today',
      warnings: over.length ? [{ level: 'warning', message: `${over.length} overbooked hour(s)` }] : [],
    }
  },
}
