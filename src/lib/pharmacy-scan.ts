// ── Smart Pharmacy scan logic (pure) ──────────────────────────────
//
// Deterministic, dependency-free helpers for barcode-assisted pharmacy flows:
// barcode normalization, shelf-location formatting, expiry status, FEFO
// (first-expiry-first-out) guidance, scan verification, and cycle-count
// variance. No DB, no React, no scanner — safe to unit test in isolation.
//
// The scanner (camera / USB / Bluetooth) is only an INPUT. It never writes and
// never auto-corrects: verification returns findings for the UI to warn on.

const DAY_MS = 86_400_000

/** Strip whitespace and hyphens a scanner or formatter may emit. */
export function normalizeBarcode(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, '').replace(/-/g, '')
}

// Fold a medication name/strength/form for tolerant comparison: lowercase,
// strip accents and non-alphanumerics.
function fold(s: string | null | undefined): string {
  if (!s) return ''
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// ── Shelf / bin location ───────────────────────────────────────────
export interface ShelfLocation {
  cabinet?: string | null
  shelf?: string | null
  row?: string | null
  bin?: string | null
}

/** "A-2-3-5" from its parts, skipping blanks. Null when nothing is set. */
export function formatLocation(loc: ShelfLocation | null | undefined): string | null {
  if (!loc) return null
  const parts = [loc.cabinet, loc.shelf, loc.row, loc.bin]
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
  return parts.length ? parts.join('-') : null
}

// ── Expiry status (color-coded audit) ──────────────────────────────
export type ExpiryLevel = 'none' | 'expired' | 'critical' | 'warning' | 'ok'
export interface ExpiryStatus { daysLeft: number | null; level: ExpiryLevel }

export interface ExpiryConfig { criticalDays: number; warningDays: number }
export const DEFAULT_EXPIRY_CONFIG: ExpiryConfig = { criticalDays: 30, warningDays: 90 }

/**
 * Days until expiry and a severity band. `expiry` is a date string (YYYY-MM-DD
 * or ISO). `nowMs` is injected so the function stays pure/deterministic.
 */
export function expiryStatus(
  expiry: string | null | undefined,
  nowMs: number,
  cfg: ExpiryConfig = DEFAULT_EXPIRY_CONFIG,
): ExpiryStatus {
  if (!expiry) return { daysLeft: null, level: 'none' }
  const t = Date.parse(expiry)
  if (Number.isNaN(t)) return { daysLeft: null, level: 'none' }
  const daysLeft = Math.floor((t - nowMs) / DAY_MS)
  let level: ExpiryLevel
  if (daysLeft < 0) level = 'expired'
  else if (daysLeft <= cfg.criticalDays) level = 'critical'
  else if (daysLeft <= cfg.warningDays) level = 'warning'
  else level = 'ok'
  return { daysLeft, level }
}

// ── FEFO (first-expiry, first-out) ─────────────────────────────────
export interface ScanBatch {
  id: string
  expiry_date: string | null
  quantity_remaining: number
}

/** Earliest-expiring batch that still has stock, or null. Deterministic. */
export function recommendFefoBatch(batches: ScanBatch[]): ScanBatch | null {
  const eligible = batches
    .filter(b => b.quantity_remaining > 0 && b.expiry_date)
    .sort((a, b) => {
      const d = Date.parse(a.expiry_date!) - Date.parse(b.expiry_date!)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
  return eligible[0] ?? null
}

export interface FefoCheck { recommended: ScanBatch | null; hasEarlier: boolean }

/**
 * Given the batch the user chose/scanned, is there an earlier-expiring batch in
 * stock they should use first? Never blocks — override is always allowed.
 */
export function fefoCheck(scannedBatchId: string | null, batches: ScanBatch[]): FefoCheck {
  const recommended = recommendFefoBatch(batches)
  if (!recommended || !scannedBatchId || recommended.id === scannedBatchId) {
    return { recommended, hasEarlier: false }
  }
  const scanned = batches.find(b => b.id === scannedBatchId)
  const hasEarlier = !!scanned?.expiry_date && !!recommended.expiry_date
    && Date.parse(recommended.expiry_date) < Date.parse(scanned.expiry_date)
  return { recommended, hasEarlier }
}

// ── Scan verification (never auto-corrects) ────────────────────────
export interface ScanExpectation {
  name: string
  strength?: string | null
  dosageForm?: string | null
}
export interface ScannedMedication {
  name: string
  strength?: string | null
  dosageForm?: string | null
  isActive?: boolean
}

export type VerifyCheck = 'medication' | 'strength' | 'form' | 'active' | 'notExpired'
export interface VerifyResult {
  ok: boolean
  checks: Record<VerifyCheck, boolean>
  mismatches: VerifyCheck[]
}

/**
 * Verify a scanned medication against the prescribed expectation. Returns a
 * per-field pass/fail map; the UI shows a large warning on any mismatch. Fields
 * the expectation does not specify are treated as satisfied.
 */
export function verifyMedicationScan(
  expected: ScanExpectation,
  scanned: ScannedMedication,
  opts: { batchExpiry?: string | null; nowMs?: number } = {},
): VerifyResult {
  const nameOk = fold(expected.name) === fold(scanned.name)
    || fold(scanned.name).includes(fold(expected.name))
    || fold(expected.name).includes(fold(scanned.name))
  const strengthOk = !expected.strength || fold(expected.strength) === fold(scanned.strength)
  const formOk = !expected.dosageForm || fold(expected.dosageForm) === fold(scanned.dosageForm)
  const activeOk = scanned.isActive !== false
  const notExpired = opts.batchExpiry == null
    ? true
    : expiryStatus(opts.batchExpiry, opts.nowMs ?? 0).level !== 'expired'

  const checks: Record<VerifyCheck, boolean> = {
    medication: nameOk, strength: strengthOk, form: formOk, active: activeOk, notExpired,
  }
  const mismatches = (Object.keys(checks) as VerifyCheck[]).filter(k => !checks[k])
  return { ok: mismatches.length === 0, checks, mismatches }
}

// ── Cycle counting ─────────────────────────────────────────────────
export interface CycleVariance { expected: number; actual: number; difference: number }
export function cycleCountVariance(expected: number, actual: number): CycleVariance {
  const e = Number.isFinite(expected) ? expected : 0
  const a = Number.isFinite(actual) ? actual : 0
  return { expected: e, actual: a, difference: a - e }
}

// ── Catalog lookup by scanned code ─────────────────────────────────
export interface ScanCatalogEntry {
  id: string
  name: string
  barcode?: string | null
  normalizedName?: string | null
}

/**
 * Resolve a scanned code to a catalogue medication: exact barcode match first,
 * then a folded name / normalized-name contains match (so a typed name via the
 * manual-entry fallback also resolves). Returns null when nothing matches.
 */
export function matchCatalogByCode(code: string, catalog: ScanCatalogEntry[]): ScanCatalogEntry | null {
  const norm = normalizeBarcode(code)
  if (!norm) return null
  const byBarcode = catalog.find(m => m.barcode && normalizeBarcode(m.barcode) === norm)
  if (byBarcode) return byBarcode
  const folded = fold(norm)
  if (folded.length < 2) return null
  return catalog.find(m => fold(m.name).includes(folded) || fold(m.normalizedName).includes(folded)) ?? null
}
