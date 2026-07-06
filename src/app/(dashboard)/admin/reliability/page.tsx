'use client'

// ── Platform Reliability & Bug Monitoring (Phase 15.0B) ────────────
//
// Super_admin operational monitoring: tenant health, active incidents, error
// events, recurring bugs — across all clinics, with NO clinical data. Every
// value comes from the aggregate/incident RPCs (043), each server-gated by
// is_super_admin(). Messages are PII-sanitized at write time; ids shown are
// masked. This page reads no clinical table and performs no clinical action.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ShieldAlert, AlertTriangle, AlertOctagon, Activity, HeartPulse, Search,
  Loader2, CheckCircle2, RotateCcw, Info, Layers,
} from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  usePlatformReliabilityOverview, useTenantHealth, usePlatformIncidents,
  useResolveIncident, healthLevelCounts, type TenantHealthRow,
} from '@/hooks/useReliability'
import { resolveDateRange, filterClinicRows, maskId, type DateRangeFilter } from '@/lib/platform-activity'
import { suggestedAction, type HealthLevel, type ReliabilityEvent } from '@/lib/reliability'

const RANGE_FILTERS: DateRangeFilter[] = ['today', 'yesterday', '7d', '30d']

const HEALTH_STYLE: Record<HealthLevel, { dot: string; text: string; bg: string }> = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  yellow: { dot: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50' },
  orange: { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50' },
  red: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
}
const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-red-300 text-red-700', error: 'border-orange-300 text-orange-700',
  warning: 'border-yellow-300 text-yellow-700', info: 'border-gray-300 text-gray-600',
}

export default function ReliabilityPage() {
  const t = useTranslations('adminReliability')
  const { profile } = useClinic()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7d')
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(true)

  const range = useMemo(() => resolveDateRange(rangeFilter, new Date()), [rangeFilter])
  const overview = usePlatformReliabilityOverview(range, isSuperAdmin)
  const health = useTenantHealth(range, isSuperAdmin)
  const incidents = usePlatformIncidents(range, openOnly, isSuperAdmin)
  const resolve = useResolveIncident()

  const healthRows = useMemo(() => health.data ?? [], [health.data])
  const shownHealth = useMemo(() => filterClinicRows(healthRows, query), [healthRows, query])
  const sortedHealth = useMemo(
    () => [...shownHealth].sort((a, b) => a.health.score - b.health.score),
    [shownHealth],
  )
  const levelCounts = useMemo(() => healthLevelCounts(healthRows), [healthRows])

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
  const tiles = [
    { label: t('statOpenIncidents'), value: ov?.openCount ?? 0, icon: ShieldAlert, color: 'text-orange-700', bg: 'bg-orange-50' },
    { label: t('statCritical'), value: ov?.criticalOpen ?? 0, icon: AlertOctagon, color: 'text-red-700', bg: 'bg-red-50' },
    { label: t('statEvents'), value: ov?.eventCount ?? 0, icon: Activity, color: 'text-violet-700', bg: 'bg-violet-50' },
    { label: t('statAffectedClinics'), value: ov?.affectedClinics ?? 0, icon: Layers, color: 'text-blue-700', bg: 'bg-blue-50' },
    { label: t('statHealthyClinics'), value: levelCounts.green, icon: HeartPulse, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  ]

  async function onResolve(id: string, resolved: boolean) {
    try { await resolve.mutateAsync({ id, resolved }); toast.success(resolved ? t('toastResolved') : t('toastReopened')) }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        {/* Privacy notice */}
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{t('privacyNotice')}</span>
        </div>

        {/* Range filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('rangeLabel')}</span>
          {RANGE_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setRangeFilter(f)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors',
                rangeFilter === f ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
            >
              {t(`range_${f}`)}
            </button>
          ))}
        </div>

        {/* Overview tiles */}
        {overview.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {tiles.map(tile => (
              <div key={tile.label} className={cn('rounded-xl p-3 md:p-4', tile.bg)}>
                <p className="flex items-center gap-1.5 text-[10px] md:text-xs font-medium text-gray-500">
                  <tile.icon className="h-3.5 w-3.5" /> {tile.label}
                </p>
                <p className={cn('text-lg md:text-2xl font-bold mt-1', tile.color)}>{tile.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Health distribution */}
        <div className="flex flex-wrap gap-2">
          {(['green', 'yellow', 'orange', 'red'] as HealthLevel[]).map(level => (
            <div key={level} className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium', HEALTH_STYLE[level].bg, HEALTH_STYLE[level].text)}>
              <span className={cn('h-2 w-2 rounded-full', HEALTH_STYLE[level].dot)} />
              {t(`health_${level}`)}: {levelCounts[level] ?? 0}
            </div>
          ))}
        </div>

        {/* Tenant health table */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t('tenantHealthTitle')}</h2>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-8 h-8 text-sm" />
              </div>
            </div>
            {health.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : sortedHealth.length === 0 ? (
              <EmptyState icon={HeartPulse} title={t('emptyHealthTitle')} description={t('emptyHealthDesc')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colClinic')}</TableHead>
                      <TableHead>{t('colHealth')}</TableHead>
                      <TableHead className="text-right">{t('colScore')}</TableHead>
                      <TableHead className="text-right">{t('colCritical')}</TableHead>
                      <TableHead className="text-right">{t('colErrors')}</TableHead>
                      <TableHead className="text-right">{t('colWarnings')}</TableHead>
                      <TableHead className="text-right">{t('colSmsFailed')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedHealth.map(row => <HealthRow key={row.clinicId} row={row} t={t} />)}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Incident / bug list */}
        <Card>
          <CardContent className="p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t('incidentsTitle')}</h2>
              <button
                onClick={() => setOpenOnly(o => !o)}
                className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  openOnly ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
              >
                {openOnly ? t('showOpenOnly') : t('showAll')}
              </button>
            </div>
            {incidents.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : (incidents.data ?? []).length === 0 ? (
              <EmptyState icon={CheckCircle2} title={t('emptyIncidentsTitle')} description={t('emptyIncidentsDesc')} />
            ) : (
              <div className="space-y-2">
                {incidents.data!.map(ev => (
                  <IncidentCard key={ev.id} ev={ev} t={t} onResolve={onResolve} busy={resolve.isPending} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>{t('scopeNote')}</span>
        </div>
      </div>
    </div>
  )
}

function HealthRow({ row, t }: { row: TenantHealthRow; t: ReturnType<typeof useTranslations> }) {
  const s = HEALTH_STYLE[row.health.level]
  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap">{row.clinicName}</TableCell>
      <TableCell>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', s.bg, s.text)}>
          <span className={cn('h-2 w-2 rounded-full', s.dot)} /> {t(`health_${row.health.level}`)}
        </span>
      </TableCell>
      <TableCell className="text-right font-semibold">{row.health.score}</TableCell>
      <TableCell className="text-right">{row.criticalCount || '—'}</TableCell>
      <TableCell className="text-right">{row.errorCount || '—'}</TableCell>
      <TableCell className="text-right">{row.warningCount || '—'}</TableCell>
      <TableCell className="text-right">{row.smsFailedCount || '—'}</TableCell>
    </TableRow>
  )
}

function IncidentCard({ ev, t, onResolve, busy }: {
  ev: ReliabilityEvent; t: ReturnType<typeof useTranslations>
  onResolve: (id: string, resolved: boolean) => void; busy: boolean
}) {
  const { formatDate, formatTime } = useFormatters()
  return (
    <div className={cn('rounded-xl border p-3', ev.resolved && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('text-[10px]', SEVERITY_STYLE[ev.severity] ?? SEVERITY_STYLE.info)}>
              {t(`severity_${ev.severity}`)}
            </Badge>
            <span className="text-xs font-medium text-gray-700">{ev.module}</span>
            <span className="font-mono text-[11px] text-gray-400">{ev.route}</span>
            {ev.occurrenceCount > 1 && (
              <Badge variant="outline" className="gap-1 text-[10px] text-gray-500">
                <RotateCcw className="h-3 w-3" /> ×{ev.occurrenceCount}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-gray-800">{ev.message || t(`type_${ev.errorType}`)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
            {ev.clinicName && <span>{ev.clinicName}</span>}
            {ev.affectedRole && <span>· {ev.affectedRole}</span>}
            {ev.clientInfo && <span>· {ev.clientInfo}</span>}
            {ev.lastSeen && <span>· {formatDate(ev.lastSeen)} {formatTime(ev.lastSeen)}</span>}
            <span>· {t('idLabel')} {maskId(ev.id)}</span>
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-teal-600">
            <AlertTriangle className="h-3 w-3" /> {t(`action_${suggestedAction(ev.errorType)}`)}
          </p>
        </div>
        <Button
          size="sm"
          variant={ev.resolved ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => onResolve(ev.id, !ev.resolved)}
          className="shrink-0"
        >
          {ev.resolved ? <><RotateCcw className="h-3.5 w-3.5" /> {t('reopen')}</> : <><CheckCircle2 className="h-3.5 w-3.5" /> {t('resolve')}</>}
        </Button>
      </div>
    </div>
  )
}
