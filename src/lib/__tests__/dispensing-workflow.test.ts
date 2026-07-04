import {
  stockAfterDispense, isAlmostDepleted, buildVerificationAudit, buildReceiptLines,
} from '../dispensing-workflow'
import { verifyMedicationScan } from '../pharmacy-scan'

describe('stockAfterDispense', () => {
  it('deducts the dispensed quantity', () => {
    expect(stockAfterDispense(100, 10)).toBe(90)
  })
  it('never goes negative', () => {
    expect(stockAfterDispense(5, 20)).toBe(0)
  })
})

describe('isAlmostDepleted', () => {
  it('flags at or below the reorder level', () => {
    expect(isAlmostDepleted(5, 10)).toBe(true)
    expect(isAlmostDepleted(10, 10)).toBe(true)
    expect(isAlmostDepleted(11, 10)).toBe(false)
  })
})

describe('buildVerificationAudit', () => {
  const expected = { name: 'Amoxicilline', strength: '500 mg', dosageForm: 'gélule' }

  it('records a passing camera verification', () => {
    const result = verifyMedicationScan(expected, { name: 'Amoxicilline', strength: '500mg', dosageForm: 'gélule', isActive: true })
    const audit = buildVerificationAudit('camera', result, 'Amoxicilline 500mg')
    expect(audit).toEqual({ verified: true, method: 'camera', mismatches: [], scannedName: 'Amoxicilline 500mg' })
  })

  it('records a failing manual verification with its mismatches', () => {
    const result = verifyMedicationScan(expected, { name: 'Paracétamol', strength: '500 mg', dosageForm: 'gélule' })
    const audit = buildVerificationAudit('manual', result, 'Paracétamol')
    expect(audit.verified).toBe(false)
    expect(audit.method).toBe('manual')
    expect(audit.mismatches).toContain('medication')
  })

  it('records a skipped (no-scan) verification', () => {
    expect(buildVerificationAudit('none', null, null)).toEqual({
      verified: false, method: 'none', mismatches: [], scannedName: null,
    })
  })
})

describe('buildReceiptLines', () => {
  const meds = [
    { name: 'Amoxicilline 500mg', dosage: '1 gél.', frequency: '3x/j', duration: '7j', instructions: 'Après repas' },
    { name: 'Paracétamol 1g', dosage: '1 cp', frequency: 'si douleur', duration: '', instructions: '' },
    { name: 'Ibuprofène 400mg', dosage: '1 cp', frequency: '2x/j', duration: '5j' },
  ]

  it('aggregates dispensed quantity per line and excludes unavailable', () => {
    const lines = buildReceiptLines(meds, [
      { prescription_line_index: 0, quantity_dispensed: 14, status: 'partial' },
      { prescription_line_index: 0, quantity_dispensed: 7, status: 'dispensed' },
      { prescription_line_index: 1, quantity_dispensed: 0, status: 'unavailable' },
      { prescription_line_index: 2, quantity_dispensed: 10, status: 'dispensed' },
    ])
    // line 0 total 21, line 1 excluded (unavailable/0), line 2 = 10
    expect(lines.map(l => [l.index, l.dispensedQty])).toEqual([[0, 21], [2, 10]])
    expect(lines[0].posology).toBe('1 gél. · 3x/j · 7j')
    expect(lines[0].instructions).toBe('Après repas')
  })

  it('returns nothing when nothing was dispensed', () => {
    expect(buildReceiptLines(meds, [{ prescription_line_index: 0, quantity_dispensed: 0, status: 'unavailable' }])).toEqual([])
  })
})
