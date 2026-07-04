import {
  buildExecutiveBriefing,
  allowedSectionsForRole,
  ALERT_RULES,
} from '../briefing'
import type { AIToolResult, AIWarning } from '../types'

// Minimal AIToolResult factory for the transform under test.
function result(
  dataCategory: string,
  count: number,
  warnings: AIWarning[] = [],
): AIToolResult {
  return {
    toolId: `tool_${dataCategory}`,
    // category is unused by the transform (it keys off dataCategory), but the
    // type requires a valid value.
    category: 'queue',
    dataCategory,
    count,
    rows: [],
    citation: { source: `src_${dataCategory}`, entity: dataCategory, date: '2026-07-04', detail: `${count} rows` },
    warnings,
  }
}

describe('buildExecutiveBriefing', () => {
  // 1. Zero / informational insights collapse into "no urgent issues".
  it('returns Normal with no sections when everything is zero or informational', () => {
    const results = [
      result('queue', 0),                 // informational, zero
      result('waiting_time', 0),          // informational
      result('doctor_workload', 3),       // informational, non-zero → still hidden
      result('unpaid_invoices', 0),       // actionable category but zero
      result('low_stock', 0),             // actionable category but zero
    ]
    const b = buildExecutiveBriefing(results, 'high', 'admin')
    expect(b.status).toBe('normal')
    expect(b.actionCount).toBe(0)
    expect(b.sections).toHaveLength(0)
    expect(b.nextActions).toHaveLength(0)
  })

  // 2. A non-zero critical item appears as a critical alert.
  it('flags Critical when a critical lab result is present', () => {
    const b = buildExecutiveBriefing([result('critical_lab_results', 2)], 'high', 'admin')
    expect(b.status).toBe('critical')
    expect(b.actionCount).toBe(1)
    const lab = b.sections.find(s => s.section === 'laboratory')
    expect(lab).toBeDefined()
    expect(lab!.items[0].level).toBe('critical')
    expect(lab!.items[0].count).toBe(2)
  })

  // Non-critical actionable items are Attention.
  it('flags Attention for non-critical actionable items', () => {
    const b = buildExecutiveBriefing([result('unpaid_invoices', 4)], 'medium', 'admin')
    expect(b.status).toBe('attention')
    expect(b.actionCount).toBe(1)
    expect(b.sections[0].section).toBe('finance')
  })

  // unpaid_invoices / pending_lab_orders emit NO warnings from the tools, but
  // are still actionable via ALERT_RULES when count > 0.
  it('treats warning-less actionable categories as alerts when count > 0', () => {
    const b = buildExecutiveBriefing(
      [result('unpaid_invoices', 3, []), result('pending_lab_orders', 5, [])],
      'high',
      'admin',
    )
    expect(b.actionCount).toBe(2)
    expect(b.status).toBe('attention')
  })

  // 3. Role-aware filtering.
  it('hides sections a role is not allowed to see', () => {
    const results = [
      result('low_stock', 2),          // pharmacy
      result('unpaid_invoices', 1),    // finance
      result('critical_lab_results', 1), // laboratory
    ]
    const pharmacist = buildExecutiveBriefing(results, 'high', 'pharmacist')
    expect(pharmacist.sections.map(s => s.section)).toEqual(['pharmacy'])

    const cashier = buildExecutiveBriefing(results, 'high', 'cashier')
    expect(cashier.sections.map(s => s.section)).toEqual(['finance'])

    const admin = buildExecutiveBriefing(results, 'high', 'admin')
    expect(admin.sections.map(s => s.section).sort()).toEqual(['finance', 'laboratory', 'pharmacy'])
  })

  it('shows nothing medical for super_admin', () => {
    const b = buildExecutiveBriefing(
      [result('critical_lab_results', 5), result('unpaid_invoices', 9)],
      'high',
      'super_admin',
    )
    expect(b.sections).toHaveLength(0)
    expect(b.status).toBe('normal')
  })

  // 4. Grouped section behavior — multiple items collapse into one section.
  it('groups multiple items of the same section and escalates section level', () => {
    const b = buildExecutiveBriefing(
      [result('low_stock', 2), result('near_expiry', 3)],
      'high',
      'pharmacist',
    )
    expect(b.sections).toHaveLength(1)
    const pharmacy = b.sections[0]
    expect(pharmacy.section).toBe('pharmacy')
    expect(pharmacy.items).toHaveLength(2)
    expect(pharmacy.level).toBe('warning')
    expect(b.nextActions).toEqual([{ section: 'pharmacy', href: '/pharmacy/inventory' }])
  })

  it('orders sections deterministically', () => {
    const results = [
      result('unpaid_invoices', 1),      // finance (later)
      result('long_waiting', 1),         // patientFlow (first)
      result('urgent_lab_orders', 1),    // laboratory (middle)
    ]
    const b = buildExecutiveBriefing(results, 'high', 'admin')
    expect(b.sections.map(s => s.section)).toEqual(['patientFlow', 'laboratory', 'finance'])
  })

  // 5. Citations preserved for expanded details.
  it('preserves the source citation on each item', () => {
    const b = buildExecutiveBriefing([result('critical_lab_results', 1)], 'high', 'admin')
    const item = b.sections[0].items[0]
    expect(item.citation.source).toBe('src_critical_lab_results')
    expect(item.citation.date).toBe('2026-07-04')
  })

  it('passes confidence through unchanged', () => {
    expect(buildExecutiveBriefing([], 'low', 'admin').confidence).toBe('low')
  })
})

describe('allowedSectionsForRole', () => {
  it('gives admin every section (null = all)', () => {
    expect(allowedSectionsForRole('admin')).toBeNull()
  })
  it('locks super_admin out of all sections', () => {
    expect(allowedSectionsForRole('super_admin')?.size).toBe(0)
  })
  it('scopes each clinical role to its sections', () => {
    expect([...allowedSectionsForRole('pharmacist')!]).toEqual(['pharmacy'])
    expect([...allowedSectionsForRole('lab_technician')!]).toEqual(['laboratory'])
    expect([...allowedSectionsForRole('cashier')!]).toEqual(['finance'])
    expect(allowedSectionsForRole('receptionist')!.has('appointments')).toBe(true)
    expect(allowedSectionsForRole('receptionist')!.has('pharmacy')).toBe(false)
  })
})

describe('ALERT_RULES', () => {
  it('covers exactly the actionable operational categories', () => {
    expect(Object.keys(ALERT_RULES).sort()).toEqual([
      'called_not_seen',
      'critical_lab_results',
      'late_arrivals',
      'long_waiting',
      'low_stock',
      'near_expiry',
      'no_show_risks',
      'overbooked_slots',
      'overdue_balances',
      'pending_lab_orders',
      'unpaid_invoices',
      'unreviewed_lab_results',
      'urgent_lab_orders',
    ])
  })
})
