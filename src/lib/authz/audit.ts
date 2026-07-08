// ── Enterprise Authorization — Audit builders (Phase 40) ─────────
//
// PURE builders that classify an authorization event into an append-only audit
// entry. They decide WHAT to record; persistence goes through the `authz_audit`
// table / RPC added by migration 068 (a NEW table — the existing `audit_events`
// and `admin_audit_log` trails are left untouched).
//
// Auditable events (per spec): denied access, sensitive-field access, export,
// print, signature, financial approval/refund, and break-glass invocation.

export type AuthzAuditType =
  | 'access_denied'
  | 'sensitive_field_access'
  | 'export'
  | 'print'
  | 'signature'
  | 'financial_approval'
  | 'break_glass'

export interface AuthzAuditEntry {
  type: AuthzAuditType
  permission: string | null
  decision: 'allow' | 'deny'
  sensitive: boolean
  entityType?: string | null
  entityId?: string | null
  reason?: string | null                // required for break_glass
  metadata: Record<string, unknown>
}

const FINANCIAL_PERMS = new Set(['finance.approve', 'billing.refund', 'finance.export'])

/**
 * Classify a permission + decision into an audit type, or null if the event is
 * routine and not worth recording. Denied checks are ALWAYS audited.
 */
export function auditTypeFor(perm: string, decision: 'allow' | 'deny'): AuthzAuditType | null {
  if (decision === 'deny') return 'access_denied'
  if (perm.startsWith('field.')) return 'sensitive_field_access'

  const action = perm.split('.')[1] ?? ''
  if (FINANCIAL_PERMS.has(perm) || action === 'refund' || action === 'approve') return 'financial_approval'
  if (action === 'export') return 'export'
  if (action === 'print') return 'print'
  if (action === 'sign') return 'signature'
  return null
}

/** Whether a can() outcome for this permission should be recorded. */
export function shouldAudit(perm: string, decision: 'allow' | 'deny'): boolean {
  return auditTypeFor(perm, decision) !== null
}

/**
 * Build an audit entry for a permission check, or null if not audit-worthy.
 * `sensitive` is true for field access, financial actions, signatures and denials.
 */
export function buildAccessAudit(
  perm: string,
  decision: 'allow' | 'deny',
  ctx: { entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> } = {},
): AuthzAuditEntry | null {
  const type = auditTypeFor(perm, decision)
  if (!type) return null
  const sensitive = type !== 'export' && type !== 'print' ? true : decision === 'deny'
  return {
    type,
    permission: perm,
    decision,
    sensitive,
    entityType: ctx.entityType ?? null,
    entityId: ctx.entityId ?? null,
    reason: null,
    metadata: ctx.metadata ?? {},
  }
}

/**
 * Build a break-glass audit entry. A reason is MANDATORY — this returns null when
 * absent, mirroring the engine's rule that reason-less break-glass is inert.
 */
export function buildBreakGlassAudit(
  reason: string | null | undefined,
  ctx: { grants?: string[]; expiresAt?: string | null; entityType?: string | null; entityId?: string | null } = {},
): AuthzAuditEntry | null {
  if (!reason || !reason.trim()) return null
  return {
    type: 'break_glass',
    permission: null,
    decision: 'allow',
    sensitive: true,
    entityType: ctx.entityType ?? null,
    entityId: ctx.entityId ?? null,
    reason: reason.trim(),
    metadata: {
      grants: ctx.grants ?? [],
      expires_at: ctx.expiresAt ?? null,
    },
  }
}
