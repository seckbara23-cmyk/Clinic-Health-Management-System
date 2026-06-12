import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { AuditableEntity } from '@/lib/audit-helpers'
import type { AuditEvent, PlatformBillingSummary } from '@/types/database'
import { toast } from 'sonner'

interface RecordRef { entity: AuditableEntity; id: string; reason?: string }

// Soft-delete a medical/billing record (admin only — enforced server-side).
export function useSoftDeleteRecord() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  return useMutation({
    mutationFn: async ({ entity, id, reason }: RecordRef) => {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'soft_delete', entity, id, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Échec de la suppression')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Enregistrement supprimé (récupérable)')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Restore a soft-deleted record (admin only).
export function useRestoreRecord() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  return useMutation({
    mutationFn: async ({ entity, id }: RecordRef) => {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', entity, id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Échec de la restauration')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['invoices', clinic?.id] })
      toast.success('Enregistrement restauré')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Trigger a CSV export download (admin only — enforced server-side).
export function useExportEntity() {
  return useMutation({
    mutationFn: async (entity: string) => {
      const res = await fetch(`/api/export/${entity}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? 'Échec de l’export')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${entity}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => toast.success('Export généré'),
    onError: (e: Error) => toast.error(e.message),
  })
}

// Clinic-scoped audit trail (admin only — RLS enforces).
export function useAuditEvents(entityType?: string, entityId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['audit-events', clinic?.id, entityType, entityId],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('audit_events')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (entityType) q = q.eq('entity_type', entityType)
      if (entityId) q = q.eq('entity_id', entityId)
      const { data, error } = await q
      if (error) throw error
      return data as AuditEvent[]
    },
  })
}

// Aggregate-only platform billing summary for super_admin (no PII).
export function usePlatformBillingSummary(enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-billing-summary'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_platform_billing_summary')
      if (error) throw error
      return (data ?? []) as PlatformBillingSummary[]
    },
  })
}
