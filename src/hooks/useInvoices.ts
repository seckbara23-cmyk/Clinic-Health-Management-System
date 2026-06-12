import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { Invoice } from '@/types/database'
import { toast } from 'sonner'

export function useInvoices(status?: string, patientId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['invoices', clinic?.id, status, patientId],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('*, patient:patients(id, full_name, patient_number, phone, cni)')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })

      if (status) q = q.eq('status', status)
      if (patientId) q = q.eq('patient_id', patientId)

      const { data, error } = await q
      if (error) throw error
      return data as unknown as Invoice[]
    },
  })
}

interface InvoiceInsert {
  patient_id: string
  consultation_id: string | null
  line_items: object[]
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  // Third-party payer split (Senegal IPM / mutuelle / CNSS / IPRES).
  // Omitted → insurance_share 0, fully patient-payable (legacy behavior).
  insurance_share?: number
  payer_type?: string | null
  payer_name?: string | null
  currency: string
  status: string
  payment_method: string | null
  due_date: string | null
  paid_at: string | null
  notes: string | null
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: InvoiceInsert) => {
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          patient_id: input.patient_id,
          consultation_id: input.consultation_id,
          line_items: input.line_items as unknown as import('@/lib/supabase/database.types').Json,
          subtotal: input.subtotal,
          tax_amount: input.tax_amount,
          discount_amount: input.discount_amount,
          total_amount: input.total_amount,
          amount_paid: input.amount_paid,
          insurance_share: input.insurance_share ?? 0,
          payer_type: input.payer_type ?? null,
          payer_name: input.payer_name ?? null,
          currency: input.currency,
          status: input.status,
          payment_method: input.payment_method,
          due_date: input.due_date,
          paid_at: input.paid_at,
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
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Facture créée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── useRecordPayment ──────────────────────────────────────────
// Calls the record_manual_payment RPC which atomically:
//   1. Validates the payment amount and method server-side
//   2. Locks the invoice row (prevents concurrent double-payment)
//   3. Updates amount_paid / status / paid_at on the invoice
//   4. Appends an immutable payment_events audit row
// This replaces direct .update() on invoices for all payment flows.

interface RecordPaymentInput {
  invoiceId:     string
  amount:        number
  paymentMethod: string
}

export function useRecordPayment() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ invoiceId, amount, paymentMethod }: RecordPaymentInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('record_manual_payment', {
        p_invoice_id:     invoiceId,
        p_amount:         amount,
        p_payment_method: paymentMethod,
      })
      if (error) throw error
      return data as { ok: boolean; invoice_id: string; amount_paid: number; status: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Paiement enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

interface InvoiceUpdate {
  id: string
  status?: string
  amount_paid?: number
  paid_at?: string | null
  payment_method?: string | null
}

export function useUpdateInvoice() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, ...input }: InvoiceUpdate) => {
      const { data, error } = await supabase
        .from('invoices')
        .update(input)
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Facture mise à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDashboardStats() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  return useQuery({
    queryKey: ['dashboard-stats', clinic?.id],
    enabled: !!clinic?.id,
    queryFn: async () => {
      const [
        patients,
        apptToday,
        apptPending,
        consultToday,
        unpaidInvoices,
        invoiceToday,
        invoiceMonth,
      ] = await Promise.all([
        supabase.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinic!.id),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic!.id)
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59`),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic!.id)
          .in('status', ['scheduled', 'in_queue']),
        supabase.from('consultations').select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic!.id)
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`),
        supabase.from('invoices').select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic!.id)
          .in('status', ['draft', 'sent', 'partial', 'overdue']),
        supabase.from('invoices').select('total_amount')
          .eq('clinic_id', clinic!.id)
          .eq('status', 'paid')
          .gte('paid_at', `${today}T00:00:00`),
        supabase.from('invoices').select('total_amount')
          .eq('clinic_id', clinic!.id)
          .eq('status', 'paid')
          .gte('paid_at', `${monthStart}T00:00:00`),
      ])

      const revenueToday = (invoiceToday.data ?? []).reduce((s, i) => s + Number(i.total_amount), 0)
      const revenueMonth = (invoiceMonth.data ?? []).reduce((s, i) => s + Number(i.total_amount), 0)

      return {
        total_patients: patients.count ?? 0,
        appointments_today: apptToday.count ?? 0,
        appointments_pending: apptPending.count ?? 0,
        consultations_today: consultToday.count ?? 0,
        unpaid_invoices: unpaidInvoices.count ?? 0,
        revenue_today: revenueToday,
        revenue_month: revenueMonth,
        active_queue: apptPending.count ?? 0,
      }
    },
  })
}
