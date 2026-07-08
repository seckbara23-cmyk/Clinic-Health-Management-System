'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Users, UserCheck, UserMinus, BadgeAlert, CalendarClock, FileWarning,
  UserPlus, Building2, Stethoscope, Sparkles, Search, Loader2, ChevronRight,
} from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePermissions } from '@/hooks/usePermissions'
import { useFormatters } from '@/hooks/useFormatters'
import { useWorkforceMembers, useClinicCredentials, useClinicTrainings } from '@/hooks/useWorkforce'
import { buildWorkforceDashboard } from '@/lib/workforce/dashboard'
import { workforceInsights } from '@/lib/workforce/insights'
import { filterWorkforce, distinctLanguages, type WorkforceFilters } from '@/lib/workforce/search'
import { listDepartments, departmentLabelKey } from '@/lib/workforce/departments'
import { EMPLOYMENT_STATUSES } from '@/lib/workforce/lifecycle'
import { cn } from '@/lib/utils'
import { Chip, STATUS_STYLES, STATUS_LABEL_KEY, tierStyle, prettifySpecialty } from '@/components/workforce/common'
import type { Role } from '@/types/database'

const ROLES: Role[] = ['admin', 'doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist']

export default function WorkforcePage() {
  const t = useTranslations('workforce')
  const { formatDate } = useFormatters()
  const { can } = usePermissions()
  const now = useMemo(() => new Date(), [])
  // Phase 41: page access resolved through the Enterprise Authorization engine
  // (was a hardcoded admin/super_admin role check; maps 1:1 to workforce.view).
  const isAdmin = can('workforce.view')

  const { data: members, isLoading } = useWorkforceMembers()
  const { data: credentials } = useClinicCredentials()
  const { data: trainings } = useClinicTrainings()

  const [filters, setFilters] = useState<WorkforceFilters>({})

  const dashboard = useMemo(
    () => buildWorkforceDashboard({ members: members ?? [], credentials: credentials ?? [], trainings: trainings ?? [], now }),
    [members, credentials, trainings, now],
  )
  const insights = useMemo(
    () => workforceInsights({ dashboard, members: members ?? [] }),
    [dashboard, members],
  )
  const filtered = useMemo(
    () => filterWorkforce(members ?? [], filters, { credentials: credentials ?? [], now }),
    [members, filters, credentials, now],
  )
  const languages = useMemo(() => distinctLanguages(members ?? []), [members])

  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t('title')} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
          <Users className="h-12 w-12 opacity-30" />
          <p>{t('noAccess')}</p>
        </div>
      </div>
    )
  }

  function setFilter<K extends keyof WorkforceFilters>(key: K, value: WorkforceFilters[K] | undefined) {
    setFilters(f => ({ ...f, [key]: value || undefined }))
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi icon={UserCheck}  color="text-emerald-600" label={t('kpiActive')}      value={dashboard.activeCount} />
          <Kpi icon={UserMinus}  color="text-amber-600"   label={t('kpiOnLeave')}     value={dashboard.onLeaveCount} />
          <Kpi icon={BadgeAlert} color="text-orange-600"  label={t('kpiSuspended')}   value={dashboard.suspendedCount} />
          <Kpi icon={FileWarning} color="text-rose-600"   label={t('kpiExpLicenses')} value={dashboard.expiringLicenses.length} />
          <Kpi icon={CalendarClock} color="text-purple-600" label={t('kpiExpContracts')} value={dashboard.expiringContracts.length} />
          <Kpi icon={UserPlus}   color="text-teal-600"    label={t('kpiRecentHires')} value={dashboard.recentlyHired.length} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Operational insights */}
          <Card className="lg:col-span-2">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-600" />
                <h2 className="text-sm font-semibold text-gray-900">{t('insightsTitle')}</h2>
              </div>
              {insights.length === 0 ? (
                <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">{t('insightsEmpty')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {insights.map((ins, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        ins.severity === 'critical' ? 'bg-rose-500' : ins.severity === 'warning' ? 'bg-amber-500' : 'bg-gray-300')} />
                      <span className="text-gray-700">{t(ins.labelKey, ins.params)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Distributions */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <Distribution title={t('deptDistribution')} icon={Building2}
                items={dashboard.departmentDistribution.map(d => ({ label: t(departmentLabelKey(d.key === 'unassigned' ? null : d.key)), count: d.count }))} />
              <Distribution title={t('specialtyDistribution')} icon={Stethoscope}
                items={dashboard.specialtyDistribution.map(d => ({ label: d.key === 'unassigned' ? t('unassigned') : prettifySpecialty(d.key), count: d.count }))} />
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input className="pl-9" placeholder={t('searchPlaceholder')} value={filters.query ?? ''} onChange={e => setFilter('query', e.target.value)} />
              </div>
              <FilterSelect value={filters.department} placeholder={t('filterDepartment')} onChange={v => setFilter('department', v)}
                options={listDepartments().map(d => ({ value: d.code, label: t(d.labelKey) }))} />
              <FilterSelect value={filters.employmentStatus} placeholder={t('filterStatus')} onChange={v => setFilter('employmentStatus', v as WorkforceFilters['employmentStatus'])}
                options={EMPLOYMENT_STATUSES.map(s => ({ value: s, label: t(STATUS_LABEL_KEY[s]) }))} />
              <FilterSelect value={filters.role} placeholder={t('filterRole')} onChange={v => setFilter('role', v as Role)}
                options={ROLES.map(r => ({ value: r, label: t(`role_${r}`) }))} />
              <FilterSelect value={filters.credentialExpiry} placeholder={t('filterExpiry')} onChange={v => setFilter('credentialExpiry', v as WorkforceFilters['credentialExpiry'])}
                options={[{ value: 'expiring', label: t('expiryExpiring') }, { value: 'expired', label: t('expiryExpired') }]} />
              {languages.length > 0 && (
                <FilterSelect value={filters.language} placeholder={t('filterLanguage')} onChange={v => setFilter('language', v)}
                  options={languages.map(l => ({ value: l, label: l }))} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Member list */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">{t('colName')}</th>
                    <th className="px-4 py-3">{t('colRole')}</th>
                    <th className="px-4 py-3">{t('colDepartment')}</th>
                    <th className="px-4 py-3">{t('colStatus')}</th>
                    <th className="px-4 py-3">{t('colHired')}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></td></tr>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={6} className="py-12 text-center text-gray-400">
                      <Users className="mx-auto mb-3 h-10 w-10 opacity-30" /><p>{t('emptyList')}</p>
                    </td></tr>
                  )}
                  {filtered.map(m => {
                    const st = m.employee?.employmentStatus
                    return (
                      <tr key={m.userId} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{m.fullName}</p>
                          <p className="text-xs text-gray-400">{m.email}</p>
                        </td>
                        <td className="px-4 py-3 capitalize text-gray-600">{t(`role_${m.role}`)}</td>
                        <td className="px-4 py-3 text-gray-600">{t(departmentLabelKey(m.employee?.department ?? null))}</td>
                        <td className="px-4 py-3">
                          {st ? <Chip className={STATUS_STYLES[st]}>{t(STATUS_LABEL_KEY[st])}</Chip>
                              : <Chip className={tierStyle(null)}>{t('noEmploymentRecord')}</Chip>}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{m.employee?.hireDate ? formatDate(m.employee.hireDate) : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/workforce/${m.userId}`} className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
                            {t('open')} <ChevronRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ icon: Icon, color, label, value }: { icon: React.ElementType; color: string; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <Icon className={cn('h-5 w-5', color)} />
        <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </CardContent>
    </Card>
  )
}

function Distribution({ title, icon: Icon, items }: { title: string; icon: React.ElementType; items: { label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map(i => i.count))
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.slice(0, 6).map((it, i) => (
          <li key={i} className="text-xs">
            <div className="mb-0.5 flex justify-between text-gray-600"><span>{it.label}</span><span className="font-medium">{it.count}</span></div>
            <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-teal-500" style={{ width: `${(it.count / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterSelect({ value, placeholder, onChange, options }: {
  value?: string; placeholder: string; onChange: (v: string | undefined) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value ?? '__all'} onValueChange={v => onChange(v === '__all' ? undefined : v)}>
      <SelectTrigger className="w-auto min-w-[130px]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{placeholder}</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
