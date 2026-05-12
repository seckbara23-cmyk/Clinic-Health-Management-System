'use client'

import Link from 'next/link'
import { Users, CalendarDays, TrendingUp, Clock, Activity, ArrowUpRight, Stethoscope, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Topbar } from '@/components/layout/Topbar'
import { Badge } from '@/components/ui/badge'
import { useDashboardStats } from '@/hooks/useInvoices'
import { useTodayQueue } from '@/hooks/useAppointments'
import { useClinic } from '@/context/ClinicContext'
import { formatCurrency, formatTime, cn } from '@/lib/utils'

const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'destructive' }> = {
  scheduled: { label: 'Planifié', variant: 'info' },
  in_queue: { label: 'En attente', variant: 'warning' },
  in_progress: { label: 'En cours', variant: 'default' },
  completed: { label: 'Terminé', variant: 'success' },
  cancelled: { label: 'Annulé', variant: 'destructive' },
  no_show: { label: 'Absent', variant: 'destructive' },
}

export default function DashboardPage() {
  const { clinic } = useClinic()
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const { data: queue } = useTodayQueue()

  const statCards = [
    {
      title: 'Total Patients',
      value: stats?.total_patients ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      desc: 'Patients enregistrés',
    },
    {
      title: "Rendez-vous aujourd'hui",
      value: stats?.appointments_today ?? 0,
      icon: CalendarDays,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      desc: `${stats?.appointments_pending ?? 0} en attente`,
    },
    {
      title: "Consultations aujourd'hui",
      value: stats?.consultations_today ?? 0,
      icon: Stethoscope,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      desc: 'Consultations du jour',
    },
    {
      title: 'Recettes du jour',
      value: formatCurrency(stats?.revenue_today ?? 0),
      icon: TrendingUp,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      desc: 'Paiements reçus',
    },
    {
      title: 'Recettes du mois',
      value: formatCurrency(stats?.revenue_month ?? 0),
      icon: Activity,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      desc: `${new Date().toLocaleString('fr-SN', { month: 'long' })} ${new Date().getFullYear()}`,
    },
    {
      title: 'Factures impayées',
      value: stats?.unpaid_invoices ?? 0,
      icon: AlertCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
      desc: 'À encaisser',
    },
  ]

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title="Bonjour 👋"
        description={`Tableau de bord — ${clinic?.name ?? ''}`}
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
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
                <CardTitle className="text-base">File d&apos;attente — Aujourd&apos;hui</CardTitle>
                <CardDescription>{queue?.length ?? 0} patient(s)</CardDescription>
              </div>
              <Clock className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent className="space-y-3">
              {!queue || queue.length === 0 ? (
                <p className="text-center py-8 text-sm text-gray-400">Aucun rendez-vous aujourd&apos;hui</p>
              ) : (
                queue.slice(0, 8).map((appt) => {
                  const cfg = statusConfig[appt.status] ?? { label: appt.status, variant: 'default' as const }
                  const patient = (appt as { patient?: { full_name?: string } }).patient
                  return (
                    <div key={appt.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
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
              <CardTitle className="text-base">Actions rapides</CardTitle>
              <CardDescription>Raccourcis fréquents</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                { href: '/patients', label: 'Nouveau patient', icon: Users, color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                { href: '/appointments', label: 'Rendez-vous', icon: CalendarDays, color: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
                { href: '/consultations', label: 'Consultation', icon: Stethoscope, color: 'bg-teal-50 text-teal-700 hover:bg-teal-100' },
                { href: '/billing', label: 'Nouvelle facture', icon: TrendingUp, color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
              ].map(({ href, label, icon: Icon, color }) => (
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
