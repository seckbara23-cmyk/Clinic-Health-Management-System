import { createServiceClient } from '@/lib/supabase/service'

// Privileged action types written to admin_audit_log.
// Add new entries here when new privileged operations are introduced.
export type AuditAction =
  | 'clinic.create'
  | 'clinic.suspend'
  | 'clinic.reactivate'
  | 'clinic.archive'
  | 'clinic.set_inactive'
  | 'clinic_request.approve'
  | 'clinic_request.reject'
  | 'user.password_reset'

/**
 * Append one row to admin_audit_log via the service-role client (bypasses RLS).
 *
 * This function never throws — a logging failure must not abort the primary
 * operation. Errors are printed to the server log for monitoring visibility.
 *
 * Always include actor_email in metadata so the record remains interpretable
 * even if the actor's auth.users row is later deleted (actor_id → NULL).
 */
export async function logAuditEvent({
  actorId,
  action,
  targetType,
  targetId,
  metadata = {},
}: {
  actorId:    string
  action:     AuditAction
  targetType: string
  targetId?:  string
  metadata?:  Record<string, unknown>
}): Promise<void> {
  try {
    const service = createServiceClient()

    // admin_audit_log is not yet in database.types.ts (added by migration 019).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any).from('admin_audit_log').insert({
      actor_id:    actorId,
      action,
      target_type: targetType,
      target_id:   targetId ?? null,
      metadata,
    })

    if (error) {
      console.error('[audit] Insert failed:', action, error.message)
    }
  } catch (err) {
    console.error('[audit] Unexpected error logging event:', action, err)
  }
}
