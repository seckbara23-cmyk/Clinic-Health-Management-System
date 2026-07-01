import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { CatalogMedication } from '@/types/database'

// Search the global medication formulary (migration 029). Active only,
// case-insensitive name match, capped for the picker dropdown. Disabled until
// the query has ≥2 chars to avoid pulling the whole list on focus.
export function useMedications(search: string) {
  const supabase = createClient()
  const term = search.trim()
  return useQuery({
    queryKey: ['medications', term],
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medications')
        .select('id, name, strength, dosage_form, is_active, created_at, updated_at')
        .eq('is_active', true)
        .ilike('name', `%${term}%`)
        .order('name', { ascending: true })
        .limit(15)
      if (error) throw error
      return data as CatalogMedication[]
    },
  })
}

// Full global formulary for the catalog page (migrations 029 + 032). Includes
// inactive rows and the therapeutic_class/source metadata so the page can drive
// its own search, filters and KPIs client-side. Read-only; RLS lets any
// authenticated clinic user SELECT (only super_admin may write). ~800–1500 rows
// total, well under PostgREST's default cap; ordered by name for a stable list.
export function useMedicationCatalog() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['medications_catalog'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medications')
        .select('id, name, strength, dosage_form, therapeutic_class, source, normalized_name, is_active, created_at, updated_at')
        .order('name', { ascending: true })
        .limit(5000)
      if (error) throw error
      return data as CatalogMedication[]
    },
  })
}

export interface MedicationUsage {
  inInventory: boolean
  inventoryId: string | null
  stockQuantity: number | null
  inventoryActive: boolean | null
  prescriptionCount: number
  recentDispensingCount: number
}

// Read-only usage context for one catalogued medication, scoped to the current
// clinic under RLS (no service role). Combines three independent reads:
//   • the clinic's inventory line (stock + active), if the med is stocked
//   • how many of the clinic's prescriptions reference this medication_id
//   • how many dispensing events used it in the last 90 days
// Purely informational — touches no inventory/batch/dispensing WRITE path.
export function useMedicationUsage(medicationId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['medication_usage', clinic?.id, medicationId ?? ''],
    enabled: !!clinic?.id && !!medicationId,
    staleTime: 60_000,
    queryFn: async (): Promise<MedicationUsage> => {
      const clinicId = clinic!.id
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()

      const [invRes, rxRes, dispRes] = await Promise.all([
        supabase
          .from('clinic_medication_inventory')
          .select('id, stock_quantity, is_active')
          .eq('clinic_id', clinicId)
          .eq('medication_id', medicationId!)
          .is('deleted_at', null)
          .maybeSingle(),
        supabase
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .contains('medications', [{ medication_id: medicationId! }]),
        supabase
          .from('medication_dispensings')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .eq('medication_id', medicationId!)
          .is('deleted_at', null)
          .gt('quantity_dispensed', 0)
          .gte('created_at', cutoff),
      ])

      if (invRes.error) throw invRes.error
      if (rxRes.error) throw rxRes.error
      if (dispRes.error) throw dispRes.error

      const inv = invRes.data as { id: string; stock_quantity: number; is_active: boolean } | null
      return {
        inInventory: !!inv,
        inventoryId: inv?.id ?? null,
        stockQuantity: inv?.stock_quantity ?? null,
        inventoryActive: inv?.is_active ?? null,
        prescriptionCount: rxRes.count ?? 0,
        recentDispensingCount: dispRes.count ?? 0,
      }
    },
  })
}
