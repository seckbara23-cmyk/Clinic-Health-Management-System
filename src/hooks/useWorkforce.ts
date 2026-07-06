import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type {
  Credential, EmployeeEvent, EmployeeProfile, EmployeeEventType,
  EmploymentStatus, TrainingRecord, WorkforceMember,
} from '@/lib/workforce/types'
import type { Role } from '@/types/database'

// ── Enterprise Workforce hooks (Phase 21) ──────────────────────────
//
// Tolerant react-query wrappers over the workforce tier. Uses ONLY the
// anon/authenticated client — never the service role. RLS keeps every row
// clinic-isolated and gates writes to admins. Un-generated tables are read via
// an `as any` cast; every query degrades to a safe empty result on error so a
// missing migration (049) never breaks the page.
//
// eslint-disable @typescript-eslint/no-explicit-any is used deliberately: these
// tables are not yet in the generated Database types.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Row → domain mappers ───────────────────────────────────────────
function mapEmployee(r: any): EmployeeProfile {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    clinicId: String(r.clinic_id),
    matricule: r.matricule ?? null,
    nationalId: r.national_id ?? null,
    medicalLicenseNumber: r.medical_license_number ?? null,
    councilRegistration: r.council_registration ?? null,
    department: r.department ?? null,
    position: r.position ?? null,
    employmentType: r.employment_type ?? null,
    employmentStatus: (r.employment_status ?? 'active') as EmploymentStatus,
    hireDate: r.hire_date ?? null,
    contractEndDate: r.contract_end_date ?? null,
    primaryClinicId: r.primary_clinic_id ?? null,
    biography: r.biography ?? null,
    emergencyContact: (r.emergency_contact && typeof r.emergency_contact === 'object') ? r.emergency_contact : {},
  }
}

function mapCredential(r: any): Credential {
  return {
    id: String(r.id),
    employeeId: String(r.employee_id),
    clinicId: String(r.clinic_id),
    credentialType: r.credential_type,
    number: r.number ?? null,
    issuingAuthority: r.issuing_authority ?? null,
    issueDate: r.issue_date ?? null,
    expiryDate: r.expiry_date ?? null,
    status: r.status ?? 'active',
    attachmentPath: r.attachment_path ?? null,
    verificationStatus: r.verification_status ?? 'unverified',
    notes: r.notes ?? null,
  }
}

function mapEvent(r: any): EmployeeEvent {
  return {
    id: String(r.id),
    employeeId: String(r.employee_id),
    clinicId: String(r.clinic_id),
    eventType: r.event_type,
    fromValue: r.from_value ?? null,
    toValue: r.to_value ?? null,
    note: r.note ?? null,
    effectiveDate: r.effective_date ?? null,
    createdAt: String(r.created_at),
  }
}

function mapTraining(r: any): TrainingRecord {
  return {
    id: String(r.id),
    employeeId: String(r.employee_id),
    clinicId: String(r.clinic_id),
    title: r.title,
    provider: r.provider ?? null,
    completedDate: r.completed_date ?? null,
    expiryDate: r.expiry_date ?? null,
    certificatePath: r.certificate_path ?? null,
  }
}

// ── Workforce members (users + employment + professional identity) ─
export function useWorkforceMembers() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['workforce-members', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<WorkforceMember[]> => {
      const clinicId = clinic!.id
      const [usersRes, empRes, profRes] = await Promise.all([
        supabase.from('user_profiles')
          .select('id, full_name, email, role, is_active, must_change_password, created_at, clinic_id')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false }),
        (supabase as any).from('employee_profiles').select('*').eq('clinic_id', clinicId),
        (supabase as any).from('professional_profiles')
          .select('user_id, primary_specialty, languages').eq('clinic_id', clinicId),
      ])

      const users = (usersRes.data ?? []) as any[]
      const empByUser = new Map<string, EmployeeProfile>()
      for (const e of (empRes.data ?? []) as any[]) empByUser.set(String(e.user_id), mapEmployee(e))
      const profByUser = new Map<string, { specialty: string | null; languages: string[] }>()
      for (const p of (profRes.data ?? []) as any[]) {
        profByUser.set(String(p.user_id), {
          specialty: p.primary_specialty ?? null,
          languages: Array.isArray(p.languages) ? p.languages.filter((l: unknown) => typeof l === 'string') : [],
        })
      }

      return users.map(u => {
        const prof = profByUser.get(String(u.id))
        return {
          userId: String(u.id),
          clinicId: String(u.clinic_id ?? clinicId),
          fullName: u.full_name ?? '—',
          email: u.email ?? null,
          role: u.role as Role,
          isActive: u.is_active === true,
          mustChangePassword: u.must_change_password === true,
          createdAt: String(u.created_at),
          primarySpecialty: prof?.specialty ?? null,
          languages: prof?.languages ?? [],
          employee: empByUser.get(String(u.id)) ?? null,
        }
      })
    },
  })
}

// ── Clinic-wide credentials + trainings (for the dashboard) ─────────
export function useClinicCredentials() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['workforce-credentials', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<Credential[]> => {
      const { data, error } = await (supabase as any)
        .from('employee_credentials').select('*').eq('clinic_id', clinic!.id)
      if (error) return []
      return ((data ?? []) as any[]).map(mapCredential)
    },
  })
}

export function useClinicTrainings() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['workforce-trainings', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<TrainingRecord[]> => {
      const { data, error } = await (supabase as any)
        .from('training_records').select('*').eq('clinic_id', clinic!.id)
      if (error) return []
      return ((data ?? []) as any[]).map(mapTraining)
    },
  })
}

export function useEmployeeEvents(employeeId?: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['workforce-events', clinic?.id, employeeId],
    enabled: !!clinic?.id && !!employeeId,
    staleTime: 15_000,
    queryFn: async (): Promise<EmployeeEvent[]> => {
      const { data, error } = await (supabase as any)
        .from('employee_events').select('*')
        .eq('employee_id', employeeId).order('created_at', { ascending: false })
      if (error) return []
      return ((data ?? []) as any[]).map(mapEvent)
    },
  })
}

// ── Mutations (admin-only via RLS) ─────────────────────────────────
function useInvalidateWorkforce() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  return () => {
    qc.invalidateQueries({ queryKey: ['workforce-members', clinic?.id] })
    qc.invalidateQueries({ queryKey: ['workforce-credentials', clinic?.id] })
    qc.invalidateQueries({ queryKey: ['workforce-trainings', clinic?.id] })
    qc.invalidateQueries({ queryKey: ['workforce-events', clinic?.id] })
  }
}

export interface EmployeeProfileInput {
  userId: string
  matricule?: string | null
  nationalId?: string | null
  medicalLicenseNumber?: string | null
  councilRegistration?: string | null
  department?: string | null
  position?: string | null
  employmentType?: string | null
  hireDate?: string | null
  contractEndDate?: string | null
  biography?: string | null
  emergencyContact?: Record<string, string> | null
}

/** Create or update an employment record. On first creation, stamps a 'hired' event. */
export function useUpsertEmployeeProfile() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const invalidate = useInvalidateWorkforce()
  return useMutation({
    mutationFn: async (input: EmployeeProfileInput) => {
      const clinicId = clinic!.id
      // Does an employment record already exist? (drives insert-vs-update + hired event)
      const { data: existing } = await (supabase as any)
        .from('employee_profiles').select('id').eq('user_id', input.userId).eq('clinic_id', clinicId).maybeSingle()

      const payload = {
        user_id: input.userId,
        clinic_id: clinicId,
        matricule: input.matricule ?? null,
        national_id: input.nationalId ?? null,
        medical_license_number: input.medicalLicenseNumber ?? null,
        council_registration: input.councilRegistration ?? null,
        department: input.department ?? null,
        position: input.position ?? null,
        employment_type: input.employmentType ?? null,
        hire_date: input.hireDate ?? null,
        contract_end_date: input.contractEndDate ?? null,
        biography: input.biography ?? null,
        emergency_contact: input.emergencyContact ?? {},
        created_by: profile?.id ?? null,
      }

      const { data, error } = await (supabase as any)
        .from('employee_profiles')
        .upsert(payload, { onConflict: 'user_id,clinic_id' })
        .select().single()
      if (error) throw new Error(error.message)

      if (!existing) {
        await (supabase as any).from('employee_events').insert({
          clinic_id: clinicId, employee_id: data.id, event_type: 'hired',
          effective_date: input.hireDate ?? null, created_by: profile?.id ?? null,
        })
      } else {
        await (supabase as any).from('employee_events').insert({
          clinic_id: clinicId, employee_id: data.id, event_type: 'profile_updated',
          created_by: profile?.id ?? null,
        })
      }
      return mapEmployee(data)
    },
    onSuccess: invalidate,
  })
}

/** Change employment status and append the matching lifecycle event. */
export function useChangeEmploymentStatus() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const invalidate = useInvalidateWorkforce()
  return useMutation({
    mutationFn: async (input: {
      employeeId: string; from: EmploymentStatus; to: EmploymentStatus
      eventType: EmployeeEventType; note?: string; effectiveDate?: string | null
    }) => {
      const { error } = await (supabase as any)
        .from('employee_profiles').update({ employment_status: input.to }).eq('id', input.employeeId)
      if (error) throw new Error(error.message)
      await (supabase as any).from('employee_events').insert({
        clinic_id: clinic!.id, employee_id: input.employeeId, event_type: input.eventType,
        from_value: input.from, to_value: input.to, note: input.note ?? null,
        effective_date: input.effectiveDate ?? null, created_by: profile?.id ?? null,
      })
    },
    onSuccess: invalidate,
  })
}

export interface CredentialInput {
  employeeId: string
  credentialType: string
  number?: string | null
  issuingAuthority?: string | null
  issueDate?: string | null
  expiryDate?: string | null
  status?: string
  verificationStatus?: string
  notes?: string | null
}

export function useSaveCredential() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const invalidate = useInvalidateWorkforce()
  return useMutation({
    mutationFn: async (input: CredentialInput & { id?: string }) => {
      const payload: Record<string, unknown> = {
        clinic_id: clinic!.id,
        employee_id: input.employeeId,
        credential_type: input.credentialType,
        number: input.number ?? null,
        issuing_authority: input.issuingAuthority ?? null,
        issue_date: input.issueDate ?? null,
        expiry_date: input.expiryDate ?? null,
        status: input.status ?? 'active',
        // verification_status is only ever what a human explicitly chose.
        verification_status: input.verificationStatus ?? 'unverified',
        notes: input.notes ?? null,
      }
      // Human verification stamps who/when — never automated.
      if (input.verificationStatus === 'verified') {
        payload.verified_by = profile?.id ?? null
        payload.verified_at = new Date().toISOString()
      }
      if (input.id) {
        const { error } = await (supabase as any).from('employee_credentials').update(payload).eq('id', input.id)
        if (error) throw new Error(error.message)
      } else {
        payload.created_by = profile?.id ?? null
        const { error } = await (supabase as any).from('employee_credentials').insert(payload)
        if (error) throw new Error(error.message)
        await (supabase as any).from('employee_events').insert({
          clinic_id: clinic!.id, employee_id: input.employeeId, event_type: 'credential_added',
          to_value: input.credentialType, created_by: profile?.id ?? null,
        })
      }
    },
    onSuccess: invalidate,
  })
}

export function useAddTraining() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const invalidate = useInvalidateWorkforce()
  return useMutation({
    mutationFn: async (input: {
      employeeId: string; title: string; provider?: string | null
      completedDate?: string | null; expiryDate?: string | null; notes?: string | null
    }) => {
      const { error } = await (supabase as any).from('training_records').insert({
        clinic_id: clinic!.id, employee_id: input.employeeId, title: input.title,
        provider: input.provider ?? null, completed_date: input.completedDate ?? null,
        expiry_date: input.expiryDate ?? null, notes: input.notes ?? null, created_by: profile?.id ?? null,
      })
      if (error) throw new Error(error.message)
      await (supabase as any).from('employee_events').insert({
        clinic_id: clinic!.id, employee_id: input.employeeId, event_type: 'training_completed',
        to_value: input.title, effective_date: input.completedDate ?? null, created_by: profile?.id ?? null,
      })
    },
    onSuccess: invalidate,
  })
}
