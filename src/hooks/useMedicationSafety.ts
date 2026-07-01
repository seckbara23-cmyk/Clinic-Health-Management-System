import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { useMedicationCatalog } from '@/hooks/useMedications'
import { useInventory } from '@/hooks/usePharmacy'
import {
  analyzePrescription, suggestSubstitutions, checkInventory, checkNearExpiry,
  DEFAULT_SAFETY_CONFIG,
  type SafetyMed, type SafetyWarning, type InventorySnapshot, type CatalogEntry, type Substitution, type SafetyConfig,
} from '@/lib/medication-safety'
import type { CatalogMedication } from '@/types/database'

/**
 * Read-only patient allergy list for the safety layer. Scoped to the clinic
 * under RLS (no service role). Selects only the `allergies` column.
 */
export function usePatientAllergies(patientId?: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['patient_allergies', clinic?.id, patientId ?? ''],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('allergies')
        .eq('id', patientId!)
        .eq('clinic_id', clinic!.id)
        .maybeSingle()
      if (error) throw error
      return (data?.allergies ?? []) as string[]
    },
  })
}

type MedLine = { medication_id?: string | null; name: string }

/**
 * Shared safety context — loads the global formulary + this clinic's inventory
 * (both RLS-scoped, read-only) and exposes resolvers/analysers built on the
 * pure `medication-safety` module. Nothing here writes.
 */
export function useMedicationSafety(config: SafetyConfig = DEFAULT_SAFETY_CONFIG) {
  const { data: catalog } = useMedicationCatalog()
  const { data: inventory } = useInventory(true)

  return useMemo(() => {
    const catalogById = new Map<string, CatalogMedication>()
    const catalogEntries: CatalogEntry[] = []
    for (const m of catalog ?? []) {
      catalogById.set(m.id, m)
      catalogEntries.push({
        id: m.id, name: m.name, normalizedName: m.normalized_name ?? null,
        therapeuticClass: m.therapeutic_class ?? null, isActive: m.is_active,
      })
    }

    const invByMedId = new Map<string, InventorySnapshot>()
    const stockByMedId = new Map<string, number>()
    for (const line of inventory ?? []) {
      if (!line.medication_id) continue
      invByMedId.set(line.medication_id, {
        stockQuantity: line.stock_quantity,
        reorderLevel: line.reorder_level,
        isActive: line.is_active,
      })
      // Substitution ranking only cares about "actually available" stock.
      stockByMedId.set(line.medication_id, line.is_active ? line.stock_quantity : 0)
    }

    const ready = !!catalog && !!inventory

    // Turn a prescription/dispense line into an analysable SafetyMed by pulling
    // normalized_name / class / active flag from the catalogue when linked.
    function resolveMed(line: MedLine, key: string): SafetyMed {
      const cat = line.medication_id ? catalogById.get(line.medication_id) : undefined
      return {
        key,
        medicationId: line.medication_id ?? null,
        name: line.name || cat?.name || '',
        normalizedName: cat?.normalized_name ?? null,
        therapeuticClass: cat?.therapeutic_class ?? null,
        isActive: cat ? cat.is_active : undefined,
      }
    }

    // Duplicate + allergy + per-line stock/formulary warnings for a set of lines.
    function analyzeLines(lines: MedLine[], allergies?: string[] | null): SafetyWarning[] {
      if (!ready) return [] // avoid false "out of stock" before inventory loads
      const meds = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => (l.name?.trim() || l.medication_id))
        .map(({ l, i }) => resolveMed(l, String(i))) // key = original line index
      return analyzePrescription(meds, { allergies, inventoryByMedId: invByMedId, config })
    }

    // Stock + formulary warnings for a single medication (drawer / dispense line).
    function analyzeSingle(line: MedLine, allergies?: string[] | null): SafetyWarning[] {
      if (!ready) return [] // avoid false "out of stock" before inventory loads
      const med = resolveMed(line, '0')
      const inv = med.medicationId ? invByMedId.get(med.medicationId) ?? null : null
      const out = checkInventory(med, inv)
      if (allergies?.length) {
        const allergyWarnings = analyzePrescription([med], { allergies, config }).filter(w => w.code === 'allergy')
        out.push(...allergyWarnings)
      }
      return out
    }

    // Near-expiry warnings from a set of batch expiry dates for one medication.
    function analyzeExpiry(medName: string, expiries: Array<string | null | undefined>, nowMs: number): SafetyWarning[] {
      return checkNearExpiry(medName, expiries, nowMs, config)
    }

    // Alternatives for an unavailable medication.
    function substitutionsFor(medicationId: string | null | undefined): Substitution[] {
      if (!medicationId) return []
      const target = catalogById.get(medicationId)
      if (!target) return []
      return suggestSubstitutions(
        { id: target.id, name: target.name, normalizedName: target.normalized_name ?? null, therapeuticClass: target.therapeutic_class ?? null },
        catalogEntries, stockByMedId, config,
      )
    }

    return { ready, catalogById, invByMedId, stockByMedId, resolveMed, analyzeLines, analyzeSingle, analyzeExpiry, substitutionsFor }
  }, [catalog, inventory, config])
}
