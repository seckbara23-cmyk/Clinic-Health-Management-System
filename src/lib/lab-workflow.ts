// ── Laboratory workflow (pure) ────────────────────────────────────
//
// Deterministic, dependency-free helpers behind the Lab Intelligence workspace:
// status progression, result criticality, work-queue KPIs/filters, an
// operational lab briefing, sample-label data, and role capabilities.
//
// NOTHING here diagnoses, recommends treatment, writes, or touches the database
// — every output is a pure transform of RLS-scoped records the caller loaded.

export type LabStatus =
  | 'ordered' | 'sample_collected' | 'sample_rejected' | 'in_progress'
  | 'completed' | 'reviewed' | 'cancelled'
export type LabFlag = 'normal' | 'abnormal' | 'high' | 'low' | 'critical'
export type LabPriority = 'normal' | 'urgent' | 'emergency'

export interface LabItemLite {
  test_name?: string | null
  flag: LabFlag
  result_value: string | null
}
export interface LabOrderLite {
  id: string
  status: LabStatus
  priority: LabPriority
  created_at: string
  completed_at?: string | null
  sample_collected_at?: string | null
  sample_id?: string | null
  sample_barcode?: string | null
  patient_name?: string | null
  patient_number?: string | null
  items?: LabItemLite[]
}

const ACTIVE: LabStatus[] = ['ordered', 'sample_collected', 'sample_rejected', 'in_progress']
const ABNORMAL_FLAGS: LabFlag[] = ['abnormal', 'high', 'low', 'critical']

// ── 1. Status progression (mirrors the detail dialog transitions) ──
export function nextLabStatuses(status: LabStatus, allResulted: boolean): LabStatus[] {
  switch (status) {
    case 'ordered':          return ['sample_collected', 'sample_rejected', 'cancelled']
    case 'sample_collected': return ['in_progress', 'sample_rejected']
    case 'sample_rejected':  return ['sample_collected']
    case 'in_progress':      return allResulted ? ['completed'] : []
    default:                 return []
  }
}

// ── 2. Result criticality ──────────────────────────────────────────
export interface Criticality { hasCritical: boolean; hasAbnormal: boolean; level: 'critical' | 'abnormal' | 'none' }

/** Highest severity among an order's RESULTED items (empty results ignored). */
export function orderCriticality(order: LabOrderLite): Criticality {
  let hasCritical = false, hasAbnormal = false
  for (const it of order.items ?? []) {
    if (it.result_value == null || it.result_value === '') continue
    if (it.flag === 'critical') hasCritical = true
    else if (ABNORMAL_FLAGS.includes(it.flag)) hasAbnormal = true
  }
  return { hasCritical, hasAbnormal, level: hasCritical ? 'critical' : hasAbnormal ? 'abnormal' : 'none' }
}

/** Completed but not yet reviewed by a clinician. */
export function isAwaitingReview(order: LabOrderLite): boolean {
  return order.status === 'completed'
}

// ── 3. Work-queue KPIs + filters ───────────────────────────────────
export interface LabKpis {
  pending: number
  collected: number
  inProgress: number
  completedToday: number
  criticalAbnormal: number
  awaitingReview: number
}

export function labKpis(orders: LabOrderLite[], todayIso: string): LabKpis {
  const day = todayIso.slice(0, 10)
  let pending = 0, collected = 0, inProgress = 0, completedToday = 0, criticalAbnormal = 0, awaitingReview = 0
  for (const o of orders) {
    if (o.status === 'ordered') pending++
    if (o.status === 'sample_collected') collected++
    if (o.status === 'in_progress') inProgress++
    if (o.status === 'completed') awaitingReview++
    if ((o.completed_at ?? '').slice(0, 10) === day) completedToday++
    const c = orderCriticality(o)
    if (c.level !== 'none') criticalAbnormal++
  }
  return { pending, collected, inProgress, completedToday, criticalAbnormal, awaitingReview }
}

export type LabFilter =
  | 'all' | 'pending' | 'collected' | 'in_progress' | 'completed' | 'awaiting_review' | 'critical'

export function filterLabOrders<T extends LabOrderLite>(orders: T[], filter: LabFilter): T[] {
  switch (filter) {
    case 'pending':         return orders.filter(o => o.status === 'ordered')
    case 'collected':       return orders.filter(o => o.status === 'sample_collected')
    case 'in_progress':     return orders.filter(o => o.status === 'in_progress')
    case 'completed':       return orders.filter(o => o.status === 'completed' || o.status === 'reviewed')
    case 'awaiting_review': return orders.filter(isAwaitingReview)
    case 'critical':        return orders.filter(o => orderCriticality(o).level !== 'none')
    default:                return orders
  }
}

// ── 4. Operational lab briefing (no diagnosis) ─────────────────────
export interface LabBriefing {
  pending: number
  urgent: number
  awaitingReview: number
  critical: number
  longestWaitHours: number | null
  hasIssues: boolean
}

function hoursBetween(from: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(from).getTime()) / 3_600_000))
}

export function buildLabBriefing(orders: LabOrderLite[], nowMs: number): LabBriefing {
  let pending = 0, urgent = 0, awaitingReview = 0, critical = 0, longest = 0
  for (const o of orders) {
    const active = ACTIVE.includes(o.status)
    if (o.status === 'ordered') pending++
    if (active && (o.priority === 'urgent' || o.priority === 'emergency')) urgent++
    if (o.status === 'completed') awaitingReview++
    if (orderCriticality(o).hasCritical) critical++
    if (active) longest = Math.max(longest, hoursBetween(o.created_at, nowMs))
  }
  return {
    pending, urgent, awaitingReview, critical,
    longestWaitHours: longest > 0 ? longest : null,
    hasIssues: pending + urgent + awaitingReview + critical > 0,
  }
}

// ── 5. Printable sample label ──────────────────────────────────────
export interface SampleLabel {
  patientName: string
  patientNumber: string | null
  orderNumber: string
  sampleId: string
  sampleBarcode: string
  testNames: string[]
  collectionDate: string
  clinicName: string
}

/** Short, human-readable id derived from the order when no sample_id is set. */
export function displaySampleId(order: Pick<LabOrderLite, 'id' | 'sample_id'>): string {
  return order.sample_id?.trim() || order.id.slice(0, 8).toUpperCase()
}

/**
 * Resolve a scanned code to an order already loaded under RLS: exact barcode
 * match, then the derived sample id / order-number prefix. Case-insensitive,
 * hyphen/space-insensitive. No DB query — works even before migration 035.
 */
export function matchLabOrderByCode<T extends LabOrderLite>(code: string, orders: T[]): T | null {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s-]+/g, '').toUpperCase()
  const c = norm(code)
  if (!c) return null
  return (
    orders.find(o => o.sample_barcode && norm(o.sample_barcode) === c)
    ?? orders.find(o => norm(displaySampleId(o)) === c)
    ?? orders.find(o => norm(o.id).startsWith(c) && c.length >= 6)
    ?? null
  )
}

export function buildSampleLabel(order: LabOrderLite, clinicName: string): SampleLabel {
  const sampleId = displaySampleId(order)
  return {
    patientName: order.patient_name ?? '—',
    patientNumber: order.patient_number ?? null,
    orderNumber: order.id.slice(0, 8).toUpperCase(),
    sampleId,
    sampleBarcode: order.sample_barcode?.trim() || sampleId,
    testNames: (order.items ?? []).map(i => i.test_name ?? '').filter(Boolean),
    collectionDate: order.sample_collected_at ?? order.created_at,
    clinicName,
  }
}

// ── 6. Role capabilities ───────────────────────────────────────────
export type LabRole = string

export function canCreateLab(role: LabRole): boolean {
  return ['doctor', 'nurse', 'admin'].includes(role)
}
export function canResultLab(role: LabRole): boolean {
  return ['doctor', 'nurse', 'admin', 'lab_technician'].includes(role)
}
export function canReviewLab(role: LabRole): boolean {
  return ['doctor', 'admin'].includes(role)
}
/** super_admin sees no patient medical detail. */
export function labWorkspaceRestricted(role: LabRole): boolean {
  return role === 'super_admin'
}

export interface LabCapabilities {
  restricted: boolean
  canCreate: boolean
  canResult: boolean
  canReview: boolean
  /** Lab technician is scoped to the lab workflow only (no billing). */
  canBill: boolean
}
export function labCapabilities(role: LabRole): LabCapabilities {
  return {
    restricted: labWorkspaceRestricted(role),
    canCreate: canCreateLab(role),
    canResult: canResultLab(role),
    canReview: canReviewLab(role),
    canBill: ['admin', 'receptionist', 'cashier', 'doctor'].includes(role),
  }
}
