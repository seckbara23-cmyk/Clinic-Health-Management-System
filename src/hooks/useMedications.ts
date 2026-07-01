import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
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
        .select('id, name, strength, dosage_form, therapeutic_class, source, is_active, created_at, updated_at')
        .order('name', { ascending: true })
        .limit(5000)
      if (error) throw error
      return data as CatalogMedication[]
    },
  })
}
