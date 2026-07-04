import {
  nextLabStatuses, orderCriticality, isAwaitingReview, labKpis, filterLabOrders,
  buildLabBriefing, buildSampleLabel, displaySampleId, matchLabOrderByCode,
  canCreateLab, canResultLab, canReviewLab, labWorkspaceRestricted, labCapabilities,
  type LabOrderLite,
} from '../lab-workflow'
import { readFileSync } from 'fs'
import { join } from 'path'

const NOW = Date.parse('2026-07-04T12:00:00Z')

function order(o: Partial<LabOrderLite> = {}): LabOrderLite {
  return { id: 'o1234567-aaaa', status: 'ordered', priority: 'normal', created_at: '2026-07-04T08:00:00Z', items: [], ...o }
}

describe('nextLabStatuses (progression)', () => {
  it('follows the ordered → collected → in-progress → completed path', () => {
    expect(nextLabStatuses('ordered', false)).toEqual(['sample_collected', 'sample_rejected', 'cancelled'])
    expect(nextLabStatuses('sample_collected', false)).toEqual(['in_progress', 'sample_rejected'])
    expect(nextLabStatuses('sample_rejected', false)).toEqual(['sample_collected'])
    expect(nextLabStatuses('in_progress', false)).toEqual([]) // not all resulted
    expect(nextLabStatuses('in_progress', true)).toEqual(['completed'])
    expect(nextLabStatuses('completed', true)).toEqual([])
    expect(nextLabStatuses('reviewed', true)).toEqual([])
  })
})

describe('orderCriticality + critical visibility', () => {
  it('detects a critical resulted item', () => {
    const c = orderCriticality(order({ items: [
      { flag: 'normal', result_value: '5' },
      { flag: 'critical', result_value: '99' },
    ] }))
    expect(c).toEqual({ hasCritical: true, hasAbnormal: false, level: 'critical' })
  })
  it('detects abnormal (high/low/abnormal) but not critical', () => {
    expect(orderCriticality(order({ items: [{ flag: 'high', result_value: '12' }] })).level).toBe('abnormal')
  })
  it('ignores unresulted items', () => {
    expect(orderCriticality(order({ items: [{ flag: 'critical', result_value: null }] })).level).toBe('none')
  })
})

describe('isAwaitingReview (completed-unreviewed queue)', () => {
  it('is true only for completed orders', () => {
    expect(isAwaitingReview(order({ status: 'completed' }))).toBe(true)
    expect(isAwaitingReview(order({ status: 'reviewed' }))).toBe(false)
    expect(isAwaitingReview(order({ status: 'in_progress' }))).toBe(false)
  })
})

describe('labKpis', () => {
  it('counts each workflow bucket', () => {
    const orders = [
      order({ status: 'ordered' }),
      order({ status: 'sample_collected' }),
      order({ status: 'in_progress' }),
      order({ status: 'completed', completed_at: '2026-07-04T09:00:00Z', items: [{ flag: 'high', result_value: '9' }] }),
      order({ status: 'reviewed', completed_at: '2026-07-01T09:00:00Z' }),
    ]
    const k = labKpis(orders, '2026-07-04')
    expect(k.pending).toBe(1)
    expect(k.collected).toBe(1)
    expect(k.inProgress).toBe(1)
    expect(k.awaitingReview).toBe(1)
    expect(k.completedToday).toBe(1)      // only the one completed today
    expect(k.criticalAbnormal).toBe(1)    // the high result
  })
})

describe('filterLabOrders', () => {
  const orders = [
    order({ id: 'a', status: 'ordered' }),
    order({ id: 'b', status: 'sample_collected' }),
    order({ id: 'c', status: 'in_progress' }),
    order({ id: 'd', status: 'completed', items: [{ flag: 'critical', result_value: '1' }] }),
    order({ id: 'e', status: 'reviewed' }),
  ]
  it('scopes to each filter', () => {
    expect(filterLabOrders(orders, 'pending').map(o => o.id)).toEqual(['a'])
    expect(filterLabOrders(orders, 'awaiting_review').map(o => o.id)).toEqual(['d'])
    expect(filterLabOrders(orders, 'completed').map(o => o.id)).toEqual(['d', 'e'])
    expect(filterLabOrders(orders, 'critical').map(o => o.id)).toEqual(['d'])
    expect(filterLabOrders(orders, 'all')).toHaveLength(5)
  })
})

describe('buildLabBriefing', () => {
  it('summarizes pending / urgent / awaiting-review / critical / longest wait', () => {
    const b = buildLabBriefing([
      order({ status: 'ordered', priority: 'emergency', created_at: '2026-07-04T06:00:00Z' }),
      order({ status: 'in_progress', priority: 'urgent', created_at: '2026-07-03T12:00:00Z' }),
      order({ status: 'completed' }),
      order({ status: 'completed', items: [{ flag: 'critical', result_value: '5' }] }),
    ], NOW)
    expect(b.pending).toBe(1)
    expect(b.urgent).toBe(2)          // emergency (ordered) + urgent (in_progress)
    expect(b.awaitingReview).toBe(2)
    expect(b.critical).toBe(1)
    expect(b.longestWaitHours).toBe(24) // the in_progress order, 24h
    expect(b.hasIssues).toBe(true)
  })
  it('has no issues when the queue is clear', () => {
    expect(buildLabBriefing([order({ status: 'reviewed' })], NOW).hasIssues).toBe(false)
  })
})

describe('sample label', () => {
  it('derives a display sample id and label data', () => {
    const o = order({ id: 'abcdef12-3456', patient_name: 'Awa Diop', patient_number: 'P-001',
      items: [{ test_name: 'Glycémie', flag: 'normal', result_value: null }, { test_name: 'NFS', flag: 'normal', result_value: null }] })
    expect(displaySampleId(o)).toBe('ABCDEF12')
    const label = buildSampleLabel(o, 'Clinique Dakar')
    expect(label).toMatchObject({
      patientName: 'Awa Diop', patientNumber: 'P-001', sampleId: 'ABCDEF12',
      sampleBarcode: 'ABCDEF12', testNames: ['Glycémie', 'NFS'], clinicName: 'Clinique Dakar',
    })
  })
  it('prefers an explicit sample_id / barcode when present', () => {
    const o = order({ sample_id: 'S-2026-42', sample_barcode: '123456789' })
    expect(displaySampleId(o)).toBe('S-2026-42')
    expect(buildSampleLabel(o, 'C').sampleBarcode).toBe('123456789')
  })
})

describe('matchLabOrderByCode (barcode sample lookup)', () => {
  const orders = [
    order({ id: 'abcdef12-3456', sample_barcode: 'LAB-000123' }),
    order({ id: '99999999-0000', sample_id: 'S-2026-42' }),
  ]
  it('matches by exact barcode (hyphen/space/case insensitive)', () => {
    expect(matchLabOrderByCode('lab 000123', orders)?.id).toBe('abcdef12-3456')
  })
  it('matches by explicit sample id', () => {
    expect(matchLabOrderByCode('S202642', orders)?.id).toBe('99999999-0000')
  })
  it('matches by the derived order-number prefix', () => {
    expect(matchLabOrderByCode('ABCDEF12', orders)?.id).toBe('abcdef12-3456')
  })
  it('returns null when nothing matches', () => {
    expect(matchLabOrderByCode('ZZZZZZ', orders)).toBeNull()
  })
})

describe('role permissions / restrictions', () => {
  it('gates create, result and review by role', () => {
    expect(canCreateLab('doctor')).toBe(true)
    expect(canCreateLab('lab_technician')).toBe(false) // technician cannot order
    expect(canResultLab('lab_technician')).toBe(true)  // but can enter results
    expect(canReviewLab('lab_technician')).toBe(false) // and cannot review
    expect(canReviewLab('doctor')).toBe(true)
    expect(canReviewLab('admin')).toBe(true)
  })
  it('locks super_admin out of patient medical detail', () => {
    expect(labWorkspaceRestricted('super_admin')).toBe(true)
    expect(labWorkspaceRestricted('doctor')).toBe(false)
  })
  it('lab technician has no billing capability', () => {
    expect(labCapabilities('lab_technician').canBill).toBe(false)
    expect(labCapabilities('admin').canBill).toBe(true)
  })
})

describe('security invariants', () => {
  const src = readFileSync(join(__dirname, '..', 'lab-workflow.ts'), 'utf8')
  it('never imports a Supabase client or the service role', () => {
    expect(src).not.toMatch(/import[^\n]*supabase/i)
    expect(src).not.toMatch(/createClient|createServiceClient/)
    expect(src).not.toMatch(/service_role|SERVICE_ROLE|serviceRole/)
  })
  it('performs no write/mutation calls', () => {
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
  })
})
