'use client'

// ── Super Admin Platform Activity Center (Phase 15.0) ──────────────
//
// PLATFORM OPERATIONS only — not a clinical feature, not a patient-record
// viewer. Super admin manages the platform; clinics own the medical data.
// Every number on this page is a COUNT or AGGREGATE sourced from the
// SECURITY DEFINER RPCs in migration 042 (mirroring get_platform_billing_summary,
// 026) or from admin_audit_log / user_profiles, both already super_admin-
// readable by existing RLS. Nothing here ever selects a patient name,
// diagnosis, prescription, lab value, or medical document.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Activity, Building2, Users, ShieldCheck, TrendingUp, MessageSquare, Sparkles,
  Search, Loader2, ClipboardList, X, Info, ChevronRight,
} from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import {
  usePlatformOverview, useClinicActivitySummary, usePlatformSmsSummary, usePlatformAiSummary,
  useRecentPlatformActions, useClinicAuditActions, useClinicStaff,
} from '@/hooks/usePlatformActivity'
import {
  resolveDateRange, filterClinicRows, sumBy, maskId, orderedEntries,
  CLINIC_STATUS_ORDER, SUBSCRIPTION_PLAN_ORDER, STAFF_ROLE_ORDER, activityTotal,
  type DateRangeFilter, type ClinicActivityRow,
} from '@/lib/platform-activity'

const RANGE_FILTERS: DateRangeFilter[] = ['today', 'yesterday', '7d', '30d']

export default function PlatformActivityPage() {
  const t = useTranslations('adminActivity')
  const { profile } = useClinic()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7d')
  const [query, setQuery] = useState('')
  const [drilldownId, setDrilldownId] = useState<string | null>(null)

  const range = useMemo(() => resolveDateRange(rangeFilter, new Date()), [rangeFilter])

  const overview = usePlatformOverview(isSuperAdmin)
  const activity = useClinicActivitySummary(range, isSuperAdmin)
  const sms = usePlatformSmsSummary(range, isSuperAdmin)
  const ai = usePlatformAiSummary(range, isSuperAdmin)
  const actions = useRecentPlatformActions(20, isSuperAdmin)

  const rows = useMemo(() => activity.data ?? [], [activity.data])
  const shownRows = useMemo(() => filterClinicRows(rows, query), [rows, query])
  const sortedRows = useMemo(
    () => [...shownRows].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
    [shownRows],
  )

  const smsRows = useMemo(() => sms.data ?? [], [sms.data])
  const smsTotals = {
    queued: sumBy(smsRows, r => r.queued), sent: sumBy(smsRows, r => r.sent),
    delivered: sumBy(smsRows, r => r.delivered), failed: sumBy(smsRows, r => r.failed),
    total: sumBy(smsRows, r => r.total),
  }
  const aiRows = useMemo(() => ai.data ?? [], [ai.data])
  const aiTotals = {
    conversations: sumBy(aiRows, r => r.conversationCount),
    messages: sumBy(aiRows, r => r.messageCount),
  }

  // Label lookups built once from the KNOWN, fully-translated key sets — never
  // call t() with a runtime-unknown key (next-intl throws on a missing key).
  // These hooks must run unconditionally (before the super_admin early return)
  // to satisfy the rules of hooks.
  const statusLabels = useMemo(() => Object.fromEntries(CLINIC_STATUS_ORDER.map(s => [s, t(`status_${s}`)])), [t])
  const planLabels = useMemo(() => Object.fromEntries(SUBSCRIPTION_PLAN_ORDER.map(p => [p, t(`plan_${p}`)])), [t])
  const roleLabels = useMemo(() => Object.fromEntries(STAFF_ROLE_ORDER.map(r => [r, t(`role_${r}`)])), [t])

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t('noAccess')} />
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <p>{t('noAccessMessage')}</p>
        </div>
      </div>
    )
  }

  const ov = overview.data
  const overviewTiles = [
    { label: t('statTotalClinics'), value: ov?.clinicsTotal ?? 0, icon: Building2, color: 'text-teal-700', bg: 'bg-teal-50' },
    { label: t('statActiveClinics'), value: ov?.clinicsByStatus.active ?? 0, icon: ShieldCheck, color: 'text-emerald-700', bg: 'bg-emerald-50' },
    { label: t('statNewClinics7d'), value: ov?.clinicsNew7d ?? 0, icon: TrendingUp, color: 'text-violet-700', bg: 'bg-violet-50' },
    { label: t('statTotalUsers'), value: ov?.usersTotal ?? 0, icon: Users, color: 'text-blue-700', bg: 'bg-blue-50' },
    { label: t('statActiveUsers'), value: ov?.usersActive ?? 0, icon: Activity, color: 'text-amber-700', bg: 'bg-amber-50' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        {/* Privacy notice — the console's core operating principle */}
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{t('privacyNotice')}</span>
        </div>

        {/* Overview tiles */}
        {overview.isLoading ? (
          <TileSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {overviewTiles.map(tile => (
              <div key={tile.label} className={cn('rounded-xl p-3 md:p-4', tile.bg)}>
                <p className="flex items-center gap-1.5 text-[10px] md:text-xs font-medium text-gray-500">
                  <tile.icon className="h-3.5 w-3.5" /> {tile.label}
                </p>
                <p className={cn('text-lg md:text-2xl font-bold mt-1', tile.color)}>{tile.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Breakdowns */}
        <div className="grid gap-4 lg:grid-cols-3">
          <BreakdownCard title={t('breakdownByStatus')} map={ov?.clinicsByStatus ?? {}} order={CLINIC_STATUS_ORDER} labelFor={s => statusLabels[s] ?? s} />
          <BreakdownCard title={t('breakdownByPlan')} map={ov?.clinicsByPlan ?? {}} order={SUBSCRIPTION_PLAN_ORDER} labelFor={p => planLabels[p] ?? p} />
          <BreakdownCard title={t('breakdownByRole')} map={ov?.usersByRole ?? {}} order={STAFF_ROLE_ORDER} labelFor={r => roleLabels[r] ?? r} />
        </div>

        {/* Date range filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('rangeLabel')}</span>
          {RANGE_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setRangeFilter(f)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                rangeFilter === f ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {t(`range_${f}`)}
            </button>
          ))}
        </div>

        {/* SMS + AI operational summaries */}
        <div className="grid gap-4 md:grid-cols-2">
          <SummaryCard
            icon={MessageSquare}
            title={t('smsQueueTitle')}
            isLoading={sms.isLoading}
            metrics={[
              { label: t('smsSent'), value: smsTotals.sent },
              { label: t('smsDelivered'), value: smsTotals.delivered },
              { label: t('smsFailed'), value: smsTotals.failed },
              { label: t('smsQueued'), value: smsTotals.queued },
            ]}
            note={t('aggregateNoteSms')}
          />
          <SummaryCard
            icon={Sparkles}
            title={t('aiUsageTitle')}
            isLoading={ai.isLoading}
            metrics={[
              { label: t('aiConversations'), value: aiTotals.conversations },
              { label: t('aiMessages'), value: aiTotals.messages },
            ]}
            note={t('aggregateNoteAi')}
          />
        </div>

        {/* Clinic activity table */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t('clinicActivityTitle')}</h2>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-8 h-8 text-sm" />
              </div>
            </div>

            {activity.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : sortedRows.length === 0 ? (
              <EmptyState icon={Building2} title={t('emptyTitle')} description={t('emptyDesc')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colClinic')}</TableHead>
                      <TableHead>{t('colPlan')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead className="text-right">{t('colUsers')}</TableHead>
                      <TableHead className="text-right">{t('colAppointments')}</TableHead>
                      <TableHead className="text-right">{t('colConsultations')}</TableHead>
                      <TableHead className="text-right">{t('colInvoices')}</TableHead>
                      <TableHead className="text-right">{t('colLabOrders')}</TableHead>
                      <TableHead className="text-right">{t('colDispensing')}</TableHead>
                      <TableHead>{t('colLastActivity')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map(row => (
                      <TableRow key={row.clinicId} className="cursor-pointer hover:bg-gray-50" onClick={() => setDrilldownId(row.clinicId)}>
                        <TableCell className="font-medium whitespace-nowrap">{row.clinicName}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{row.subscriptionPlan}</Badge></TableCell>
                        <TableCell><StatusDot status={row.clinicStatus} /></TableCell>
                        <TableCell className="text-right">{row.userCount}</TableCell>
                        <TableCell className="text-right">{row.appointmentsCount}</TableCell>
                        <TableCell className="text-right">{row.consultationsCount}</TableCell>
                        <TableCell className="text-right">{row.invoicesCount}</TableCell>
                        <TableCell className="text-right">{row.labOrdersCount}</TableCell>
                        <TableCell className="text-right">{row.dispensingCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-gray-500">
                          <LastActivity iso={row.lastActivityAt} emptyLabel={t('never')} />
                        </TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-gray-300" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent platform actions */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">{t('recentActionsTitle')}</h2>
            {actions.isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : (actions.data ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">{t('actionsEmpty')}</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {actions.data!.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-gray-700">
                      <ClipboardList className="h-3.5 w-3.5 text-teal-600" />
                      {a.action} <span className="text-gray-400">· {a.targetType} {maskId(a.targetId)}</span>
                    </span>
                    <ActionTimestamp iso={a.createdAt} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Honest scope note — no fabricated metrics */}
        <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>{t('roadmapNote')}</span>
        </div>
      </div>

      {drilldownId && (
        <ClinicDrilldown
          clinicId={drilldownId}
          row={rows.find(r => r.clinicId === drilldownId) ?? null}
          onClose={() => setDrilldownId(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function TileSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>
  )
}

function BreakdownCard({ title, map, order, labelFor }: {
  title: string; map: Record<string, number>; order: readonly string[]; labelFor: (key: string) => string
}) {
  const entries = orderedEntries(map, order)
  const max = Math.max(1, ...entries.map(([, n]) => n))
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400">—</p>
        ) : (
          <div className="space-y-2">
            {entries.map(([key, n]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-gray-600">{labelFor(key)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: `${(n / max) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-semibold text-gray-700">{n}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryCard({ icon: Icon, title, isLoading, metrics, note }: {
  icon: React.ElementType; title: string; isLoading: boolean
  metrics: { label: string; value: number }[]; note: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className="h-4 w-4 text-teal-700" /> {title}
        </p>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {metrics.map(m => (
              <div key={m.label} className="rounded-lg bg-gray-50 px-2 py-2 text-center">
                <p className="text-lg font-bold text-gray-900">{m.value}</p>
                <p className="text-[10px] text-gray-500">{m.label}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-tight text-muted-foreground/70">{note}</p>
      </CardContent>
    </Card>
  )
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-500', pending: 'bg-amber-400', suspended: 'bg-orange-400',
  inactive: 'bg-gray-400', rejected: 'bg-red-400', archived: 'bg-slate-400',
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs capitalize text-gray-600">
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status] ?? 'bg-gray-300')} />
      {status}
    </span>
  )
}

function LastActivity({ iso, emptyLabel }: { iso: string | null; emptyLabel: string }) {
  const { formatDate, formatTime } = useFormatters()
  if (!iso) return <span>{emptyLabel}</span>
  return <span>{formatDate(iso)} {formatTime(iso)}</span>
}

function ActionTimestamp({ iso }: { iso: string }) {
  const { formatDate, formatTime } = useFormatters()
  return <span className="text-xs text-gray-400">{formatDate(iso)} {formatTime(iso)}</span>
}

// ── Clinic drilldown (still no clinical data) ───────────────────────
function ClinicDrilldown({ clinicId, row, onClose }: {
  clinicId: string; row: ClinicActivityRow | null; onClose: () => void
}) {
  const t = useTranslations('adminActivity')
  const staff = useClinicStaff(clinicId, true)
  const auditActions = useClinicAuditActions(clinicId, 20, true)

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-teal-700" /> {row?.clinicName ?? t('clinicDrilldown')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Subscription / status */}
          {row && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label={t('colPlan')} value={row.subscriptionPlan} />
              <MiniStat label={t('drilldownSubStatus')} value={row.subscriptionStatus} />
              <MiniStat label={t('colStatus')} value={row.clinicStatus} />
              <MiniStat label={t('colUsers')} value={String(row.userCount)} />
            </div>
          )}

          {/* Activity totals for the selected range */}
          {row && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('drilldownActivity')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MiniStat label={t('colAppointments')} value={String(row.appointmentsCount)} />
                <MiniStat label={t('colConsultations')} value={String(row.consultationsCount)} />
                <MiniStat label={t('colInvoices')} value={String(row.invoicesCount)} />
                <MiniStat label={t('colLabOrders')} value={String(row.labOrdersCount)} />
                <MiniStat label={t('colDispensing')} value={String(row.dispensingCount)} />
                <MiniStat label={t('drilldownTotal')} value={String(activityTotal(row))} />
              </div>
            </div>
          )}

          {/* Staff */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('drilldownStaff')}</p>
            {staff.isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>
            ) : (staff.data ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">—</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {staff.data!.map(u => (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate font-medium text-gray-800">{u.fullName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className="capitalize">{u.role}</Badge>
                      {!u.isActive && <Badge variant="outline" className="text-gray-400">{t('inactive')}</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit (clinic lifecycle actions only) */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('drilldownAudit')}</p>
            {auditActions.isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>
            ) : (auditActions.data ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">—</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {auditActions.data!.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="text-gray-700">{a.action}</span>
                    <ActionTimestamp iso={a.createdAt} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-2">
      <p className="truncate text-sm font-semibold capitalize text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}
