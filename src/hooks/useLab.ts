import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type {
  LabTest, LabOrder, LabOrderStatus, LabResultFlag, LabOrderPatientIdentity, AppointmentPriority,
} from '@/types/database'

// ─── Catalog ────────────────────────────────────────────────────
export function useLabTests(includeInactive = false) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['lab_tests', clinic?.id, includeInactive],
    enabled: !!clinic?.id,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('lab_tests')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (!includeInactive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data as LabTest[]
    },
  })
}

interface LabTestInput {
  id?: string
  name: string
  category?: string | null
  sample_type?: string | null
  unit?: string | null
  normal_range_low?: number | null
  normal_range_high?: number | null
  normal_range_text?: string | null
  price?: number | null
  is_active?: boolean
}

export function useUpsertLabTest() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: LabTestInput) => {
      const payload = {
        name: input.name,
        category: input.category?.trim() || null,
        sample_type: input.sample_type?.trim() || null,
        unit: input.unit?.trim() || null,
        normal_range_low: input.normal_range_low ?? null,
        normal_range_high: input.normal_range_high ?? null,
        normal_range_text: input.normal_range_text?.trim() || null,
        price: input.price ?? 0,
        is_active: input.is_active ?? true,
      }
      if (input.id) {
        const { error } = await supabase.from('lab_tests').update(payload)
          .eq('id', input.id).eq('clinic_id', clinic!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('lab_tests').insert({ ...payload, clinic_id: clinic!.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_tests', clinic?.id] })
      toast.success('Test enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Orders ─────────────────────────────────────────────────────
// NOTE: no patients join — patient identity comes from the order snapshot
// (patient_name / patient_number) so a lab_technician (no patients access)
// can use this query.
const ORDER_SELECT =
  '*, items:lab_order_items(*), doctor:user_profiles!ordered_by(id, full_name), reviewer:user_profiles!reviewed_by(id, full_name)'

export function useLabOrders(patientId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['lab_orders', clinic?.id, patientId ?? 'all'],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('lab_orders')
        .select(ORDER_SELECT)
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (patientId) q = q.eq('patient_id', patientId)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as LabOrder[]
    },
  })
}

interface CreateLabOrderInput {
  patient_id: string
  consultation_id?: string | null
  priority: AppointmentPriority
  clinical_notes?: string | null
  tests: Array<{ lab_test_id?: string | null; test_name: string }>
}

export function useCreateLabOrder() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: CreateLabOrderInput) => {
      const { data: order, error } = await supabase
        .from('lab_orders')
        .insert({
          clinic_id: clinic!.id,
          patient_id: input.patient_id,
          consultation_id: input.consultation_id ?? null,
          ordered_by: profile!.id,
          priority: input.priority,
          clinical_notes: input.clinical_notes ?? null,
        })
        .select('id')
        .single()
      if (error) throw error

      // Items: the DB trigger snapshots test_name/unit/range/price from the
      // catalog when lab_test_id is set; ad-hoc tests pass test_name directly.
      const items = input.tests.map(t => ({
        lab_order_id: order.id,
        lab_test_id: t.lab_test_id ?? null,
        test_name: t.test_name,
      }))
      const { error: itemErr } = await supabase.from('lab_order_items').insert(items)
      if (itemErr) throw itemErr
      return order
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_orders', clinic?.id] })
      toast.success('Analyse demandée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateLabOrderStatus() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LabOrderStatus }) => {
      const now = new Date().toISOString()
      const patch = {
        status,
        ...(status === 'sample_collected' ? { sample_collected_at: now } : {}),
        ...(status === 'completed' ? { completed_at: now } : {}),
      }
      const { error } = await supabase.from('lab_orders').update(patch)
        .eq('id', id).eq('clinic_id', clinic!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_orders', clinic?.id] })
      toast.success('Statut mis à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

interface EnterResultInput {
  id: string
  result_value: string
  result_numeric?: number | null
  flag: LabResultFlag
  result_notes?: string | null
}

export function useEnterLabResult() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: EnterResultInput) => {
      const { error } = await supabase.from('lab_order_items').update({
        result_value: input.result_value,
        result_numeric: input.result_numeric ?? null,
        flag: input.flag,
        result_notes: input.result_notes?.trim() || null,
        resulted_by: profile!.id,
        resulted_at: new Date().toISOString(),
      }).eq('id', input.id).eq('clinic_id', clinic!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_orders', clinic?.id] })
      toast.success('Résultat enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Doctor/admin review — sets interpretation and marks the order reviewed.
export function useReviewLabOrder() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ id, interpretation }: { id: string; interpretation: string | null }) => {
      const { error } = await supabase.from('lab_orders').update({
        status: 'reviewed',
        reviewed_by: profile!.id,
        reviewed_at: new Date().toISOString(),
        interpretation: interpretation?.trim() || null,
      }).eq('id', id).eq('clinic_id', clinic!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_orders', clinic?.id] })
      toast.success('Analyse validée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Billing integration (optional) ─────────────────────────────
// Generate an invoice from a lab order: one line item per test, with the
// payer split prefilled when the patient is insured. Reuses the existing
// invoices table (Senegal P0 payer fields). Guards against double-billing.
export function useGenerateLabInvoice() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (order: LabOrder) => {
      if (order.invoice_id) throw new Error('Cette analyse est déjà facturée')
      const items = order.items ?? []
      const lineItems = items.map(i => ({
        description: i.test_name,
        quantity: 1,
        unit_price: Number(i.price) || 0,
        total: Number(i.price) || 0,
      }))
      const subtotal = lineItems.reduce((s, i) => s + i.total, 0)

      // Pull the patient's insurance to prefill the payer split.
      const { data: patient } = await supabase
        .from('patients')
        .select('insurance_payer_type, insurance_provider, insurance_coverage_percent')
        .eq('id', order.patient_id)
        .single()
      const coverage = patient?.insurance_coverage_percent != null ? Number(patient.insurance_coverage_percent) : 0
      const insuranceShare = patient?.insurance_payer_type ? Math.min(Math.round(subtotal * coverage / 100), subtotal) : 0

      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          clinic_id: clinic!.id,
          patient_id: order.patient_id,
          consultation_id: order.consultation_id,
          line_items: lineItems as unknown as import('@/lib/supabase/database.types').Json,
          subtotal,
          tax_amount: 0,
          discount_amount: 0,
          total_amount: subtotal,
          amount_paid: 0,
          insurance_share: insuranceShare,
          payer_type: insuranceShare > 0 ? patient?.insurance_payer_type ?? null : null,
          payer_name: insuranceShare > 0 ? patient?.insurance_provider ?? null : null,
          currency: 'XOF',
          status: 'draft',
          created_by: profile!.id,
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: linkErr } = await supabase.from('lab_orders')
        .update({ invoice_id: invoice.id }).eq('id', order.id).eq('clinic_id', clinic!.id)
      if (linkErr) throw linkErr
      return invoice
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_orders', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Facture créée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Identity-only fetch for PDF generation (works for lab_technician).
export async function fetchLabOrderIdentity(orderId: string): Promise<LabOrderPatientIdentity | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_lab_order_patient_identity', { p_order_id: orderId })
  if (error || !data || data.length === 0) return null
  return data[0] as LabOrderPatientIdentity
}
