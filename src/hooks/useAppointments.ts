import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { Appointment } from '@/types/database'
import type { CreateAppointmentVars, AppointmentStatusVars, CheckInVars, CallVars } from '@/lib/offline/mutation-defaults'
import { toast } from 'sonner'

export function useAppointments(date?: string, patientId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['appointments', clinic?.id, date, patientId],
    enabled: !!clinic?.id,
    staleTime: 20_000,
    queryFn: async () => {
      let q = supabase
        .from('appointments')
        .select('*, patient:patients(id, full_name, patient_number, phone), doctor:user_profiles!appointments_doctor_profiles_fkey(id, full_name, role)')
        .eq('clinic_id', clinic!.id)
        .order('scheduled_at', { ascending: true })

      if (date) {
        const start = `${date}T00:00:00`
        const end = `${date}T23:59:59`
        q = q.gte('scheduled_at', start).lte('scheduled_at', end)
      }

      if (patientId) {
        q = q.eq('patient_id', patientId)
      }

      const { data, error } = await q
      if (error) throw error
      return data as unknown as Appointment[]
    },
  })
}

export function useTodayQueue() {
  const today = new Date().toISOString().split('T')[0]
  return useAppointments(today)
}

export function useWeekAppointments(weekStart: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  const startDate = new Date(weekStart)
  const endDate = new Date(weekStart)
  endDate.setDate(endDate.getDate() + 6)

  return useQuery({
    queryKey: ['appointments', clinic?.id, 'week', weekStart],
    enabled: !!clinic?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, patient:patients(id, full_name, patient_number), doctor:user_profiles!appointments_doctor_profiles_fkey(id, full_name, role)')
        .eq('clinic_id', clinic!.id)
        .gte('scheduled_at', `${startDate.toISOString().split('T')[0]}T00:00:00`)
        .lte('scheduled_at', `${endDate.toISOString().split('T')[0]}T23:59:59`)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data as unknown as Appointment[]
    },
  })
}

interface CreateAppointmentInput {
  patient_id: string
  doctor_id: string | null
  title: string
  scheduled_at: string
  duration_min: number
  status: string
  priority: string
  notes: string | null
}

// These four are OFFLINE-QUEUEABLE. They declare a `mutationKey` whose
// self-contained `mutationFn` is registered in mutation-defaults.ts (so a
// paused mutation can replay after a reload). The hooks inject clinic_id /
// created_by / a client-generated id into the variables, keeping the public
// input shape unchanged for callers.
export function useCreateAppointment() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const buildVars = (input: CreateAppointmentInput) => ({
    id: crypto.randomUUID(),               // client id → idempotent replay (no dupes)
    clinic_id: clinic!.id,
    created_by: profile!.id,
    patient_id: input.patient_id,
    doctor_id: input.doctor_id,
    title: input.title,
    scheduled_at: input.scheduled_at,
    duration_min: input.duration_min,
    status: input.status,
    priority: input.priority,
    notes: input.notes,
  })
  const m = useMutation<unknown, Error, CreateAppointmentVars>({
    mutationKey: ['appointment.create'],
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Rendez-vous créé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    ...m,
    mutate: (input: CreateAppointmentInput) => m.mutate(buildVars(input)),
    mutateAsync: (input: CreateAppointmentInput) => m.mutateAsync(buildVars(input)),
  }
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const m = useMutation<unknown, Error, AppointmentStatusVars>({
    mutationKey: ['appointment.status'],
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    ...m,
    mutate: (input: { id: string; status: Appointment['status'] }) =>
      m.mutate({ id: input.id, clinic_id: clinic!.id, status: input.status }),
    mutateAsync: (input: { id: string; status: Appointment['status'] }) =>
      m.mutateAsync({ id: input.id, clinic_id: clinic!.id, status: input.status }),
  }
}

interface UpdateAppointmentInput {
  id: string
  doctor_id?: string | null
  scheduled_at?: string
  duration_min?: number
  priority?: string
  notes?: string | null
  status?: string
}

export function useCheckInPatient() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const m = useMutation<unknown, Error, CheckInVars>({
    mutationKey: ['patient.checkin'],
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Patient enregistré — en salle d\'attente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    ...m,
    mutate: (id: string) => m.mutate({ id, clinic_id: clinic!.id, at: new Date().toISOString() }),
    mutateAsync: (id: string) => m.mutateAsync({ id, clinic_id: clinic!.id, at: new Date().toISOString() }),
  }
}

export function useCallPatient() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const m = useMutation<unknown, Error, CallVars>({
    mutationKey: ['patient.call'],
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Patient appelé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    ...m,
    mutate: (id: string) => m.mutate({ id, clinic_id: clinic!.id, at: new Date().toISOString() }),
    mutateAsync: (id: string) => m.mutateAsync({ id, clinic_id: clinic!.id, at: new Date().toISOString() }),
  }
}

export function useUpdateAppointment() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAppointmentInput) => {
      const { data, error } = await supabase
        .from('appointments')
        .update(input)
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Rendez-vous mis à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
