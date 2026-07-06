// ── Professional timeline (Phase 21) ───────────────────────────────
//
// Merges an employee's WORKFORCE history into one chronological stream:
// employment lifecycle events, credential renewals, role / department /
// specialty changes, password resets, profile updates, and training
// completions. It reads ONLY workforce entities — it NEVER touches or mixes in
// the patient timeline. Pure and deterministic.

import type { Credential, EmployeeEvent, TrainingRecord } from './types'

export interface TimelineEntry {
  id: string
  type: string          // event_type or a synthesized kind (credential/training)
  date: string          // ISO timestamp or date used for ordering
  fromValue?: string | null
  toValue?: string | null
  note?: string | null
  ref?: string | null   // credential type / training title
}

export interface TimelineInput {
  events: EmployeeEvent[]
  credentials?: Credential[]
  trainings?: TrainingRecord[]
}

/**
 * Build the merged professional timeline, most-recent first. The append-only
 * employee_events log is authoritative; credential issue dates and training
 * completions are folded in as historical milestones so the stream is complete
 * even for data recorded before an event was logged.
 */
export function buildProfessionalTimeline(input: TimelineInput): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const e of input.events ?? []) {
    entries.push({
      id: e.id,
      type: e.eventType,
      date: e.effectiveDate || e.createdAt,
      fromValue: e.fromValue,
      toValue: e.toValue,
      note: e.note,
    })
  }

  for (const c of input.credentials ?? []) {
    if (!c.issueDate) continue
    entries.push({
      id: `cred-${c.id}`,
      type: 'credential_added',
      date: c.issueDate,
      ref: c.credentialType,
      note: c.number,
    })
  }

  for (const t of input.trainings ?? []) {
    if (!t.completedDate) continue
    entries.push({
      id: `train-${t.id}`,
      type: 'training_completed',
      date: t.completedDate,
      ref: t.title,
      note: t.provider,
    })
  }

  return entries.sort((a, b) => timeOf(b.date) - timeOf(a.date))
}

function timeOf(v: string): number {
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}
