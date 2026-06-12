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
