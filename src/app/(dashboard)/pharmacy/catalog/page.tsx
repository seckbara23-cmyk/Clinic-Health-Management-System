'use client'

import { useMemo, useState } from 'react'
import { Pill, Search, Layers, CheckCircle2, BookMarked, X } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMedicationCatalog } from '@/hooks/useMedications'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

const ALL = '__all__'

export default function MedicationCatalogPage() {
  const t = useTranslations('medicationCatalog')
  const { data: meds, isLoading } = useMedicationCatalog()

  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState(ALL)
  const [formFilter, setFormFilter] = useState(ALL)
  const [sourceFilter, setSourceFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL) // ALL | active | inactive

  const rows = useMemo(() => meds ?? [], [meds])

  // Distinct filter options, derived from the data itself (sorted, non-null).
  const { classes, forms, sources } = useMemo(() => {
    const c = new Set<string>()
    const f = new Set<string>()
    const s = new Set<string>()
    for (const m of rows) {
      if (m.therapeutic_class) c.add(m.therapeutic_class)
      if (m.dosage_form) f.add(m.dosage_form)
      if (m.source) s.add(m.source)
    }
    const sort = (set: Set<string>) => Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
    return { classes: sort(c), forms: sort(f), sources: sort(s) }
  }, [rows])

  // KPIs — always computed over the FULL dataset, independent of filters.
  const kpis = useMemo(() => {
    const total = rows.length
    const lnmpe = rows.filter(m => m.source === 'LNMPE 2025').length
    const active = rows.filter(m => m.is_active).length
    return [
      { label: t('kpiTotal'),   value: total,          icon: Pill,        color: 'text-teal-700',    bg: 'bg-teal-50' },
      { label: t('kpiLnmpe'),   value: lnmpe,          icon: BookMarked,  color: 'text-indigo-600',  bg: 'bg-indigo-50' },
      { label: t('kpiClasses'), value: classes.length, icon: Layers,      color: 'text-amber-700',   bg: 'bg-amber-50' },
      { label: t('kpiActive'),  value: active,         icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    ]
  }, [rows, classes.length, t])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(m => {
      if (classFilter !== ALL && m.therapeutic_class !== classFilter) return false
      if (formFilter !== ALL && m.dosage_form !== formFilter) return false
      if (sourceFilter !== ALL && m.source !== sourceFilter) return false
      if (statusFilter === 'active' && !m.is_active) return false
      if (statusFilter === 'inactive' && m.is_active) return false
      if (q) {
        const hay = [m.name, m.strength, m.dosage_form, m.therapeutic_class]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, classFilter, formFilter, sourceFilter, statusFilter])

  const hasFilters = search.trim() !== '' || classFilter !== ALL || formFilter !== ALL || sourceFilter !== ALL || statusFilter !== ALL
  function clearFilters() {
    setSearch(''); setClassFilter(ALL); setFormFilter(ALL); setSourceFilter(ALL); setStatusFilter(ALL)
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 p-5 shadow-sm md:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-teal-200/30 blur-3xl" />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white shadow-md shadow-teal-900/20">
                <BookMarked className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{t('heroTitle')}</h1>
                <p className="text-sm font-semibold text-teal-700">{t('heroSubtitle')}</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">{t('heroHelper')}</p>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0 bg-white/70 text-teal-800">
              {t('badgeTotal', { count: rows.length })}
            </Badge>
          </div>
        </section>

        {/* KPI cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(kpi => (
            <Card key={kpi.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', kpi.bg)}>
                  <kpi.icon className={cn('h-5 w-5', kpi.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900">{isLoading ? '—' : kpi.value}</p>
                  <p className="truncate text-xs text-gray-500">{kpi.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger><SelectValue placeholder={t('allClasses')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allClasses')}</SelectItem>
                  {classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={formFilter} onValueChange={setFormFilter}>
                <SelectTrigger><SelectValue placeholder={t('allForms')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allForms')}</SelectItem>
                  {forms.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder={t('allSources')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allSources')}</SelectItem>
                  {sources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder={t('allStatus')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allStatus')}</SelectItem>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="inactive">{t('inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isLoading && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">{t('resultsCount', { count: filtered.length })}</p>
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5" /> {t('clearFilters')}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="ml-auto h-4 w-16" />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && rows.length === 0 && (
              <EmptyState icon={Pill} title={t('emptyTitle')} description={t('emptyDesc')} />
            )}

            {!isLoading && rows.length > 0 && filtered.length === 0 && (
              <EmptyState icon={Search} title={t('noResultsTitle')} description={t('noResultsDesc')}
                action={{ label: t('clearFilters'), onClick: clearFilters }} />
            )}

            {!isLoading && filtered.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colName')}</TableHead>
                      <TableHead>{t('colStrength')}</TableHead>
                      <TableHead>{t('colForm')}</TableHead>
                      <TableHead>{t('colClass')}</TableHead>
                      <TableHead>{t('colSource')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(m => (
                      <TableRow key={m.id} className={m.is_active ? undefined : 'opacity-60'}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-sm text-gray-500">{m.strength ?? '—'}</TableCell>
                        <TableCell className="text-sm text-gray-500">{m.dosage_form ?? '—'}</TableCell>
                        <TableCell className="text-sm text-gray-500">{m.therapeutic_class ?? '—'}</TableCell>
                        <TableCell className="text-sm">
                          {m.source
                            ? <Badge variant="outline" className="text-indigo-700 border-indigo-200">{m.source}</Badge>
                            : <span className="text-gray-400">—</span>}
                        </TableCell>
                        <TableCell>
                          {m.is_active
                            ? <Badge variant="secondary" className="text-emerald-700">{t('active')}</Badge>
                            : <Badge variant="outline" className="text-gray-500">{t('inactive')}</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
