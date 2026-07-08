// ── Enterprise Authorization — Action registry (Phase 40) ─────────
//
// The canonical vocabulary of ACTIONS a principal may perform on a resource. A
// permission is always `<module>.<action>` (or a field permission `field.<name>`).
// Registry-driven, deterministic. This layer is ADDITIVE and RLS-compatible: it
// drives page / button / field visibility and AI scoping on top of the existing
// role system and RLS — it NEVER replaces or weakens RLS (the DB stays the
// security boundary).

export const ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'sign', 'dispense', 'export',
  'refund', 'assign', 'schedule', 'cancel', 'verify', 'print', 'download', 'upload',
  'manage', 'result_entry', 'report', 'payment', 'inventory', 'catalog', 'scan', 'reports',
] as const
export type Action = (typeof ACTIONS)[number]

export function isAction(v: unknown): v is Action {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v)
}
