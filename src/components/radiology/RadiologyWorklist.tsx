'use client'

// ── Radiology worklist (Phase 39 — Radiora) ────────────────────────
// Deterministic, read-only worklist of imaging orders (KPIs + filters + list).
// Opening an order launches the reporting workspace. No interpretation.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Radiation, Search, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useRadiologyWorklist, type WorklistOrder } from '@/hooks/useRadiology'
import { filterWorklist, worklistKpis } from '@/lib/radiology/worklist'
import { ORDER_STATUSES, MODALITIES, PRIORITIES } from '@/lib/radiology/types'

const PRIORITY_STYLE: Record<string, string> = { stat: 'border-red-300 text-red-700', urgent: 'border-amber-300 text-amber-700', routine: '' }

export function RadiologyWorklist({ onOpen }: { onOpen: (o: WorklistOrder) => void }) {
  const t = useTranslations('radiology')
  const { data: orders, isLoading } = useRadiologyWorklist()
  const [status, setStatus] = useState<string>('')
  const [modality, setModality] = useState<string>('')
  const [priority, setPriority] = useState<string>('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [search, setSearch] = useState('')

  const kpis = useMemo(() => worklistKpis(orders), [orders])
  const rows = useMemo(
    () => filterWorklist(orders, { status: status || null, modality: modality || null, priority: priority || null, onlyOpen, search }) as WorklistOrder[],
    [orders, status, modality, priority, onlyOpen, search],
  )

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-white"><Radiation className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{t('title')}</p>
            <p className="text-[11px] text-gray-400">{t('subtitle')}</p>
          </div>
        </div>

        {/* KPIs */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <Badge variant="outline">{t('kpi_open', { count: kpis.open })}</Badge>
          <Badge variant="outline">{t('kpi_awaiting', { count: kpis.awaitingReport })}</Badge>
          {kpis.pendingReview > 0 && <Badge variant="outline" className="border-amber-300 text-amber-700">{t('kpi_review', { count: kpis.pendingReview })}</Badge>}
          {kpis.stat > 0 && <Badge variant="outline" className="border-red-300 text-red-700">{t('kpi_stat', { count: kpis.stat })}</Badge>}
          {kpis.unassigned > 0 && <Badge variant="outline">{t('kpi_unassigned', { count: kpis.unassigned })}</Badge>}
          <Badge variant="outline">{t('kpi_signed', { count: kpis.signed })}</Badge>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search')} className="h-8 w-52 pl-7 text-xs" />
          </div>
          <Select value={status || 'all'} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder={t('filterStatus')} /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('filterAll')}</SelectItem>{ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{t(`os_${s}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={modality || 'all'} onValueChange={v => setModality(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder={t('filterModality')} /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('filterAll')}</SelectItem>{MODALITIES.map(m => <SelectItem key={m} value={m}>{t(`mod_${m}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={priority || 'all'} onValueChange={v => setPriority(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder={t('filterPriority')} /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('filterAll')}</SelectItem>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{t(`prio_${p}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant={onlyOpen ? 'default' : 'outline'} className={cn('h-8 px-3 text-xs', onlyOpen && 'bg-teal-700 hover:bg-teal-800')} onClick={() => setOnlyOpen(v => !v)}>{t('onlyOpen')}</Button>
        </div>

        {/* List */}
        {isLoading ? <p className="py-6 text-center text-xs text-gray-400">…</p>
          : rows.length === 0 ? <p className="py-6 text-center text-xs text-gray-400">{t('empty')}</p> : (
          <div className="divide-y rounded-lg border">
            {rows.map(o => (
              <button key={o.id} onClick={() => onOpen(o)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{o.patientName || o.patientId}</p>
                  <p className="truncate text-[11px] text-gray-500">{t(`mod_${o.modality}`, {})} · {o.examType}{o.clinicalIndication ? ` — ${o.clinicalIndication}` : ''}</p>
                </div>
                {o.priority !== 'routine' && <Badge variant="outline" className={cn('text-[10px]', PRIORITY_STYLE[o.priority])}>{t(`prio_${o.priority}`)}</Badge>}
                <Badge variant="outline" className="text-[10px]">{t(`os_${o.status}`, {})}</Badge>
                <span className="hidden text-[10px] text-gray-400 sm:inline">{o.requestedAt.slice(0, 10)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
