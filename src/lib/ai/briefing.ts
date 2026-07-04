// ── Executive Briefing transform (presentation layer) ─────────────
//
// Pure, deterministic client-side reshaping of the existing AI insight response
// into a prioritized executive briefing. It does NOT call the AI engine, change
// tools, RLS, or routes — it only decides what to SHOW and how to group it.
//
// The core idea: the raw insight feed contains one result per tool, most of
// them zero-value or purely informational ("0 appointments", "avg wait 0 min").
// A dashboard should guide attention, so we surface only ACTIONABLE alerts —
// results whose dataCategory is a known operational concern AND whose count > 0
// — grouped into a few sections, and hide everything else.

import type { AIToolResult, AIConfidenceLevel, AIWarningLevel } from './types'
import type { Role } from '@/types/database'

export type BriefingStatus = 'normal' | 'attention' | 'critical'

export type BriefingSection =
  | 'patientFlow'
  | 'appointments'
  | 'laboratory'
  | 'pharmacy'
  | 'finance'
  | 'operations'

export interface BriefingItem {
  dataCategory: string
  section: BriefingSection
  level: AIWarningLevel
  count: number
  citation: AIToolResult['citation']
}

export interface BriefingSectionGroup {
  section: BriefingSection
  /** Highest severity among the section's items. */
  level: AIWarningLevel
  items: BriefingItem[]
}

export interface ExecutiveBriefing {
  status: BriefingStatus
  /** Number of actionable items across all sections. */
  actionCount: number
  confidence: AIConfidenceLevel
  /** Only non-empty sections, in display order. */
  sections: BriefingSectionGroup[]
  /** One suggested navigation target per section present. */
  nextActions: { section: BriefingSection; href: string }[]
}

/**
 * The ONLY dataCategories treated as actionable alerts (with count > 0). Every
 * other tool result — today's queue count, average wait, doctor workload,
 * tomorrow's prep, payer split, most-dispensed, patient history — is
 * informational and hidden from the briefing. Keyed by AIToolResult.dataCategory
 * (see src/lib/ai/tools/*). Some tools (unpaid invoices, pending lab orders)
 * emit no `warnings`, so severity is defined here rather than read from them.
 */
interface AlertRule { section: BriefingSection; level: AIWarningLevel }

export const ALERT_RULES: Record<string, AlertRule> = {
  // Patient flow (queue)
  long_waiting:          { section: 'patientFlow',  level: 'warning' },
  called_not_seen:       { section: 'patientFlow',  level: 'info' },
  // Appointments
  overbooked_slots:      { section: 'appointments', level: 'warning' },
  no_show_risks:         { section: 'appointments', level: 'info' },
  late_arrivals:         { section: 'appointments', level: 'info' },
  // Laboratory
  critical_lab_results:  { section: 'laboratory',   level: 'critical' },
  urgent_lab_orders:     { section: 'laboratory',   level: 'warning' },
  unreviewed_lab_results:{ section: 'laboratory',   level: 'info' },
  pending_lab_orders:    { section: 'laboratory',   level: 'info' },
  // Pharmacy
  low_stock:             { section: 'pharmacy',     level: 'warning' },
  near_expiry:           { section: 'pharmacy',     level: 'warning' },
  // Finance
  unpaid_invoices:       { section: 'finance',      level: 'warning' },
  overdue_balances:      { section: 'finance',      level: 'warning' },
}

const SECTION_ORDER: BriefingSection[] = [
  'patientFlow', 'appointments', 'laboratory', 'pharmacy', 'finance', 'operations',
]

const SECTION_HREF: Record<BriefingSection, string> = {
  patientFlow: '/queue',
  appointments: '/appointments',
  laboratory: '/lab-orders',
  pharmacy: '/pharmacy/inventory',
  finance: '/billing',
  operations: '/analytics',
}

const LEVEL_RANK: Record<AIWarningLevel, number> = { info: 1, warning: 2, critical: 3 }
function maxLevel(a: AIWarningLevel, b: AIWarningLevel): AIWarningLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}

/**
 * Sections a role may see in the briefing (defense-in-depth on top of the
 * server's per-role tool selection). `null` = all sections (admin). An empty
 * set = none: super_admin gets no medical/operational detail (platform lockout).
 */
export function allowedSectionsForRole(role: Role): Set<BriefingSection> | null {
  switch (role) {
    case 'admin':
      return null
    case 'doctor':
    case 'nurse':
      return new Set<BriefingSection>(['patientFlow', 'laboratory', 'appointments', 'pharmacy'])
    case 'receptionist':
      return new Set<BriefingSection>(['patientFlow', 'appointments'])
    case 'pharmacist':
      return new Set<BriefingSection>(['pharmacy'])
    case 'lab_technician':
      return new Set<BriefingSection>(['laboratory'])
    case 'cashier':
      return new Set<BriefingSection>(['finance'])
    case 'super_admin':
    default:
      return new Set<BriefingSection>()
  }
}

export function sectionHref(section: BriefingSection): string {
  return SECTION_HREF[section]
}

/**
 * Reshape raw insight results into a prioritized executive briefing. Pure and
 * deterministic: same inputs → same output.
 */
export function buildExecutiveBriefing(
  results: AIToolResult[],
  confidence: AIConfidenceLevel,
  role: Role,
): ExecutiveBriefing {
  const allowed = allowedSectionsForRole(role)
  const groups = new Map<BriefingSection, BriefingSectionGroup>()

  for (const r of results) {
    const rule = ALERT_RULES[r.dataCategory]
    if (!rule) continue                                   // informational → hide
    if (r.count <= 0) continue                             // zero-value → hide
    if (allowed && !allowed.has(rule.section)) continue    // role-aware

    // Start from the rule's level, escalate if the result carries a higher one.
    let level = rule.level
    for (const w of r.warnings ?? []) level = maxLevel(level, w.level)

    const item: BriefingItem = {
      dataCategory: r.dataCategory,
      section: rule.section,
      level,
      count: r.count,
      citation: r.citation,
    }
    const group = groups.get(rule.section) ?? { section: rule.section, level, items: [] }
    group.items.push(item)
    group.level = maxLevel(group.level, level)
    groups.set(rule.section, group)
  }

  const sections = SECTION_ORDER
    .map(s => groups.get(s))
    .filter((g): g is BriefingSectionGroup => !!g)

  const actionCount = sections.reduce((n, s) => n + s.items.length, 0)

  let status: BriefingStatus = 'normal'
  if (sections.some(s => s.level === 'critical')) status = 'critical'
  else if (actionCount > 0) status = 'attention'

  const nextActions = sections.map(s => ({ section: s.section, href: SECTION_HREF[s.section] }))

  return { status, actionCount, confidence, sections, nextActions }
}
