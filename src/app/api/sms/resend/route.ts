import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SMS_ENABLED } from '@/lib/sms/config'
import { dispatchQueued } from '@/lib/sms/process'
import { buildReminderBody, estimateSegments } from '@/lib/sms/templates'
import { toE164 } from '@/lib/phone'

// Roles allowed to trigger a manual reminder (same set that manages appointments).
const ALLOWED_ROLES = ['admin', 'doctor', 'receptionist', 'nurse']

// POST /api/sms/resend  body: { appointment_id: string }
// Queues a one-off 'manual' reminder for an appointment and dispatches it
// immediately. Tenant-safe: the appointment is re-loaded scoped to the caller's
// clinic via the service client.
export async function POST(req: NextRequest) {
  if (!SMS_ENABLED) {
    return NextResponse.json(
      { error: "Les rappels SMS ne sont pas activés." },
      { status: 503 },
    )
  }

  // ── Auth ───────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id, role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile?.is_active || !profile.clinic_id || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // ── Body ───────────────────────────────────────────────────────
  const body = await req.json().catch(() => null)
  const appointmentId: string | undefined = body?.appointment_id
  if (!appointmentId) {
    return NextResponse.json({ error: 'appointment_id requis' }, { status: 400 })
  }

  // ── Load appointment scoped to clinic ──────────────────────────
  const service = createServiceClient()
  const { data: appt } = await service
    .from('appointments')
    .select('id, clinic_id, patient_id, scheduled_at, patient:patients(id, full_name, phone, sms_opt_in)')
    .eq('id', appointmentId)
    .eq('clinic_id', profile.clinic_id)
    .single()

  if (!appt) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })

  const patient = (appt as unknown as {
    patient?: { id: string; full_name: string; phone: string | null; sms_opt_in: boolean }
  }).patient
  if (!patient) return NextResponse.json({ error: 'Patient introuvable' }, { status: 404 })
  if (patient.sms_opt_in === false) {
    return NextResponse.json({ error: "Le patient a refusé les SMS (opt-out)." }, { status: 409 })
  }

  const toPhone = toE164(patient.phone)
  if (!toPhone) {
    return NextResponse.json({ error: 'Numéro de téléphone invalide ou manquant.' }, { status: 422 })
  }

  // ── Get clinic name for the message body ───────────────────────
  const { data: clinic } = await service
    .from('clinics')
    .select('name')
    .eq('id', profile.clinic_id)
    .single()

  const message = buildReminderBody({
    reminderType: 'manual',
    clinicName: clinic?.name ?? '',
    patientName: patient.full_name,
    scheduledAt: appt.scheduled_at,
  })

  const now = new Date()
  const { data: inserted, error: insErr } = await service
    .from('sms_messages')
    .insert({
      clinic_id: profile.clinic_id,
      patient_id: patient.id,
      appointment_id: appt.id,
      reminder_type: 'manual',
      to_phone: toPhone,
      body: message,
      status: 'queued',
      segments: estimateSegments(message),
      scheduled_for: now.toISOString(),
      next_attempt_at: now.toISOString(),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? "Échec de la mise en file" }, { status: 500 })
  }

  // Dispatch immediately so the resend is instant rather than waiting for cron.
  try {
    await dispatchQueued(service, now, 10)
  } catch (err) {
    // The message stays queued and will be retried by cron — surface as success.
    console.error('[sms/resend] immediate dispatch failed', err)
  }

  return NextResponse.json({ ok: true, sms_message_id: inserted.id })
}
