import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { SmsReminderType } from '@/types/database'
import { toE164 } from '@/lib/phone'
import { buildReminderBody, estimateSegments } from './templates'

type Service = SupabaseClient<Database>

// ── Reminder scheduling windows ───────────────────────────────────────────────
// A reminder is enqueued when the appointment crosses into its window. The
// window is wider than the cron interval (15 min) so a single skipped run still
// catches it; the sms_messages dedupe index makes multiple catches harmless.
//
//   24h reminder      → fires when scheduled_at ≈ now + 24h
//   same-day reminder → fires when scheduled_at ≈ now + 3h  (decision: 3h window)
const HOUR = 3_600_000
const WINDOW_MS = 30 * 60_000          // 30-min catch window
const SAME_DAY_LEAD_MS = 3 * HOUR      // same-day reminder sent ~3h before
const REMINDER_24H_LEAD_MS = 24 * HOUR

export interface EnqueueSummary {
  scanned: number
  enqueued: number
  byType: Record<string, number>
}

interface ClinicRow {
  id: string
  name: string
  reminder_24h_enabled: boolean
  reminder_same_day_enabled: boolean
}

interface ApptRow {
  id: string
  scheduled_at: string
  patient: { id: string; full_name: string; phone: string | null; sms_opt_in: boolean } | null
}

export async function enqueueDueReminders(service: Service, now: Date): Promise<EnqueueSummary> {
  const summary: EnqueueSummary = { scanned: 0, enqueued: 0, byType: {} }

  const { data: clinics, error } = await service
    .from('clinics')
    .select('id, name, reminder_24h_enabled, reminder_same_day_enabled')
    .eq('sms_reminders_enabled', true)
  if (error) throw error

  for (const clinic of (clinics ?? []) as ClinicRow[]) {
    if (clinic.reminder_24h_enabled) {
      await enqueueWindow(service, clinic, 'appointment_24h',
        new Date(now.getTime() + REMINDER_24H_LEAD_MS),
        new Date(now.getTime() + REMINDER_24H_LEAD_MS + WINDOW_MS),
        now, summary)
    }
    if (clinic.reminder_same_day_enabled) {
      await enqueueWindow(service, clinic, 'appointment_same_day',
        new Date(now.getTime() + SAME_DAY_LEAD_MS),
        new Date(now.getTime() + SAME_DAY_LEAD_MS + WINDOW_MS),
        now, summary)
    }
  }

  return summary
}

async function enqueueWindow(
  service: Service,
  clinic: ClinicRow,
  reminderType: SmsReminderType,
  from: Date,
  to: Date,
  now: Date,
  summary: EnqueueSummary,
): Promise<void> {
  const { data: appts, error } = await service
    .from('appointments')
    .select('id, scheduled_at, patient:patients(id, full_name, phone, sms_opt_in)')
    .eq('clinic_id', clinic.id)
    .eq('status', 'scheduled')
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString())
  if (error) throw error

  const rows = (appts ?? []) as unknown as ApptRow[]
  summary.scanned += rows.length
  if (rows.length === 0) return

  // Skip appointments already enqueued for this reminder type (dedupe is also
  // enforced by a unique index; this avoids the round-trip of failed inserts).
  const apptIds = rows.map(r => r.id)
  const { data: existing } = await service
    .from('sms_messages')
    .select('appointment_id')
    .eq('clinic_id', clinic.id)
    .eq('reminder_type', reminderType)
    .in('appointment_id', apptIds)
  const alreadyQueued = new Set((existing ?? []).map(e => e.appointment_id))

  for (const appt of rows) {
    if (alreadyQueued.has(appt.id)) continue
    const patient = appt.patient
    if (!patient || patient.sms_opt_in === false) continue   // opted out → never enqueue
    const to_phone = toE164(patient.phone)
    if (!to_phone) continue                                  // no sendable number → skip

    const body = buildReminderBody({
      reminderType,
      clinicName: clinic.name,
      patientName: patient.full_name,
      scheduledAt: appt.scheduled_at,
    })

    // Insert per-row so one conflicting/failed row can't drop the rest.
    const { error: insErr } = await service.from('sms_messages').insert({
      clinic_id: clinic.id,
      patient_id: patient.id,
      appointment_id: appt.id,
      reminder_type: reminderType,
      to_phone,
      body,
      status: 'queued',
      segments: estimateSegments(body),
      scheduled_for: now.toISOString(),
      next_attempt_at: now.toISOString(),
    })
    if (insErr) {
      // 23505 = unique violation (a concurrent run won the race) — benign.
      if (insErr.code !== '23505') {
        console.error('[sms/enqueue] insert failed', { appt: appt.id, reminderType, error: insErr.message })
      }
      continue
    }
    summary.enqueued += 1
    summary.byType[reminderType] = (summary.byType[reminderType] ?? 0) + 1
  }
}
