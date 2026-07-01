/**
 * Medication Safety Layer 1 — pure, deterministic safety checks.
 *
 * Phase 8. This module NEVER writes, blocks, prescribes, or diagnoses. It only
 * inspects already-loaded (RLS-scoped) data and returns structured WARNINGS the
 * UI renders. It has no Supabase/network/React dependency — every function is a
 * pure transformation of its inputs, which makes it unit-testable in isolation
 * and safe to run on each keystroke.
 *
 * The UI maps `code` → a localized message (namespace `medicationSafety`);
 * severity → colour (critical = red, warning = amber, info = blue).
 */

// ─── Types ──────────────────────────────────────────────────────────
export type SafetySeverity = 'critical' | 'warning' | 'info'

export type SafetyCode =
  | 'duplicate_exact'       // same product listed twice
  | 'duplicate_ingredient'  // same active ingredient (DCI) twice
  | 'duplicate_class'       // same therapeutic class twice (configurable)
  | 'allergy'               // matches a recorded patient allergy
  | 'out_of_stock'          // not stocked / quantity <= 0
  | 'low_stock'             // stock at or below reorder level
  | 'near_expiry'           // a batch expires within the window
  | 'inactive'              // medication inactive in the formulary

export interface SafetyWarning {
  code: SafetyCode
  severity: SafetySeverity
  /** Display name of the medication the warning is about. */
  medication: string
  /** Key of the source line (SafetyMed.key), when available — for per-line grouping. */
  key?: string
  /** Structured params for the localized message (allergy, class, stock, date…). */
  params?: Record<string, string | number>
}

/** One medication under analysis (a prescription line or a catalogue row). */
export interface SafetyMed {
  /** Stable key for the line (index or row id) — used only by callers. */
  key: string
  medicationId: string | null
  name: string
  normalizedName?: string | null
  therapeuticClass?: string | null
  /** Formulary active flag (from the catalogue). */
  isActive?: boolean
}

export interface InventorySnapshot {
  stockQuantity: number
  reorderLevel: number
  isActive: boolean
}

/** A catalogue entry usable as a substitution candidate. */
export interface CatalogEntry {
  id: string
  name: string
  normalizedName?: string | null
  therapeuticClass?: string | null
  isActive?: boolean
}

export interface Substitution {
  id: string
  name: string
  inStock: boolean
  stock: number
  /** Why it was suggested: shares the active ingredient, or the class. */
  reason: 'ingredient' | 'class'
}

export interface SafetyConfig {
  /** Also flag two medications sharing a therapeutic class. */
  duplicateByClass: boolean
  /** A batch expiring within this many days is "near expiry". */
  nearExpiryDays: number
  /** Max substitution suggestions returned. */
  substitutionLimit: number
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  duplicateByClass: true,
  nearExpiryDays: 90,
  substitutionLimit: 5,
}

const SEVERITY: Record<SafetyCode, SafetySeverity> = {
  duplicate_exact: 'warning',
  duplicate_ingredient: 'warning',
  duplicate_class: 'warning',
  allergy: 'critical',
  out_of_stock: 'warning',
  low_stock: 'warning',
  near_expiry: 'warning',
  inactive: 'warning',
}

// ─── Normalization helpers ──────────────────────────────────────────
/** Lowercase, strip accents/diacritics and non-alphanumerics for matching. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Active ingredient (DCI) key from a `dci|strength|form` normalized_name
 * (migration 032). Falls back to the folded name when unavailable.
 */
export function activeIngredient(normalizedName?: string | null, name?: string): string | null {
  if (normalizedName && normalizedName.includes('|')) {
    const dci = normalizedName.split('|')[0]?.trim()
    if (dci) return dci
  }
  if (normalizedName && normalizedName.trim()) return fold(normalizedName)
  if (name && name.trim()) return fold(name)
  return null
}

function warn(code: SafetyCode, medication: string, params?: SafetyWarning['params'], key?: string): SafetyWarning {
  return { code, severity: SEVERITY[code], medication, ...(key ? { key } : {}), ...(params ? { params } : {}) }
}

// ─── 1. Duplicate therapy ───────────────────────────────────────────
/**
 * Flag medications that duplicate an earlier line: same product, same active
 * ingredient, or (when enabled) same therapeutic class. Emits at most one
 * warning per line, choosing the most specific code.
 */
export function checkDuplicateTherapy(
  meds: SafetyMed[],
  config: SafetyConfig = DEFAULT_SAFETY_CONFIG,
): SafetyWarning[] {
  const out: SafetyWarning[] = []
  const seenProduct = new Set<string>()
  const seenIngredient = new Set<string>()
  const seenClass = new Set<string>()

  for (const m of meds) {
    const productKey = m.medicationId ?? `name:${fold(m.name)}`
    const ingredient = activeIngredient(m.normalizedName, m.name)
    const cls = m.therapeuticClass?.trim() || null

    if (productKey && seenProduct.has(productKey)) {
      out.push(warn('duplicate_exact', m.name, undefined, m.key))
      continue
    }
    seenProduct.add(productKey)

    if (ingredient) {
      if (seenIngredient.has(ingredient)) {
        out.push(warn('duplicate_ingredient', m.name, undefined, m.key))
        continue
      }
      seenIngredient.add(ingredient)
    }

    if (config.duplicateByClass && cls) {
      if (seenClass.has(cls)) {
        out.push(warn('duplicate_class', m.name, { class: cls }, m.key))
        continue
      }
      seenClass.add(cls)
    }
  }
  return out
}

// ─── 2. Allergy ─────────────────────────────────────────────────────
/**
 * Match each medication against the patient's recorded allergies. Uses folded
 * substring matching on both the product name and the active-ingredient key so
 * e.g. an "Amoxicilline" allergy flags "Amoxicilline 500mg gélule". Warnings,
 * never a block.
 */
export function checkAllergies(meds: SafetyMed[], allergies: string[] | null | undefined): SafetyWarning[] {
  const terms = (allergies ?? [])
    .map(a => ({ raw: a.trim(), folded: fold(a) }))
    .filter(a => a.folded.length >= 3)
  if (terms.length === 0) return []

  const out: SafetyWarning[] = []
  for (const m of meds) {
    const foldedName = fold(m.name)
    const ing = activeIngredient(m.normalizedName, m.name) ?? ''
    for (const term of terms) {
      const hit =
        foldedName.includes(term.folded) ||
        (ing.length >= 3 && (ing.includes(term.folded) || term.folded.includes(ing)))
      if (hit) {
        out.push(warn('allergy', m.name, { allergy: term.raw }, m.key))
        break // one allergy warning per medication line is enough
      }
    }
  }
  return out
}

// ─── 3+4+6. Inventory / formulary status ────────────────────────────
/**
 * Stock and formulary warnings for one medication: inactive formulary entry,
 * out-of-stock (not stocked, inactive line, or quantity <= 0), and low stock
 * (at/below reorder level). Free-text lines (no medicationId) get no stock
 * check — the clinic inventory can't be resolved for them.
 */
export function checkInventory(
  med: SafetyMed,
  inv: InventorySnapshot | null,
): SafetyWarning[] {
  const out: SafetyWarning[] = []

  if (med.isActive === false) out.push(warn('inactive', med.name, undefined, med.key))

  if (med.medicationId) {
    const available = inv && inv.isActive ? inv.stockQuantity : 0
    if (available <= 0) {
      out.push(warn('out_of_stock', med.name, undefined, med.key))
    } else if (inv && available <= inv.reorderLevel) {
      out.push(warn('low_stock', med.name, { stock: available }, med.key))
    }
  }
  return out
}

// ─── 5. Near expiry ─────────────────────────────────────────────────
/**
 * Flag a medication whose soonest batch expiry falls within the window
 * (already-expired batches included). `nowMs`/expiries are passed in so the
 * function stays pure and deterministic.
 */
export function checkNearExpiry(
  medName: string,
  expiries: Array<string | null | undefined>,
  nowMs: number,
  config: SafetyConfig = DEFAULT_SAFETY_CONFIG,
): SafetyWarning[] {
  const cutoff = nowMs + config.nearExpiryDays * 86_400_000
  let soonest: number | null = null
  for (const e of expiries) {
    if (!e) continue
    const t = Date.parse(e)
    if (Number.isNaN(t)) continue
    if (t <= cutoff && (soonest === null || t < soonest)) soonest = t
  }
  if (soonest === null) return []
  return [warn('near_expiry', medName, { date: new Date(soonest).toISOString().slice(0, 10) })]
}

// ─── 7. Substitution suggestions ────────────────────────────────────
/**
 * Suggest alternatives for an unavailable medication: first products sharing
 * the active ingredient (variants), then products in the same therapeutic
 * class. In-stock candidates rank first. Suggestion only — never auto-applied.
 */
export function suggestSubstitutions(
  target: CatalogEntry,
  catalog: CatalogEntry[],
  stockByMedId: Map<string, number>,
  config: SafetyConfig = DEFAULT_SAFETY_CONFIG,
): Substitution[] {
  const targetIng = activeIngredient(target.normalizedName, target.name)
  const candidates = catalog.filter(c => c.id !== target.id && c.isActive !== false)

  const toSub = (c: CatalogEntry, reason: Substitution['reason']): Substitution => {
    const stock = stockByMedId.get(c.id) ?? 0
    return { id: c.id, name: c.name, inStock: stock > 0, stock, reason }
  }
  const rank = (a: Substitution, b: Substitution) =>
    Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name)

  const sameIngredient = targetIng
    ? candidates.filter(c => activeIngredient(c.normalizedName, c.name) === targetIng).map(c => toSub(c, 'ingredient')).sort(rank)
    : []

  const ingredientIds = new Set(sameIngredient.map(s => s.id))
  const sameClass = target.therapeuticClass
    ? candidates
        .filter(c => c.therapeuticClass === target.therapeuticClass && !ingredientIds.has(c.id))
        .map(c => toSub(c, 'class'))
        .sort(rank)
    : []

  return [...sameIngredient, ...sameClass].slice(0, config.substitutionLimit)
}

// ─── Aggregate: prescription-time analysis ──────────────────────────
/**
 * Convenience aggregator for the prescription-creation surface: duplicate +
 * allergy across the whole list, plus per-line stock/formulary warnings.
 * Pure — resolution of catalogue/inventory happens in the caller.
 */
export function analyzePrescription(
  meds: SafetyMed[],
  opts: {
    allergies?: string[] | null
    inventoryByMedId?: Map<string, InventorySnapshot>
    config?: SafetyConfig
  } = {},
): SafetyWarning[] {
  const config = opts.config ?? DEFAULT_SAFETY_CONFIG
  const out: SafetyWarning[] = []
  out.push(...checkDuplicateTherapy(meds, config))
  out.push(...checkAllergies(meds, opts.allergies))
  for (const m of meds) {
    const inv = m.medicationId ? opts.inventoryByMedId?.get(m.medicationId) ?? null : null
    out.push(...checkInventory(m, inv))
  }
  return out
}
