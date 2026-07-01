import { readFileSync } from 'fs'
import { join } from 'path'
import {
  checkDuplicateTherapy,
  checkAllergies,
  checkInventory,
  checkNearExpiry,
  suggestSubstitutions,
  analyzePrescription,
  activeIngredient,
  fold,
  DEFAULT_SAFETY_CONFIG,
  type SafetyMed,
  type CatalogEntry,
} from '../medication-safety'

const NOW = Date.parse('2026-07-01T00:00:00.000Z')

const amox500: SafetyMed = {
  key: '0', medicationId: 'a', name: 'Amoxicilline 500mg gélule/comprimé',
  normalizedName: 'amoxicilline|500mg|gelule', therapeuticClass: 'Anti-bactériens', isActive: true,
}
const amox1g: SafetyMed = {
  key: '1', medicationId: 'b', name: 'Amoxicilline 1g comprimé',
  normalizedName: 'amoxicilline|1g|comprime', therapeuticClass: 'Anti-bactériens', isActive: true,
}
const azithro: SafetyMed = {
  key: '2', medicationId: 'c', name: 'Azithromycine 500mg comprimé',
  normalizedName: 'azithromycine|500mg|comprime', therapeuticClass: 'Anti-bactériens', isActive: true,
}
const paracetamol: SafetyMed = {
  key: '3', medicationId: 'd', name: 'Paracétamol 500mg comprimé',
  normalizedName: 'paracetamol|500mg|comprime', therapeuticClass: 'Antalgiques', isActive: true,
}

// ─── helpers ────────────────────────────────────────────────────────
describe('normalization helpers', () => {
  it('fold strips accents/case/punctuation', () => {
    expect(fold('Pénicilline')).toBe('penicilline')
    expect(fold('Amoxicilline + Acide')).toBe('amoxicillineacide')
  })
  it('activeIngredient reads the DCI from normalized_name', () => {
    expect(activeIngredient('amoxicilline|500mg|gelule')).toBe('amoxicilline')
    expect(activeIngredient(null, 'Doliprane')).toBe('doliprane')
    expect(activeIngredient(undefined, undefined)).toBeNull()
  })
})

// ─── 1. Duplicate therapy ───────────────────────────────────────────
describe('checkDuplicateTherapy', () => {
  it('flags the same product listed twice', () => {
    const w = checkDuplicateTherapy([amox500, { ...amox500, key: 'x' }])
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('duplicate_exact')
    expect(w[0].severity).toBe('warning')
  })

  it('flags the same active ingredient across different products', () => {
    const w = checkDuplicateTherapy([amox500, amox1g])
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('duplicate_ingredient')
    expect(w[0].medication).toBe(amox1g.name)
  })

  it('flags same therapeutic class when enabled (and not otherwise)', () => {
    const on = checkDuplicateTherapy([amox500, azithro], { ...DEFAULT_SAFETY_CONFIG, duplicateByClass: true })
    expect(on.map(x => x.code)).toContain('duplicate_class')

    const off = checkDuplicateTherapy([amox500, azithro], { ...DEFAULT_SAFETY_CONFIG, duplicateByClass: false })
    expect(off).toHaveLength(0)
  })

  it('does not flag distinct medications', () => {
    expect(checkDuplicateTherapy([amox500, paracetamol], { ...DEFAULT_SAFETY_CONFIG, duplicateByClass: true })).toHaveLength(0)
  })
})

// ─── 2. Allergy ─────────────────────────────────────────────────────
describe('checkAllergies', () => {
  it('flags a medication matching a recorded allergy (accent-insensitive)', () => {
    const w = checkAllergies([amox500, paracetamol], ['Amoxicilline'])
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('allergy')
    expect(w[0].severity).toBe('critical')
    expect(w[0].params?.allergy).toBe('Amoxicilline')
    expect(w[0].medication).toBe(amox500.name)
  })

  it('returns nothing when there are no allergies', () => {
    expect(checkAllergies([amox500], null)).toHaveLength(0)
    expect(checkAllergies([amox500], [])).toHaveLength(0)
  })

  it('ignores trivially short allergy terms', () => {
    expect(checkAllergies([amox500], ['ab'])).toHaveLength(0)
  })
})

// ─── 3+4+6. Inventory / formulary ───────────────────────────────────
describe('checkInventory', () => {
  it('flags out of stock when quantity is zero', () => {
    const w = checkInventory(amox500, { stockQuantity: 0, reorderLevel: 5, isActive: true })
    expect(w.map(x => x.code)).toEqual(['out_of_stock'])
  })

  it('treats a missing/inactive inventory line as unavailable', () => {
    expect(checkInventory(amox500, null).map(x => x.code)).toEqual(['out_of_stock'])
    expect(checkInventory(amox500, { stockQuantity: 20, reorderLevel: 5, isActive: false }).map(x => x.code)).toEqual(['out_of_stock'])
  })

  it('flags low stock at or below the reorder level', () => {
    const w = checkInventory(amox500, { stockQuantity: 3, reorderLevel: 5, isActive: true })
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('low_stock')
    expect(w[0].params?.stock).toBe(3)
  })

  it('flags an inactive formulary medication', () => {
    const w = checkInventory({ ...amox500, isActive: false }, { stockQuantity: 10, reorderLevel: 1, isActive: true })
    expect(w.map(x => x.code)).toContain('inactive')
  })

  it('does not check stock for free-text (no medicationId) lines', () => {
    const free: SafetyMed = { key: 'f', medicationId: null, name: 'Sirop maison', isActive: true }
    expect(checkInventory(free, null)).toHaveLength(0)
  })
})

// ─── 5. Near expiry ─────────────────────────────────────────────────
describe('checkNearExpiry', () => {
  it('flags a batch expiring within the window and reports the soonest date', () => {
    const w = checkNearExpiry('Amoxicilline', ['2026-07-15', '2027-01-01', null], NOW)
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('near_expiry')
    expect(w[0].params?.date).toBe('2026-07-15')
  })

  it('does not flag batches expiring beyond the window', () => {
    expect(checkNearExpiry('Amoxicilline', ['2027-06-01'], NOW)).toHaveLength(0)
  })

  it('respects a custom window', () => {
    const cfg = { ...DEFAULT_SAFETY_CONFIG, nearExpiryDays: 7 }
    expect(checkNearExpiry('Amoxicilline', ['2026-07-15'], NOW, cfg)).toHaveLength(0)
    expect(checkNearExpiry('Amoxicilline', ['2026-07-05'], NOW, cfg)).toHaveLength(1)
  })
})

// ─── 7. Substitution suggestions ────────────────────────────────────
describe('suggestSubstitutions', () => {
  const catalog: CatalogEntry[] = [
    { id: 'b', name: 'Amoxicilline 1g comprimé', normalizedName: 'amoxicilline|1g|comprime', therapeuticClass: 'Anti-bactériens', isActive: true },
    { id: 'c', name: 'Azithromycine 500mg comprimé', normalizedName: 'azithromycine|500mg|comprime', therapeuticClass: 'Anti-bactériens', isActive: true },
    { id: 'd', name: 'Paracétamol 500mg comprimé', normalizedName: 'paracetamol|500mg|comprime', therapeuticClass: 'Antalgiques', isActive: true },
    { id: 'e', name: 'Amoxicilline retirée', normalizedName: 'amoxicilline|250mg|comprime', therapeuticClass: 'Anti-bactériens', isActive: false },
  ]
  const target: CatalogEntry = { id: 'a', name: 'Amoxicilline 500mg', normalizedName: 'amoxicilline|500mg|gelule', therapeuticClass: 'Anti-bactériens' }

  it('suggests same-ingredient variants first, then same class; excludes self, inactive and other classes', () => {
    const subs = suggestSubstitutions(target, catalog, new Map([['c', 10]]))
    const ids = subs.map(s => s.id)
    expect(ids).toEqual(['b', 'c'])      // b = ingredient, c = class; d (other class) & e (inactive) excluded
    expect(subs[0].reason).toBe('ingredient')
    expect(subs[1].reason).toBe('class')
  })

  it('ranks in-stock candidates ahead of out-of-stock within a group', () => {
    const c2: CatalogEntry[] = [
      { id: 'x', name: 'Zzz same ingredient (out)', normalizedName: 'amoxicilline|250mg|comprime', therapeuticClass: 'Anti-bactériens', isActive: true },
      { id: 'y', name: 'Aaa same ingredient (in)', normalizedName: 'amoxicilline|100mg|comprime', therapeuticClass: 'Anti-bactériens', isActive: true },
    ]
    const subs = suggestSubstitutions(target, c2, new Map([['x', 0], ['y', 4]]))
    expect(subs[0].id).toBe('y')
    expect(subs[0].inStock).toBe(true)
  })

  it('respects the substitution limit', () => {
    const many: CatalogEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, name: `Amoxicilline variante ${i}`, normalizedName: `amoxicilline|${i}mg|comprime`, therapeuticClass: 'Anti-bactériens', isActive: true,
    }))
    const subs = suggestSubstitutions(target, many, new Map(), { ...DEFAULT_SAFETY_CONFIG, substitutionLimit: 3 })
    expect(subs).toHaveLength(3)
  })
})

// ─── Aggregate ──────────────────────────────────────────────────────
describe('analyzePrescription', () => {
  it('combines duplicate, allergy and per-line stock warnings', () => {
    const inv = new Map([['a', { stockQuantity: 0, reorderLevel: 5, isActive: true }]])
    const w = analyzePrescription([amox500, amox1g], {
      allergies: ['Amoxicilline'],
      inventoryByMedId: inv,
    })
    const codes = w.map(x => x.code)
    expect(codes).toContain('duplicate_ingredient')
    expect(codes).toContain('allergy')
    expect(codes).toContain('out_of_stock')
  })
})

// ─── Safety invariants: read-only, no side effects ──────────────────
describe('safety invariants', () => {
  it('never performs write/DB operations (pure module)', () => {
    const src = readFileSync(join(__dirname, '..', 'medication-safety.ts'), 'utf8')
    expect(src).not.toMatch(/createClient|supabase|\.insert\(|\.update\(|\.delete\(|service_role/)
    expect(src).not.toMatch(/from ['"]@\/lib\/supabase/)
  })

  it('does not mutate its inputs', () => {
    const meds = [amox500, amox1g]
    const snapshot = JSON.stringify(meds)
    checkDuplicateTherapy(meds)
    checkAllergies(meds, ['Amoxicilline'])
    analyzePrescription(meds, { allergies: ['Amoxicilline'] })
    expect(JSON.stringify(meds)).toBe(snapshot)
  })
})
