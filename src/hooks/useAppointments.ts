import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { Appointment } from '@/types/database'
import { toast } from 'sonner'

export function useAppointments(date?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['appointments', clinic?.id, date],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('appointments')
        .select('*, patient:patients(id, full_name, patient_number, phone), doctor:user_profiles!appointments_doctor_id_fkey(id, full_name, role)')
        .eq('clinic_id', clinic!.id)
        .order('scheduled_at', { ascending: true })

      if (date) {
        const start = `${date}T00:00:00`
        const end = `${date}T23:59:59`
        q = q.gte('scheduled_at', start).lte('scheduled_at', end)
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
        .select('*, patient:patients(id, full_name, patient_number), doctor:user_profiles!appointments_doctor_id_fkey(id, full_name, role)')
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

export function useCreateAppointment() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: CreateAppointmentInput) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          patient_id: input.patient_id,
          doctor_id: input.doctor_id,
          title: input.title,
          scheduled_at: input.scheduled_at,
          duration_min: input.duration_min,
          status: input.status,
          priority: input.priority,
          notes: input.notes,
          clinic_id: clinic!.id,
          created_by: profile!.id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Rendez-vous créé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Appointment['status'] }) => {
      const { data, error } = await supabase
        .from('appointments')
        .update({ status })
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
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
