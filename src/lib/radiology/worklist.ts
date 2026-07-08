// ── Radiology worklist — pure engine (Phase 39) ───────────────────
//
// Deterministic worklist state machine, filtering, sorting and KPIs for the
// radiology order worklist. NO interpretation, NO writes — counts and ordering
// only. The radiologist decides everything.

import { ORDER_STATUSES, type OrderStatus, type RadiologyOrder } from './types'

// Order/worklist status transitions (forward-only, plus cancel from any non-final).
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  requested:      ['scheduled', 'in_progress', 'cancelled'],
  scheduled:      ['in_progress', 'cancelled'],
  in_progress:    ['dictated', 'cancelled'],
  dictated:       ['draft', 'cancelled'],
  draft:          ['pending_review', 'cancelled'],
  pending_review: ['signed', 'draft', 'cancelled'],
  signed:         ['delivered'],
  delivered:      [],
  cancelled:      [],
}

/** Open (actionable) worklist statuses — everything not signed/delivered/cancelled. */
const OPEN_STATUSES = new Set<string>(['requested', 'scheduled', 'in_progress', 'dictated', 'draft', 'pending_review'])
const AWAITING_REPORT = new Set<string>(['in_progress', 'dictated', 'draft', 'pending_review'])

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v)
}

/** Whether an order status transition is allowed (deterministic guard). */
export function canTransitionOrder(from?: string | null, to?: string | null): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false
  return ORDER_TRANSITIONS[from].includes(to)
}

export function allowedOrderTransitions(from?: string | null): OrderStatus[] {
  return isOrderStatus(from) ? [...ORDER_TRANSITIONS[from]] : []
}

export interface WorklistFilter {
  status?: string | null
  modality?: string | null
  priority?: string | null
  assignedRadiologistId?: string | null
  onlyOpen?: boolean
  search?: string | null   // matches exam_type / modality / clinical_indication
}

const PRIORITY_RANK: Record<string, number> = { stat: 0, urgent: 1, routine: 2 }

/** Filter + sort the worklist deterministically: STAT/urgent first, then oldest
 *  requested first (FIFO). Never mutates the input. */
export function filterWorklist(orders: RadiologyOrder[] | null | undefined, filter: WorklistFilter = {}): RadiologyOrder[] {
  const list = orders ?? []
  const q = (filter.search ?? '').trim().toLowerCase()
  const filtered = list.filter(o => {
    if (filter.onlyOpen && !OPEN_STATUSES.has(o.status)) return false
    if (filter.status && o.status !== filter.status) return false
    if (filter.modality && o.modality !== filter.modality) return false
    if (filter.priority && o.priority !== filter.priority) return false
    if (filter.assignedRadiologistId && o.assignedRadiologistId !== filter.assignedRadiologistId) return false
    if (q) {
      const hay = `${o.examType} ${o.modality} ${o.clinicalIndication ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  return filtered.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 3
    const pb = PRIORITY_RANK[b.priority] ?? 3
    if (pa !== pb) return pa - pb
    return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
  })
}

export interface WorklistKpis {
  total: number
  open: number
  awaitingReport: number
  pendingReview: number
  signed: number
  delivered: number
  stat: number
  urgent: number
  unassigned: number
}

/** Deterministic worklist KPIs (counts only). */
export function worklistKpis(orders: RadiologyOrder[] | null | undefined): WorklistKpis {
  const list = orders ?? []
  return {
    total: list.length,
    open: list.filter(o => OPEN_STATUSES.has(o.status)).length,
    awaitingReport: list.filter(o => AWAITING_REPORT.has(o.status)).length,
    pendingReview: list.filter(o => o.status === 'pending_review').length,
    signed: list.filter(o => o.status === 'signed').length,
    delivered: list.filter(o => o.status === 'delivered').length,
    stat: list.filter(o => o.priority === 'stat' && OPEN_STATUSES.has(o.status)).length,
    urgent: list.filter(o => o.priority === 'urgent' && OPEN_STATUSES.has(o.status)).length,
    unassigned: list.filter(o => !o.assignedRadiologistId && OPEN_STATUSES.has(o.status)).length,
  }
}
