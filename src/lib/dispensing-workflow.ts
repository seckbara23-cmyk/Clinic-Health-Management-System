// ── Smart Dispensing workflow (pure) ──────────────────────────────
//
// Deterministic helpers layered on top of Phase 10A's scan logic
// (src/lib/pharmacy-scan.ts) and the existing dispensing RPC. No DB, no React.
// Nothing here writes, blocks, or auto-substitutes — it computes the operational
// facts the guided UI shows (stock-after, depletion, receipt, audit payload).

import type { VerifyResult, VerifyCheck } from './pharmacy-scan'

/** How the pharmacist verified the medication. USB/Bluetooth "wedge" scanners
 *  type into the manual input, so they map to 'manual' — same code path. */
export type VerificationMethod = 'camera' | 'manual' | 'none'

/** Stock left after dispensing `quantity` (never negative). */
export function stockAfterDispense(currentStock: number, quantity: number): number {
  const s = Number.isFinite(currentStock) ? currentStock : 0
  const q = Number.isFinite(quantity) ? quantity : 0
  return Math.max(0, s - q)
}

/** True when the remaining stock is at or below the reorder level. */
export function isAlmostDepleted(stockAfter: number, reorderLevel: number): boolean {
  return stockAfter <= (Number.isFinite(reorderLevel) ? reorderLevel : 0)
}

// ── Verification audit payload ─────────────────────────────────────
export interface VerificationAudit {
  verified: boolean
  method: VerificationMethod
  mismatches: VerifyCheck[]
  scannedName: string | null
}

/** Compose the immutable audit row for a scan verification (or a skipped one). */
export function buildVerificationAudit(
  method: VerificationMethod,
  result: VerifyResult | null,
  scannedName: string | null,
): VerificationAudit {
  if (!result) return { verified: false, method, mismatches: [], scannedName }
  return { verified: result.ok, method, mismatches: result.mismatches, scannedName }
}

// ── Printable receipt ──────────────────────────────────────────────
export interface RxMedLite {
  name: string
  dosage?: string | null
  frequency?: string | null
  duration?: string | null
  instructions?: string | null
}
export interface DispenseLite {
  prescription_line_index: number
  quantity_dispensed: number
  status: string
}
export interface ReceiptLine {
  index: number
  name: string
  posology: string
  instructions: string
  dispensedQty: number
}

/**
 * Build the dispensed-medication lines for a receipt: one line per prescription
 * medication that had a non-zero dispensing, with the total quantity dispensed
 * across (possibly partial) events. `unavailable` events are excluded.
 */
export function buildReceiptLines(meds: RxMedLite[], dispensings: DispenseLite[]): ReceiptLine[] {
  const dispensedByLine = new Map<number, number>()
  for (const d of dispensings) {
    if (d.status === 'unavailable') continue
    dispensedByLine.set(d.prescription_line_index, (dispensedByLine.get(d.prescription_line_index) ?? 0) + (d.quantity_dispensed || 0))
  }
  const lines: ReceiptLine[] = []
  meds.forEach((m, index) => {
    const qty = dispensedByLine.get(index) ?? 0
    if (qty <= 0) return
    lines.push({
      index,
      name: m.name,
      posology: [m.dosage, m.frequency, m.duration].filter(Boolean).join(' · '),
      instructions: m.instructions?.trim() || '',
      dispensedQty: qty,
    })
  })
  return lines
}
