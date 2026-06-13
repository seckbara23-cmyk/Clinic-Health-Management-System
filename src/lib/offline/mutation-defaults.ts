import type { QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

// Self-contained, replayable mutation defaults for the offline queue.
//
// Each default reads EVERYTHING from its variables (no React context) so a
// paused mutation can be replayed after a full reload. The hooks declare only a
// `mutationKey` and inject clinic_id / created_by / a client-generated id into
// the variables before calling mutate — keeping the persisted payload complete.
//
// Allowed offline actions ONLY: create appointment, update appointment status,
// check-in, call, basic patient demographics. Nothing clinical/financial.

const BACKOFF = (attempt: number) => Math.min(2000 * 2 ** attempt, 30_000)

export interface CreateAppointmentVars {
  id: string; clinic_id: string; created_by: string; patient_id: string
  doctor_id: string | null; title: string; scheduled_at: string
  duration_min: number; status: string; priority: string; notes: string | null
}
export interface AppointmentStatusVars { id: string; clinic_id: string; status: string }
export interface CheckInVars { id: string; clinic_id: string; at: string }
export interface CallVars { id: string; clinic_id: string; at: string }
export interface DemographicsVars {
  id: string; clinic_id: string
  full_name: string; phone: string | null; email: string | null
  address: string | null; date_of_birth: string | null; gender: string | null
}

let registered = false

export function registerOfflineMutationDefaults(qc: QueryClient) {
  if (registered) return
  registered = true
  const supabase = createClient()
  const common = { networkMode: 'online' as const, retry: 3, retryDelay: BACKOFF }

  qc.setMutationDefaults(['appointment.create'], {
    ...common,
    mutationFn: async (v: CreateAppointmentVars) => {
      const { error } = await supabase.from('appointments').insert({
        id: v.id, clinic_id: v.clinic_id, created_by: v.created_by, patient_id: v.patient_id,
        doctor_id: v.doctor_id, title: v.title, scheduled_at: v.scheduled_at,
        duration_min: v.duration_min, status: v.status, priority: v.priority, notes: v.notes,
      })
      if (error) throw error
    },
  })

  qc.setMutationDefaults(['appointment.status'], {
    ...common,
    mutationFn: async (v: AppointmentStatusVars) => {
      const { error } = await supabase.from('appointments')
        .update({ status: v.status }).eq('id', v.id).eq('clinic_id', v.clinic_id)
      if (error) throw error
    },
  })

  qc.setMutationDefaults(['patient.checkin'], {
    ...common,
    mutationFn: async (v: CheckInVars) => {
      const { error } = await supabase.from('appointments')
        .update({ status: 'waiting', arrived_at: v.at } as never).eq('id', v.id).eq('clinic_id', v.clinic_id)
      if (error) throw error
    },
  })

  qc.setMutationDefaults(['patient.call'], {
    ...common,
    mutationFn: async (v: CallVars) => {
      const { error } = await supabase.from('appointments')
        .update({ status: 'called', called_at: v.at } as never).eq('id', v.id).eq('clinic_id', v.clinic_id)
      if (error) throw error
    },
  })

  qc.setMutationDefaults(['patient.demographics'], {
    ...common,
    mutationFn: async (v: DemographicsVars) => {
      const { error } = await supabase.from('patients').update({
        full_name: v.full_name, phone: v.phone, email: v.email,
        address: v.address, date_of_birth: v.date_of_birth, gender: v.gender,
      }).eq('id', v.id).eq('clinic_id', v.clinic_id)
      if (error) throw error
    },
  })
}
