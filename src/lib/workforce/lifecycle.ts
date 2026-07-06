// ── Employment lifecycle (Phase 21) ────────────────────────────────
//
// Pure state machine for employment status. Steady states: active, on_leave,
// suspended, retired, terminated. Transitions emit lifecycle EVENTS (hired,
// activated, leave_started, suspended, returned, retired, terminated) that are
// appended to the immutable employee_events timeline.
//
// CRITICAL: employment status is ORGANISATIONAL ONLY. Nothing here touches
// permissions — those come solely from user_profiles.role. A suspension or
// termination recorded here does NOT change what the user can access; that is a
// deliberate, separate administrative action in User Management.

import type { EmploymentStatus, EmployeeEventType } from './types'

export const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  'active', 'on_leave', 'suspended', 'retired', 'terminated',
]

// Terminal states cannot transition further (retired / terminated are final;
// re-hiring is a new employment record, not a transition).
const TERMINAL: EmploymentStatus[] = ['retired', 'terminated']

// Allowed transitions between steady states.
const TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  active:     ['on_leave', 'suspended', 'retired', 'terminated'],
  on_leave:   ['active', 'suspended', 'retired', 'terminated'],
  suspended:  ['active', 'retired', 'terminated'],
  retired:    [],
  terminated: [],
}

export function isTerminalStatus(status: EmploymentStatus): boolean {
  return TERMINAL.includes(status)
}

export function allowedTransitions(from: EmploymentStatus): EmploymentStatus[] {
  return TRANSITIONS[from] ?? []
}

export function canTransition(from: EmploymentStatus, to: EmploymentStatus): boolean {
  if (from === to) return false
  return allowedTransitions(from).includes(to)
}

/**
 * The lifecycle event a transition produces. `previous` disambiguates a return
 * to 'active': from leave/suspension it's a 'returned' event, otherwise
 * 'activated'. Deterministic; returns null for a disallowed transition.
 */
export function transitionEvent(
  from: EmploymentStatus,
  to: EmploymentStatus,
): EmployeeEventType | null {
  if (!canTransition(from, to)) return null
  switch (to) {
    case 'on_leave':   return 'leave_started'
    case 'suspended':  return 'suspended'
    case 'retired':    return 'retired'
    case 'terminated': return 'terminated'
    case 'active':     return (from === 'on_leave' || from === 'suspended') ? 'returned' : 'activated'
    default:           return 'note'
  }
}

// The initial event stamped when an employment record is first created.
export const INITIAL_EVENT: EmployeeEventType = 'hired'

/** Is this employee counted as "active workforce" for the dashboard? */
export function isActiveWorkforce(status: EmploymentStatus): boolean {
  return status === 'active' || status === 'on_leave'
}
