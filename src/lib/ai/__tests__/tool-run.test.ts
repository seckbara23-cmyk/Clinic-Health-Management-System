import { getLowStock, getNearExpiry } from '../tools/pharmacy'
import { getUnpaidInvoices } from '../tools/billing'
import { getTodayQueue, getPatientConsultations } from '../tools/clinical'
import { getWaitingTimeSummary, getNoShowRisks } from '../tools/scheduling'
import type { AIContext, RlsClient } from '../types'

// Minimal chainable Supabase stub: every filter method returns the builder,
// awaiting it resolves { data, error }. Good enough to exercise tool mapping
// (filtering/aggregation/citation/warnings) without a real database.
function makeDb(tables: Record<string, unknown[]>, rpcData?: unknown): RlsClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'gt', 'gte', 'lte', 'not', 'in', 'order', 'limit']) {
      b[m] = () => b
    }
    ;(b as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null })
    return b
  }
  return {
    from: (t: string) => builder(tables[t] ?? []),
    rpc: async () => ({ data: rpcData ?? {}, error: null }),
  } as unknown as RlsClient
}

const ctx: AIContext = { role: 'admin', clinicId: 'c1', userId: 'u1', patientId: 'p1' }

describe('tool execution (RLS client injected)', () => {
  it('get_low_stock filters to items at/below reorder level and warns', async () => {
    const db = makeDb({
      clinic_medication_inventory: [
        { id: 'a', stock_quantity: 2, reorder_level: 5 }, // low
        { id: 'b', stock_quantity: 50, reorder_level: 5 }, // ok
        { id: 'c', stock_quantity: 5, reorder_level: 5 }, // low (==)
      ],
    })
    const res = await getLowStock.run(db, ctx)
    expect(res.count).toBe(2)
    expect(res.dataCategory).toBe('low_stock')
    expect(res.citation.entity).toBe('clinic_medication_inventory')
    expect(res.warnings?.[0].level).toBe('warning')
  })

  it('get_near_expiry returns batches and a warning when present', async () => {
    const db = makeDb({
      medication_batches: [{ id: 'x', expiry_date: '2026-07-01', quantity_remaining: 3 }],
    })
    const res = await getNearExpiry.run(db, ctx)
    expect(res.count).toBe(1)
    expect(res.warnings?.length).toBe(1)
  })

  it('get_unpaid_invoices sums the outstanding balance', async () => {
    const db = makeDb({
      invoices: [
        { id: 'i1', status: 'sent', total_amount: 1000, amount_paid: 0 },
        { id: 'i2', status: 'partial', total_amount: 2000, amount_paid: 500 },
      ],
    })
    const res = await getUnpaidInvoices.run(db, ctx)
    expect(res.count).toBe(2)
    expect(res.summaryLine).toContain('2500') // 1000 + 1500 outstanding
  })

  it('get_today_queue counts waiting patients', async () => {
    const db = makeDb({
      appointments: [
        { id: 'a1', status: 'waiting' },
        { id: 'a2', status: 'scheduled' },
        { id: 'a3', status: 'waiting' },
      ],
    })
    const res = await getTodayQueue.run(db, ctx)
    expect(res.count).toBe(3)
    expect(res.summaryLine).toContain('2 waiting')
  })

  it('get_patient_consultations cites the most recent date', async () => {
    const db = makeDb({
      consultations: [
        { id: 'c1', created_at: '2026-06-10T09:00:00Z' },
        { id: 'c2', created_at: '2026-06-15T09:00:00Z' },
      ],
    })
    const res = await getPatientConsultations.run(db, ctx)
    expect(res.count).toBe(2)
    expect(res.dataCategory).toBe('consultations')
    expect(res.citation.date).toBe('2026-06-15')
  })

  it('get_waiting_time_summary cites appointments and counts waiting patients', async () => {
    const db = makeDb({
      appointments: [
        { arrived_at: '2026-07-01T08:00:00Z', status: 'waiting' },
        { arrived_at: '2026-07-01T08:30:00Z', status: 'called' },
      ],
    })
    const res = await getWaitingTimeSummary.run(db, ctx)
    expect(res.citation.entity).toBe('appointments')
    expect(res.dataCategory).toBe('waiting_time')
    expect(res.count).toBe(2)
  })

  it('get_no_show_risks flags only patients with >= 2 no-shows, with a citation', async () => {
    const db = makeDb({
      appointments: [
        { patient_id: 'p1', patient: { full_name: 'A' } },
        { patient_id: 'p1', patient: { full_name: 'A' } },
        { patient_id: 'p2', patient: { full_name: 'B' } },
      ],
    })
    const res = await getNoShowRisks.run(db, ctx)
    expect(res.count).toBe(1)
    expect(res.citation.source).toBe('Appointments')
  })

  it('propagates a query error as a thrown Error', async () => {
    const db = {
      from: () => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'is', 'gt', 'gte', 'lte', 'not', 'in', 'order', 'limit']) b[m] = () => b
        ;(b as { then: unknown }).then = (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'boom' } })
        return b
      },
    } as unknown as RlsClient
    await expect(getLowStock.run(db, ctx)).rejects.toThrow('boom')
  })
})
