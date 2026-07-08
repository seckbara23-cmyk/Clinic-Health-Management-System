import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import { snapshotReport, nextVersion } from '@/lib/radiology/report'
import type { RadiologyOrder, RadiologyReport } from '@/lib/radiology/types'

// ── Radiology hooks (Phase 39 — Radiora integration) ───────────────
//
// Tolerant reads of the radiology worklist / reports / version history + clinician-
// and radiologist-gated writes (order lifecycle, report drafting, signing,
// amendment). Uses only the anon/authenticated client (RLS) — never a privileged
// service-role key, no cross-tenant access. Signing/amendment are ALWAYS explicit
// human actions; the system never signs automatically. A missing migration (067)
// degrades to []. Signed reports are immutable (DB trigger); amendments create a
// new version + an append-only snapshot.

export interface WorklistOrder extends RadiologyOrder {
  patientName: string
  ordererName: string | null
  radiologistName: string | null
}

/** The clinic radiology worklist (migration 067). Tolerant → []. Patient embed uses
 *  an explicit FK hint; staff names resolved via a separate query to avoid any
 *  PostgREST embed ambiguity on user_profiles (two FKs). */
export function useRadiologyWorklist() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['radiology_worklist', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<WorklistOrder[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('radiology_orders')
          .select('id, patient_id, consultation_id, ordered_by, assigned_radiologist_id, modality, exam_type, clinical_indication, priority, status, requested_at, scheduled_at, completed_at, patient:patients!radiology_orders_patient_id_fkey(full_name)')
          .eq('clinic_id', clinic!.id)
          .order('requested_at', { ascending: false })
        if (error) return []
        const rows = (data ?? []) as Record<string, unknown>[]
        // Resolve ordering-doctor / radiologist names (tolerant, no embed).
        const ids = Array.from(new Set(rows.flatMap(r => [r.ordered_by, r.assigned_radiologist_id]).filter(Boolean))) as string[]
        const names: Record<string, string> = {}
        if (ids.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: staff } = await (supabase as any).from('user_profiles').select('id, full_name').in('id', ids)
          for (const u of (staff ?? []) as Record<string, unknown>[]) names[String(u.id)] = String(u.full_name ?? '')
        }
        return rows.map(mapOrder).map(o => ({
          ...o,
          patientName: '',
          ordererName: o.orderedBy ? names[o.orderedBy] ?? null : null,
          radiologistName: o.assignedRadiologistId ? names[o.assignedRadiologistId] ?? null : null,
        })).map((o, i) => ({ ...o, patientName: String((((rows[i].patient as Record<string, unknown>) ?? {}).full_name) ?? '') }))
      } catch {
        return []
      }
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrder(r: any): RadiologyOrder {
  return {
    id: String(r.id), patientId: String(r.patient_id), consultationId: (r.consultation_id as string | null) ?? null,
    orderedBy: (r.ordered_by as string | null) ?? null, assignedRadiologistId: (r.assigned_radiologist_id as string | null) ?? null,
    modality: String(r.modality), examType: String(r.exam_type), clinicalIndication: (r.clinical_indication as string | null) ?? null,
    priority: String(r.priority), status: String(r.status), requestedAt: String(r.requested_at),
    scheduledAt: (r.scheduled_at as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReport(r: any): RadiologyReport {
  return {
    id: String(r.id), orderId: String(r.order_id), patientId: String(r.patient_id),
    radiologistId: (r.radiologist_id as string | null) ?? null, reportStatus: String(r.report_status),
    modality: (r.modality as string | null) ?? null, examType: (r.exam_type as string | null) ?? null,
    technique: (r.technique as string | null) ?? null, findings: (r.findings as string | null) ?? null,
    conclusion: (r.conclusion as string | null) ?? null, recommendations: (r.recommendations as string | null) ?? null,
    signedAt: (r.signed_at as string | null) ?? null, signaturePath: (r.signature_path as string | null) ?? null,
    version: Number(r.version ?? 1),
  }
}

const REPORT_COLS = 'id, order_id, patient_id, radiologist_id, report_status, modality, exam_type, technique, findings, conclusion, recommendations, signed_at, signature_path, version'

/** The current report for an order (highest version). Tolerant → null. */
export function useOrderReport(orderId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['radiology_report', clinic?.id, orderId],
    enabled: !!clinic?.id && !!orderId,
    staleTime: 15_000,
    queryFn: async (): Promise<RadiologyReport | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).from('radiology_reports').select(REPORT_COLS)
          .eq('clinic_id', clinic!.id).eq('order_id', orderId!).order('version', { ascending: false }).limit(1)
        if (error || !data?.length) return null
        return mapReport(data[0])
      } catch { return null }
    },
  })
}

/** A patient's SIGNED radiology reports for the chart/timeline. Tolerant → []. */
export function usePatientRadiologyReports(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['radiology_patient_reports', clinic?.id, patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<RadiologyReport[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).from('radiology_reports').select(REPORT_COLS)
          .eq('clinic_id', clinic!.id).eq('patient_id', patientId!)
          .in('report_status', ['signed', 'amended']).order('signed_at', { ascending: false })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(mapReport)
      } catch { return [] }
    },
  })
}

export interface ReportVersionRow {
  id: string
  version: number
  reportStatus: string
  technique: string | null
  findings: string | null
  conclusion: string | null
  recommendations: string | null
  signedAt: string | null
  snapshotAt: string
}

/** A report's append-only version history (immutable audit). Tolerant → []. */
export function useReportVersions(reportId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['radiology_report_versions', clinic?.id, reportId],
    enabled: !!clinic?.id && !!reportId,
    staleTime: 30_000,
    queryFn: async (): Promise<ReportVersionRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).from('radiology_report_versions')
          .select('id, version, report_status, technique, findings, conclusion, recommendations, signed_at, snapshot_at')
          .eq('clinic_id', clinic!.id).eq('report_id', reportId!).order('version', { ascending: false })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          id: String(r.id), version: Number(r.version), reportStatus: String(r.report_status),
          technique: (r.technique as string | null) ?? null, findings: (r.findings as string | null) ?? null,
          conclusion: (r.conclusion as string | null) ?? null, recommendations: (r.recommendations as string | null) ?? null,
          signedAt: (r.signed_at as string | null) ?? null, snapshotAt: String(r.snapshot_at),
        }))
      } catch { return [] }
    },
  })
}

/** Create an imaging order (ordering doctor / nurse / admin). RLS-gated. */
export function useCreateRadiologyOrder() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { patientId: string; consultationId?: string | null; modality: string; examType: string; clinicalIndication?: string | null; priority?: string }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('radiology_orders').insert({
        clinic_id: clinic.id, patient_id: input.patientId, consultation_id: input.consultationId ?? null,
        ordered_by: profile?.id ?? null, modality: input.modality, exam_type: input.examType,
        clinical_indication: input.clinicalIndication ?? null, priority: input.priority ?? 'routine', status: 'requested',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radiology_worklist', clinic?.id] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Update an order (assign radiologist / advance status). RLS-gated. */
export function useUpdateRadiologyOrder() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { id: string; status?: string; assignedRadiologistId?: string | null }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (input.status !== undefined) patch.status = input.status
      if (input.assignedRadiologistId !== undefined) patch.assigned_radiologist_id = input.assignedRadiologistId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('radiology_orders').update(patch).eq('id', input.id).eq('clinic_id', clinic.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radiology_worklist', clinic?.id] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Create/update a DRAFT report (radiologist-authored content only). Never sets a
 *  report final — signing is a separate explicit action. RLS-gated. */
export function useSaveReport() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { report?: RadiologyReport | null; orderId: string; patientId: string; modality?: string | null; examType?: string | null; technique: string; findings: string; conclusion: string; recommendations: string; reportStatus?: string }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      const content = {
        technique: input.technique, findings: input.findings, conclusion: input.conclusion, recommendations: input.recommendations,
        report_status: input.reportStatus ?? 'draft', modality: input.modality ?? null, exam_type: input.examType ?? null,
        radiologist_id: profile?.id ?? null, updated_at: new Date().toISOString(),
      }
      if (input.report?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from('radiology_reports').update(content).eq('id', input.report.id).eq('clinic_id', clinic.id)
        if (error) throw error
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from('radiology_reports').insert({ clinic_id: clinic.id, order_id: input.orderId, patient_id: input.patientId, version: 1, ...content })
        if (error) throw error
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['radiology_report', clinic?.id, v.orderId] })
      qc.invalidateQueries({ queryKey: ['radiology_worklist', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Sign a report — an EXPLICIT radiologist action. Snapshots the signed content to
 *  the append-only version log and advances the order. Never automatic. */
export function useSignReport() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (report: RadiologyReport) => {
      if (!clinic?.id) throw new Error('No active clinic')
      const signedAt = new Date().toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { error: e1 } = await client.from('radiology_reports')
        .update({ report_status: 'signed', signed_at: signedAt, radiologist_id: profile?.id ?? null, updated_at: signedAt })
        .eq('id', report.id).eq('clinic_id', clinic.id)
      if (e1) throw e1
      const snap = snapshotReport({ ...report, reportStatus: 'signed', signedAt, radiologistId: profile?.id ?? null })
      await client.from('radiology_report_versions').insert({
        clinic_id: clinic.id, report_id: report.id, patient_id: report.patientId, version: snap.version,
        report_status: 'signed', technique: snap.technique, findings: snap.findings, conclusion: snap.conclusion,
        recommendations: snap.recommendations, radiologist_id: profile?.id ?? null, signed_at: signedAt,
      })
      await client.from('radiology_orders').update({ status: 'signed', updated_at: signedAt }).eq('id', report.orderId).eq('clinic_id', clinic.id)
    },
    onSuccess: (_d, report) => {
      qc.invalidateQueries({ queryKey: ['radiology_report', clinic?.id, report.orderId] })
      qc.invalidateQueries({ queryKey: ['radiology_worklist', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['radiology_patient_reports', clinic?.id, report.patientId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Amend a signed report — snapshot prior version, bump version, set 'amended'. The
 *  prior signed version stays in the immutable log; nothing is silently overwritten. */
export function useAmendReport() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: { report: RadiologyReport; technique: string; findings: string; conclusion: string; recommendations: string }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      // Preserve the prior signed version first (append-only).
      const prior = snapshotReport(input.report)
      await client.from('radiology_report_versions').insert({
        clinic_id: clinic.id, report_id: input.report.id, patient_id: input.report.patientId, version: prior.version,
        report_status: input.report.reportStatus, technique: prior.technique, findings: prior.findings,
        conclusion: prior.conclusion, recommendations: prior.recommendations, radiologist_id: prior.radiologistId, signed_at: prior.signedAt,
      })
      const v = nextVersion(input.report)
      const signedAt = new Date().toISOString()
      const { error } = await client.from('radiology_reports')
        .update({ report_status: 'amended', version: v, technique: input.technique, findings: input.findings, conclusion: input.conclusion, recommendations: input.recommendations, radiologist_id: profile?.id ?? null, signed_at: signedAt, updated_at: signedAt })
        .eq('id', input.report.id).eq('clinic_id', clinic.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['radiology_report', clinic?.id, v.report.orderId] })
      qc.invalidateQueries({ queryKey: ['radiology_patient_reports', clinic?.id, v.report.patientId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
