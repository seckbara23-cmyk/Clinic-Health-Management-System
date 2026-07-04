import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toStoredPhone } from '@/lib/phone'
import type { Patient } from '@/types/database'
import type { DemographicsVars } from '@/lib/offline/mutation-defaults'
import { toast } from 'sonner'

export const PATIENTS_PAGE_SIZE = 25

/**
 * True when an error is the Postgres unique-violation (23505) raised by the
 * partial index `patients_clinic_cni_unique` — i.e. this clinic already has a
 * patient with the same CNI. Callers surface a friendly, field-level message
 * instead of the raw constraint text.
 */
export function isCniDuplicateError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; details?: string } | null
  if (!err) return false
  const haystack = `${err.message ?? ''} ${err.details ?? ''}`.toLowerCase()
  return err.code === '23505' && haystack.includes('cni')
}

/** French toast message for a patient mutation error (hooks are FR-only). */
function patientErrorMessage(e: Error): string {
  if (isCniDuplicateError(e)) return 'Ce numéro CNI est déjà enregistré pour un autre patient'
  return e.message
}

export function usePatients(search?: string, page = 0, includeDeleted = false) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['patients', clinic?.id, search, page, includeDeleted],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async () => {
      // The edit dialog resets its form from a row of this list, so every
      // editable column must be selected here — a missing column would be
      // saved back as null and wipe the value.
      let q = supabase
        .from('patients')
        .select(
          'id, full_name, patient_number, phone, email, date_of_birth, gender, blood_type, created_at, address, emergency_contact, emergency_phone, notes, cni, insurance_payer_type, insurance_provider, insurance_policy_number, insurance_coverage_percent, sms_opt_in, sms_opt_out_at, consent_given, consent_date, consent_method, consent_notes, deleted_at, deletion_reason',
          { count: 'exact' }
        )
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
        .range(page * PATIENTS_PAGE_SIZE, (page + 1) * PATIENTS_PAGE_SIZE - 1)

      // Soft-deleted patients are hidden unless the admin opts to see them.
      if (!includeDeleted) q = q.is('deleted_at', null)

      if (search?.trim()) {
        q = q.or(`full_name.ilike.%${search}%,patient_number.ilike.%${search}%,phone.ilike.%${search}%`)
      }

      const { data, error, count } = await q
      if (error) throw error
      return { data: data as Patient[], total: count ?? 0 }
    },
  })
}

// Minimal patient identity — the ONLY patient data persisted offline (no
// allergies/insurance/notes/CNI). queryKey root 'patient-identity' is on the
// offline allowlist; used by offline-capable screens (e.g. appointment picker).
export interface PatientIdentity {
  id: string
  full_name: string
  patient_number: string
  phone: string | null
  gender: string | null
  date_of_birth: string | null
}

export function usePatientIdentities() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['patient-identity', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('id, full_name, patient_number, phone, gender, date_of_birth')
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as PatientIdentity[]
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
  cni?: string | null
  insurance_payer_type?: string | null
  insurance_provider?: string | null
  insurance_policy_number?: string | null
  insurance_coverage_percent?: number | null
  sms_opt_in?: boolean | null
  consent_given?: boolean | null
  consent_method?: string | null
  consent_notes?: string | null
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
          phone: toStoredPhone(input.phone),
          email: input.email ?? null,
          date_of_birth: input.date_of_birth ?? null,
          gender: input.gender ?? null,
          blood_type: input.blood_type ?? null,
          address: input.address ?? null,
          emergency_contact: input.emergency_contact ?? null,
          emergency_phone: toStoredPhone(input.emergency_phone),
          cni: input.cni?.trim() || null,
          insurance_payer_type: input.insurance_payer_type ?? null,
          insurance_provider: input.insurance_provider?.trim() || null,
          insurance_policy_number: input.insurance_policy_number?.trim() || null,
          insurance_coverage_percent: input.insurance_coverage_percent ?? null,
          sms_opt_in: input.sms_opt_in ?? true,
          sms_opt_out_at: input.sms_opt_in === false ? new Date().toISOString() : null,
          consent_given: input.consent_given ?? false,
          consent_date: input.consent_given ? new Date().toISOString() : null,
          consent_method: input.consent_given ? (input.consent_method ?? null) : null,
          consent_notes: input.consent_notes?.trim() || null,
          consent_recorded_by: input.consent_given ? profile!.id : null,
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
    onError: (e: Error) => toast.error(patientErrorMessage(e)),
  })
}

export function useUpdatePatient() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: PatientInsertInput & { id: string }) => {
      const { data, error } = await supabase
        .from('patients')
        .update({
          full_name: input.full_name,
          phone: toStoredPhone(input.phone),
          email: input.email ?? null,
          date_of_birth: input.date_of_birth ?? null,
          gender: input.gender ?? null,
          blood_type: input.blood_type ?? null,
          address: input.address ?? null,
          emergency_contact: input.emergency_contact ?? null,
          emergency_phone: toStoredPhone(input.emergency_phone),
          cni: input.cni?.trim() || null,
          insurance_payer_type: input.insurance_payer_type ?? null,
          insurance_provider: input.insurance_provider?.trim() || null,
          insurance_policy_number: input.insurance_policy_number?.trim() || null,
          insurance_coverage_percent: input.insurance_coverage_percent ?? null,
          sms_opt_in: input.sms_opt_in ?? true,
          sms_opt_out_at: input.sms_opt_in === false ? new Date().toISOString() : null,
          consent_given: input.consent_given ?? false,
          consent_date: input.consent_given ? new Date().toISOString() : null,
          consent_method: input.consent_given ? (input.consent_method ?? null) : null,
          consent_notes: input.consent_notes?.trim() || null,
          consent_recorded_by: input.consent_given ? profile!.id : null,
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
    onError: (e: Error) => toast.error(patientErrorMessage(e)),
  })
}

// ── usePatientDeletionCounts ──────────────────────────────────
// Fetches counts of all records that will be cascade-deleted when
// a patient is deleted. Used to show an informed confirmation
// dialog before proceeding with a destructive delete.

export function usePatientDeletionCounts(patientId: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['patient-deletion-counts', patientId],
    enabled: !!patientId && !!clinic?.id,
    staleTime: 0, // always fresh when dialog opens
    queryFn: async () => {
      const [appts, consults, rxs, labs, invoices] = await Promise.all([
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId!).eq('clinic_id', clinic!.id),
        supabase.from('consultations').select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId!).eq('clinic_id', clinic!.id),
        supabase.from('prescriptions').select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId!).eq('clinic_id', clinic!.id),
        supabase.from('lab_requests').select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId!).eq('clinic_id', clinic!.id),
        supabase.from('invoices').select('id', { count: 'exact', head: true })
          .eq('patient_id', patientId!).eq('clinic_id', clinic!.id),
      ])
      return {
        appointments:  appts.count    ?? 0,
        consultations: consults.count ?? 0,
        prescriptions: rxs.count      ?? 0,
        lab_requests:  labs.count     ?? 0,
        invoices:      invoices.count ?? 0,
      }
    },
  })
}

// NOTE: patient deletion is now SOFT and reversible. Use
// useSoftDeleteRecord({ entity: 'patient', id, reason }) from
// '@/hooks/useCompliance' instead of a hard delete. Hard deletes are blocked
// at the RLS layer (migration 027) so no medical history can be erased.

// Offline-queueable BASIC demographics update (mutationKey 'patient.demographics',
// replayable fn in mutation-defaults.ts). Used when offline to amend identity
// fields only — never insurance/consent (those require a connection).
interface DemographicsInput {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  date_of_birth?: string | null
  gender?: string | null
}

export function useUpdatePatientDemographics() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const buildVars = (input: DemographicsInput) => ({
    id: input.id,
    clinic_id: clinic!.id,
    full_name: input.full_name,
    phone: toStoredPhone(input.phone),
    email: input.email ?? null,
    address: input.address ?? null,
    date_of_birth: input.date_of_birth ?? null,
    gender: input.gender ?? null,
  })
  const m = useMutation<unknown, Error, DemographicsVars>({
    mutationKey: ['patient.demographics'],
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['patient-identity', clinic?.id] })
      toast.success('Données patient enregistrées')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return {
    ...m,
    mutate: (input: DemographicsInput) => m.mutate(buildVars(input)),
    mutateAsync: (input: DemographicsInput) => m.mutateAsync(buildVars(input)),
  }
}
