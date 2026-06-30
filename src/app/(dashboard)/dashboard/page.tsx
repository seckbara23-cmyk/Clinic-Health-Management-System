'use client'

import Link from 'next/link'
import { Users, CalendarDays, TrendingUp, Clock, Activity, ArrowUpRight, Stethoscope, AlertCircle, Wrench, Building2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Topbar } from '@/components/layout/Topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDashboardStats } from '@/hooks/useInvoices'
import { useTodayQueue } from '@/hooks/useAppointments'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const { clinic, profile } = useClinic()
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const { data: queue } = useTodayQueue()
  const t = useTranslations('dashboard')
  const { formatCurrency, formatTime, intlLocale } = useFormatters()

  const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'destructive' }> = {
    scheduled:   { label: t('statusScheduled'),   variant: 'info' },
    in_queue:    { label: t('statusInQueue'),      variant: 'warning' },
    in_progress: { label: t('statusInProgress'),   variant: 'default' },
    completed:   { label: t('statusCompleted'),    variant: 'success' },
    cancelled:   { label: t('statusCancelled'),    variant: 'destructive' },
    no_show:     { label: t('statusNoShow'),       variant: 'destructive' },
  }

  const statCards = [
    {
      title: t('statTotalPatients'),
      value: stats?.total_patients ?? 0,
      icon: Users,
      color: 'text-green-700',
      bg: 'bg-green-50',
      desc: t('statTotalPatientsDesc'),
    },
    {
      title: t('statApptToday'),
      value: stats?.appointments_today ?? 0,
      icon: CalendarDays,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      desc: t('statApptTodayDesc', { count: stats?.appointments_pending ?? 0 }),
    },
    {
      title: t('statConsultToday'),
      value: stats?.consultations_today ?? 0,
      icon: Stethoscope,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      desc: t('statConsultTodayDesc'),
    },
    {
      title: t('statRevenueToday'),
      value: formatCurrency(stats?.revenue_today ?? 0),
      icon: TrendingUp,
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      desc: t('statRevenueTodayDesc'),
    },
    {
      title: t('statRevenueMonth'),
      value: formatCurrency(stats?.revenue_month ?? 0),
      icon: Activity,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      desc: `${new Date().toLocaleString(intlLocale, { month: 'long' })} ${new Date().getFullYear()}`,
    },
    {
      title: t('statUnpaidInvoices'),
      value: stats?.unpaid_invoices ?? 0,
      icon: AlertCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
      desc: t('statUnpaidInvoicesDesc'),
    },
  ]

  const quickActions = [
    { href: '/patients',     label: t('qaNewPatient'),   icon: Users,        color: 'bg-teal-50 text-teal-700 hover:bg-teal-100' },
    { href: '/appointments', label: t('qaAppointment'),  icon: CalendarDays, color: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
    { href: '/consultations',label: t('qaConsultation'), icon: Stethoscope,  color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
    { href: '/billing',      label: t('qaNewInvoice'),   icon: TrendingUp,   color: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title={t('title')}
        description={t('subtitle', { clinic: clinic?.name ?? '' })}
      />

      <div className="flex-1 p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto">
        {/* Onboarding banner */}
        {profile?.role === 'admin' && clinic && !clinic.onboarding_completed_at && (
          <div className="flex items-center gap-4 rounded-xl border-2 border-teal-200 bg-teal-50 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-teal-900">{t('onboardingTitle')}</p>
              <p className="text-xs text-teal-700 mt-0.5">
                {t('onboardingStep', { step: clinic.onboarding_step })}
              </p>
            </div>
            <Button size="sm" className="shrink-0 bg-teal-700 hover:bg-teal-800" asChild>
              <Link href="/onboarding">{t('onboardingCta')}</Link>
            </Button>
          </div>
        )}

        {/* ── Tenant hero banner — the clinic's identity is the centerpiece ──
            Everything is dynamic (clinic + profile from context); no new data
            fetch, no new dependency. Only the dashboard header changed. */}
        <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 shadow-sm">
          {/* Soft abstract shapes */}
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-cyan-200/40 blur-3xl" />
          {/* Very light medical cross pattern (inline SVG, no asset/dependency) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M18 8h4v8h8v4h-8v8h-4v-8h-8v-4h8z' fill='%230d9488'/%3E%3C/svg%3E\")",
              backgroundSize: '40px 40px',
            }}
          />
          {/* Soft hospital illustration watermark (hidden on small screens) */}
          <Building2
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 top-1/2 hidden h-72 w-72 -translate-y-1/2 text-teal-600/[0.06] lg:block"
            strokeWidth={1}
          />

          <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 py-10 text-center md:py-14">
            {/* Greeting (above the tenant name) */}
            <p className="text-sm font-medium text-teal-800 sm:text-base">
              {t('heroGreeting', { name: profile?.full_name ?? '' })}
            </p>

            {/* Connected-to label */}
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-600/80 sm:text-xs">
              {t('heroConnectedTo')}
            </p>

            {/* Tenant name — centered, uppercase, bold, very large, responsive,
                in the brand colour so it reads as THIS clinic's software. */}
            <h1 className="mt-2 break-words text-3xl font-extrabold uppercase leading-tight tracking-tight text-teal-700 sm:text-4xl md:text-5xl lg:text-6xl">
              {clinic?.name ?? t('welcomeTitle')}
            </h1>

            {/* Centered circular hospital icon, framed by a soft divider */}
            <div className="mt-6 flex w-full items-center justify-center gap-4">
              <span aria-hidden="true" className="h-px w-12 bg-teal-300/70 sm:w-24" />
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white shadow-md shadow-teal-900/20">
                <Building2 className="h-6 w-6" />
              </span>
              <span aria-hidden="true" className="h-px w-12 bg-teal-300/70 sm:w-24" />
            </div>

            {/* Tagline */}
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
              {t('heroTagline')}
            </p>
          </div>
        </section>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {statCards.map((card) => (
            <Card key={card.title} className="relative overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs font-medium">{card.title}</CardDescription>
                  <div className={cn('rounded-lg p-2', card.bg)}>
                    <card.icon className={cn('h-4 w-4', card.color)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '—' : card.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{card.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Today's Queue */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">{t('queueTitle')}</CardTitle>
                <CardDescription>{t('queueCount', { count: queue?.length ?? 0 })}</CardDescription>
              </div>
              <Clock className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent className="space-y-3">
              {!queue || queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-gray-400">
                  <Clock className="h-8 w-8 opacity-30" />
                  <p className="text-sm">{t('queueEmpty')}</p>
                </div>
              ) : (
                queue.slice(0, 8).map((appt) => {
                  const cfg = statusConfig[appt.status] ?? { label: appt.status, variant: 'default' as const }
                  const patient = (appt as { patient?: { full_name?: string } }).patient
                  return (
                    <div key={appt.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">
                          {appt.queue_number ?? '#'}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{patient?.full_name ?? '—'}</p>
                          <p className="text-xs text-gray-500">{formatTime(appt.scheduled_at)}</p>
                        </div>
                      </div>
                      <Badge variant={cfg.variant as 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'}>
                        {cfg.label}
                      </Badge>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quickActionsTitle')}</CardTitle>
              <CardDescription>{t('quickActionsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {quickActions.map(({ href, label, icon: Icon, color }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn('flex items-center gap-3 rounded-xl p-4 transition-colors', color)}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium leading-tight">{label}</span>
                  <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-60" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
