import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { ClinicService } from '@/types/database'

export function useClinicServices() {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['clinic_services', clinic?.id],
    enabled: !!clinic?.id,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('clinic_services')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ClinicService[]
    },
  })
}

interface CreateServiceInput {
  name: string
  description?: string | null
  price: number
  currency?: string
  duration_min?: number | null
  category?: string | null
  sort_order?: number
}

export function useCreateClinicService() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: CreateServiceInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('clinic_services')
        .insert({
          clinic_id:    clinic!.id,
          name:         input.name,
          description:  input.description ?? null,
          price:        input.price,
          currency:     input.currency ?? 'XOF',
          duration_min: input.duration_min ?? null,
          category:     input.category ?? null,
          sort_order:   input.sort_order ?? 0,
          is_active:    true,
        })
        .select()
        .single()
      if (error) throw error
      return data as ClinicService
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic_services', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteClinicService() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('clinic_services')
        .delete()
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic_services', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateClinicService() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<CreateServiceInput> & { id: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('clinic_services')
        .update(input)
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data as ClinicService
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic_services', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
