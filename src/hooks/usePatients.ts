import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { Patient } from '@/types/database'
import { toast } from 'sonner'

export function usePatients(search?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['patients', clinic?.id, search],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })

      if (search?.trim()) {
        q = q.or(`full_name.ilike.%${search}%,patient_number.ilike.%${search}%,phone.ilike.%${search}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data as Patient[]
    },
  })
}

export function usePatient(id: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['patient', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Patient
    },
  })
}

interface PatientInsertInput {
  full_name: string
  phone?: string | null
  email?: string | null
  date_of_birth?: string | null
  gender?: string | null
  blood_type?: string | null
  address?: string | null
  emergency_contact?: string | null
  emergency_phone?: string | null
  notes?: string | null
}

export function useCreatePatient() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: PatientInsertInput) => {
      const { data, error } = await supabase
        .from('patients')
        .insert({
          full_name: input.full_name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          date_of_birth: input.date_of_birth ?? null,
          gender: input.gender ?? null,
          blood_type: input.blood_type ?? null,
          address: input.address ?? null,
          emergency_contact: input.emergency_contact ?? null,
          emergency_phone: input.emergency_phone ?? null,
          notes: input.notes ?? null,
          clinic_id: clinic!.id,
          created_by: profile!.id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      toast.success('Patient créé avec succès')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdatePatient() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: PatientInsertInput & { id: string }) => {
      const { data, error } = await supabase
        .from('patients')
        .update({
          full_name: input.full_name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          date_of_birth: input.date_of_birth ?? null,
          gender: input.gender ?? null,
          blood_type: input.blood_type ?? null,
          address: input.address ?? null,
          emergency_contact: input.emergency_contact ?? null,
          emergency_phone: input.emergency_phone ?? null,
          notes: input.notes ?? null,
        })
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['patient', data.id] })
      toast.success('Patient mis à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeletePatient() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      toast.success('Patient supprimé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
