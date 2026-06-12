import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requestClientInfo } from '@/lib/audit-helpers'

export const dynamic = 'force-dynamic'

// Per-entity export config. Columns are explicit (no SELECT *) so the CSV shape
// is stable and we never leak unexpected columns. soft = table has deleted_at.
const EXPORTS: Record<string, { table: string; columns: string[]; soft: boolean }> = {
  patients:      { table: 'patients',       soft: true,  columns: ['patient_number','full_name','date_of_birth','gender','phone','email','address','cni','blood_type','consent_given','created_at'] },
  appointments:  { table: 'appointments',   soft: true,  columns: ['id','patient_id','scheduled_at','status','title','duration_min','created_at'] },
  consultations: { table: 'consultations',  soft: true,  columns: ['id','patient_id','chief_complaint','diagnosis','treatment_plan','follow_up_date','created_at'] },
  prescriptions: { table: 'prescriptions',  soft: true,  columns: ['id','patient_id','status','valid_until','medications','created_at'] },
  invoices:      { table: 'invoices',       soft: true,  columns: ['invoice_number','patient_id','total_amount','amount_paid','insurance_share','status','payment_method','currency','created_at'] },
  payments:      { table: 'payment_events', soft: false, columns: ['id','invoice_id','provider','amount','currency','status','received_at'] },
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.join(',')
  const body = rows.map(r => columns.map(c => escape(r[c])).join(',')).join('\n')
  return `${header}\n${body}\n`
}

// GET /api/export/:entity  → admin-only, clinic-scoped CSV. Audited.
export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  const cfg = EXPORTS[entity]
  if (!cfg) return NextResponse.json({ error: 'Entité inconnue' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id, role, is_active')
    .eq('id', user.id)
    .single()
  if (!profile?.is_active || !profile.clinic_id || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs' }, { status: 403 })
  }

  // RLS already scopes to the caller's clinic; the explicit clinic_id filter is
  // defense in depth. Soft-deleted rows are excluded.
  let q = supabase.from(cfg.table).select(cfg.columns.join(',')).eq('clinic_id', profile.clinic_id)
  if (cfg.soft) q = q.is('deleted_at', null)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(10000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const csv = toCsv(rows, cfg.columns)

  // Audit the export (service client — bypasses the no-insert RLS on audit_events).
  const { ip, ua } = requestClientInfo(req)
  const service = createServiceClient()
  await service.from('audit_events').insert({
    clinic_id: profile.clinic_id,
    user_id: user.id,
    entity_type: 'export',
    entity_id: null,
    action: 'exported',
    metadata: { entity, row_count: rows.length, ip_address: ip, user_agent: ua },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entity}-${stamp}.csv"`,
    },
  })
}
