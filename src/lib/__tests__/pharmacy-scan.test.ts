import {
  normalizeBarcode, formatLocation, expiryStatus, recommendFefoBatch, fefoCheck,
  verifyMedicationScan, cycleCountVariance, matchCatalogByCode,
} from '../pharmacy-scan'

const DAY = 86_400_000
const NOW = Date.parse('2026-07-04T00:00:00Z')

describe('normalizeBarcode', () => {
  it('strips whitespace, spaces and hyphens', () => {
    expect(normalizeBarcode('  340 0123-4567 8 ')).toBe('340012345678')
    expect(normalizeBarcode(null)).toBe('')
  })
})

describe('formatLocation', () => {
  it('joins present parts with hyphens', () => {
    expect(formatLocation({ cabinet: 'A', shelf: '2', row: '3', bin: '5' })).toBe('A-2-3-5')
    expect(formatLocation({ cabinet: 'B', shelf: '1', bin: '4' })).toBe('B-1-4')
  })
  it('is null when empty', () => {
    expect(formatLocation({})).toBeNull()
    expect(formatLocation(null)).toBeNull()
  })
})

describe('expiryStatus', () => {
  it('bands by days remaining', () => {
    expect(expiryStatus('2026-06-04', NOW).level).toBe('expired')          // past
    expect(expiryStatus(new Date(NOW + 5 * DAY).toISOString(), NOW).level).toBe('critical')
    expect(expiryStatus(new Date(NOW + 60 * DAY).toISOString(), NOW).level).toBe('warning')
    expect(expiryStatus(new Date(NOW + 200 * DAY).toISOString(), NOW).level).toBe('ok')
    expect(expiryStatus(null, NOW).level).toBe('none')
  })
  it('reports days left', () => {
    expect(expiryStatus(new Date(NOW + 30 * DAY).toISOString(), NOW).daysLeft).toBe(30)
  })
})

describe('FEFO', () => {
  const batches = [
    { id: 'late', expiry_date: '2027-01-01', quantity_remaining: 10 },
    { id: 'early', expiry_date: '2026-08-01', quantity_remaining: 5 },
    { id: 'empty', expiry_date: '2026-07-10', quantity_remaining: 0 },
  ]
  it('recommends the earliest-expiring batch with stock', () => {
    expect(recommendFefoBatch(batches)?.id).toBe('early') // empty batch ignored despite sooner date
  })
  it('warns when a later batch is chosen over an earlier one', () => {
    const check = fefoCheck('late', batches)
    expect(check.hasEarlier).toBe(true)
    expect(check.recommended?.id).toBe('early')
  })
  it('does not warn when the recommended batch is chosen', () => {
    expect(fefoCheck('early', batches).hasEarlier).toBe(false)
  })
})

describe('verifyMedicationScan', () => {
  const expected = { name: 'Amoxicilline', strength: '500 mg', dosageForm: 'gélule' }

  it('passes an exact match', () => {
    const r = verifyMedicationScan(expected, { name: 'Amoxicilline', strength: '500mg', dosageForm: 'Gelule', isActive: true })
    expect(r.ok).toBe(true)
    expect(r.mismatches).toEqual([])
  })
  it('flags the wrong medication', () => {
    const r = verifyMedicationScan(expected, { name: 'Paracétamol', strength: '500 mg', dosageForm: 'gélule' })
    expect(r.ok).toBe(false)
    expect(r.mismatches).toContain('medication')
  })
  it('flags the wrong strength and form', () => {
    const r = verifyMedicationScan(expected, { name: 'Amoxicilline', strength: '250 mg', dosageForm: 'sirop' })
    expect(r.checks.strength).toBe(false)
    expect(r.checks.form).toBe(false)
    expect(r.checks.medication).toBe(true)
  })
  it('flags an inactive medication', () => {
    const r = verifyMedicationScan({ name: 'Amoxicilline' }, { name: 'Amoxicilline', isActive: false })
    expect(r.mismatches).toContain('active')
  })
  it('flags an expired batch', () => {
    const r = verifyMedicationScan({ name: 'Amoxicilline' }, { name: 'Amoxicilline' }, { batchExpiry: '2026-01-01', nowMs: NOW })
    expect(r.checks.notExpired).toBe(false)
  })
})

describe('cycleCountVariance', () => {
  it('computes actual minus expected', () => {
    expect(cycleCountVariance(100, 96)).toEqual({ expected: 100, actual: 96, difference: -4 })
    expect(cycleCountVariance(20, 25).difference).toBe(5)
  })
})

describe('matchCatalogByCode', () => {
  const catalog = [
    { id: 'a', name: 'Amoxicilline 500mg', barcode: '3400012345678', normalizedName: 'amoxicilline|500mg|gelule' },
    { id: 'p', name: 'Paracétamol 1g', barcode: null, normalizedName: 'paracetamol|1g|comprime' },
  ]
  it('matches by exact barcode', () => {
    expect(matchCatalogByCode('3400012345678', catalog)?.id).toBe('a')
    expect(matchCatalogByCode('340 0012-345678', catalog)?.id).toBe('a') // normalized
  })
  it('falls back to a name match (manual entry)', () => {
    expect(matchCatalogByCode('paracetamol', catalog)?.id).toBe('p')
  })
  it('returns null when nothing matches', () => {
    expect(matchCatalogByCode('9999999999', catalog)).toBeNull()
  })
})
