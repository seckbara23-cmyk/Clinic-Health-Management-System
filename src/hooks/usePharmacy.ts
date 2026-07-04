import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type {
  ClinicMedicationInventory, MedicationBatch, StockMovement, MedicationDispensing, StockMovementType,
} from '@/types/database'

// ─── Inventory lines ────────────────────────────────────────────
export function useInventory(includeInactive = false) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['inventory', clinic?.id, includeInactive],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('clinic_medication_inventory')
        .select('*, medication:medications(id, name, strength, dosage_form, is_active, created_at, updated_at)')
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (!includeInactive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as ClinicMedicationInventory[]
    },
  })
}

interface InventoryInput {
  id?: string
  medication_id: string
  reorder_level?: number
  selling_price?: number
  purchase_price?: number
  supplier?: string | null
  is_active?: boolean
}

export function useUpsertInventory() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: InventoryInput) => {
      const payload = {
        reorder_level: input.reorder_level ?? 0,
        selling_price: input.selling_price ?? 0,
        purchase_price: input.purchase_price ?? 0,
        supplier: input.supplier?.trim() || null,
        is_active: input.is_active ?? true,
      }
      if (input.id) {
        const { error } = await supabase.from('clinic_medication_inventory').update(payload)
          .eq('id', input.id).eq('clinic_id', clinic!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('clinic_medication_inventory')
          .insert({ ...payload, medication_id: input.medication_id, clinic_id: clinic!.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', clinic?.id] })
      toast.success('Article enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Batches ────────────────────────────────────────────────────
export function useBatches(inventoryId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['batches', clinic?.id, inventoryId ?? 'all'],
    enabled: !!clinic?.id && !!inventoryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medication_batches')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('inventory_id', inventoryId!)
        .is('deleted_at', null)
        .order('expiry_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as MedicationBatch[]
    },
  })
}

export function useReceiveStock() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { inventory_id: string; batch_number?: string | null; expiry_date?: string | null; quantity: number; purchase_price?: number | null }) => {
      const { error } = await supabase.rpc('receive_stock', {
        p_inventory_id: input.inventory_id,
        p_batch_number: input.batch_number ?? null,
        p_expiry_date: input.expiry_date ?? null,
        p_quantity: input.quantity,
        p_purchase_price: input.purchase_price ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['inventory', clinic?.id] })
      toast.success('Stock reçu')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAdjustStock() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { batch_id: string; movement_type: Exclude<StockMovementType, 'received' | 'dispensed'>; quantity_change: number; notes?: string | null }) => {
      const { error } = await supabase.rpc('adjust_stock', {
        p_batch_id: input.batch_id,
        p_movement_type: input.movement_type,
        p_quantity_change: input.quantity_change,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['inventory', clinic?.id] })
      toast.success('Ajustement enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useStockMovements(inventoryId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['stock_movements', clinic?.id, inventoryId ?? 'all'],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('stock_movements')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (inventoryId) q = q.eq('inventory_id', inventoryId)
      const { data, error } = await q
      if (error) throw error
      return data as StockMovement[]
    },
  })
}

// ─── Dispensing ─────────────────────────────────────────────────
export function useDispensings(opts?: { prescriptionId?: string; patientId?: string }) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['dispensings', clinic?.id, opts?.prescriptionId ?? '', opts?.patientId ?? ''],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('medication_dispensings')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (opts?.prescriptionId) q = q.eq('prescription_id', opts.prescriptionId)
      if (opts?.patientId) q = q.eq('patient_id', opts.patientId)
      const { data, error } = await q
      if (error) throw error
      return data as MedicationDispensing[]
    },
  })
}

interface DispenseInput {
  prescription_id: string
  line_index: number
  medication_id: string | null
  inventory_id: string | null
  medication_name: string
  quantity_prescribed: number
  quantity_dispensed: number
  substitution_notes?: string | null
  unavailable_reason?: string | null
}

export function useDispense() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: DispenseInput): Promise<string | null> => {
      const { data, error } = await supabase.rpc('dispense_medication', {
        p_prescription_id: input.prescription_id,
        p_line_index: input.line_index,
        p_medication_id: input.medication_id,
        p_inventory_id: input.inventory_id,
        p_medication_name: input.medication_name,
        p_quantity_prescribed: input.quantity_prescribed,
        p_quantity_dispensed: input.quantity_dispensed,
        p_substitution_notes: input.substitution_notes ?? null,
        p_unavailable_reason: input.unavailable_reason ?? null,
      })
      if (error) throw error
      // The RPC returns the new dispensing id — used to attach a verification
      // audit row (Phase 10B). Existing callers ignore the return value.
      return (data as string | null) ?? null
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispensings', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['inventory', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      toast.success('Délivrance enregistrée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useGenerateDispensingInvoice() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (prescriptionId: string) => {
      const { data, error } = await supabase.rpc('generate_dispensing_invoice', { p_prescription_id: prescriptionId })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispensings', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Facture créée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Reports ────────────────────────────────────────────────────
export function useLowStock() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['low_stock', clinic?.id],
    enabled: !!clinic?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinic_medication_inventory')
        .select('*, medication:medications(id, name, strength, dosage_form, is_active, created_at, updated_at)')
        .eq('clinic_id', clinic!.id)
        .eq('is_active', true)
        .is('deleted_at', null)
      if (error) throw error
      // Filter client-side: column-vs-column comparison isn't expressible in PostgREST.
      return (data as unknown as ClinicMedicationInventory[]).filter(i => i.stock_quantity <= i.reorder_level)
    },
  })
}

export function useNearExpiry(days = 90) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['near_expiry', clinic?.id, days],
    enabled: !!clinic?.id,
    queryFn: async () => {
      const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('medication_batches')
        .select('*, inventory:clinic_medication_inventory(id, medication:medications(name, strength))')
        .eq('clinic_id', clinic!.id)
        .is('deleted_at', null)
        .gt('quantity_remaining', 0)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', cutoff)
        .order('expiry_date', { ascending: true })
      if (error) throw error
      return data as unknown as (MedicationBatch & { inventory?: { id: string; medication?: { name: string; strength: string | null } } })[]
    },
  })
}
