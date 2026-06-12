import type { AuditableEntity } from '@/lib/audit-helpers'

// Fire-and-forget detail-view logging. Call once when a record detail view
// opens. Never throws — a logging failure must not affect the UI.
export function logRecordView(entityType: AuditableEntity, entityId: string): void {
  try {
    fetch('/api/audit/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
