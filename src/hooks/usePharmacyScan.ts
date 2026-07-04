import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { CatalogMedication, MedicationCycleCount } from '@/types/database'
import type { VerificationMethod } from '@/lib/dispensing-workflow'

export interface BarcodeMedication {
  id: string
  name: string
  strength: string | null
  dosage_form: string | null
  is_active: boolean
}

/**
 * Resolve a scanned barcode to a global-formulary medication. Isolated and
 * ERROR-TOLERANT: if the `barcode` column doesn't exist yet (migration 033 not
 * applied), the filtered query fails and we return null instead of throwing —
 * so no existing flow regresses and the caller falls back to name matching.
 */
export async function fetchMedicationByBarcode(code: string): Promise<BarcodeMedication | null> {
  if (!code) return null
  const supabase = createClient()
  try {
    // `barcode` is added by migration 033 and isn't in the generated types yet,
    // so this isolated, error-tolerant query is cast. If the column is absent
    // the query fails and we return null (no regression to existing flows).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('medications')
      .select('id, name, strength, dosage_form, is_active')
      .eq('barcode', code)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (error) return null
    return (data as BarcodeMedication | null) ?? null
  } catch {
    return null
  }
}

/** Recent cycle counts for the clinic (tolerant: empty if the table is absent). */
export function useCycleCounts(limit = 20) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['cycle_counts', clinic?.id, limit],
    enabled: !!clinic?.id,
    queryFn: async (): Promise<(MedicationCycleCount & { inventory?: { medication?: Pick<CatalogMedication, 'name'> } })[]> => {
      try {
        // Table added by migration 033 — not in generated types; cast + tolerant.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('medication_cycle_counts')
          .select('*, inventory:clinic_medication_inventory(medication:medications(name))')
          .eq('clinic_id', clinic!.id)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return []
        return (data ?? []) as unknown as (MedicationCycleCount & { inventory?: { medication?: Pick<CatalogMedication, 'name'> } })[]
      } catch {
        return []
      }
    },
  })
}

export interface VerificationInput {
  dispensing_id?: string | null
  prescription_id: string
  line_index: number
  medication_name: string
  scanned_name?: string | null
  verified: boolean
  method: VerificationMethod
  mismatches?: string[]
}

/**
 * Append a barcode-verification audit row (Phase 10B, migration 034). Returns a
 * fire-and-forget recorder. ERROR-TOLERANT: if the table doesn't exist yet or
 * the insert is denied, it resolves without throwing so it never blocks the
 * dispensing flow. The existing dispensing audit is untouched.
 */
export function useRecordDispensingVerification() {
  const { clinic, profile } = useClinic()
  return useCallback(async (input: VerificationInput): Promise<void> => {
    if (!clinic?.id) return
    const supabase = createClient()
    try {
      // Table added by migration 034 — not in generated types; cast + tolerant.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('dispensing_verifications').insert({
        clinic_id: clinic.id,
        dispensing_id: input.dispensing_id ?? null,
        prescription_id: input.prescription_id,
        line_index: input.line_index,
        medication_name: input.medication_name,
        scanned_name: input.scanned_name ?? null,
        verified: input.verified,
        verification_method: input.method,
        mismatches: input.mismatches ?? [],
        verified_by: profile?.id ?? null,
      })
    } catch { /* audit is best-effort — never block dispensing */ }
  }, [clinic?.id, profile?.id])
}

interface CycleCountInput {
  inventory_id: string
  expected_qty: number
  counted_qty: number
  notes?: string | null
}

/** Record a cycle count (immutable stock-audit row; RLS: pharmacist/admin). */
export function useCreateCycleCount() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: CycleCountInput) => {
      const variance = input.counted_qty - input.expected_qty
      // Table added by migration 033 — not in generated types; cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('medication_cycle_counts')
        .insert({
          clinic_id: clinic!.id,
          inventory_id: input.inventory_id,
          expected_qty: input.expected_qty,
          counted_qty: input.counted_qty,
          variance,
          notes: input.notes?.trim() || null,
          counted_by: profile!.id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycle_counts', clinic?.id] })
      toast.success('Comptage enregistré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
