'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'
import { TrendingUp, Users, CalendarCheck, Stethoscope, FlaskConical, Percent, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useClinic } from '@/context/ClinicContext'
import { formatCurrency } from '@/lib/utils'

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color.replace('text-', 'bg-').replace('-700', '-100').replace('-600', '-100')}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const tooltipStyle = { fontSize: 12, borderRadius: 8 }

export default function AnalyticsPage() {
  const { profile } = useClinic()
  const { data, isLoading } = useAnalytics()

  const canView = ['admin', 'super_admin'].includes(profile?.role ?? '')

  if (!canView) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Analyses" />
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <p>Accès réservé aux administrateurs</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Analyses & Rapports" description="Statistiques sur les 12 derniers mois" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}

        {data && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                label="Revenus encaissés"
                value={formatCurrency(data.kpis.totalRevenue)}
                sub={`/ ${formatCurrency(data.kpis.totalInvoiced)} facturé`}
                icon={TrendingUp}
                color="text-emerald-700"
              />
              <KpiCard
                label="Nouveaux patients"
                value={data.kpis.newPatients}
                sub="12 derniers mois"
                icon={Users}
                color="text-blue-700"
              />
              <KpiCard
                label="Rendez-vous"
                value={data.kpis.totalAppointments}
                sub={`${data.kpis.completionRate}% complétés`}
                icon={CalendarCheck}
                color="text-violet-700"
              />
              <KpiCard
                label="Consultations"
                value={data.kpis.totalConsultations}
                sub={`${data.kpis.totalLabs} analyses`}
                icon={Stethoscope}
                color="text-amber-700"
              />
            </div>

            {/* Second row KPIs */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 shrink-0">
                    <Percent className="h-6 w-6 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Taux de recouvrement</p>
                    <p className="text-3xl font-bold text-emerald-700">{data.kpis.collectionRate}%</p>
                    <p className="text-xs text-gray-400">Montant encaissé / facturé</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 shrink-0">
                    <CalendarCheck className="h-6 w-6 text-violet-700" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Taux de complétion</p>
                    <p className="text-3xl font-bold text-violet-700">{data.kpis.completionRate}%</p>
                    <p className="text-xs text-gray-400">Rendez-vous terminés vs total</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Revenue chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenus mensuels (XOF)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.revenueByMonth} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value) => [formatCurrency(Number(value ?? 0)), '']}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="invoiced" name="Facturé" fill="#bfdbfe" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="revenue" name="Encaissé" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Appointments + patients charts side by side */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Rendez-vous par mois</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.appointmentsByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="total" name="Total" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="completed" name="Terminés" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cancelled" name="Annulés" fill="#fca5a5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nouveaux patients par mois</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.patientsByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="new" name="Nouveaux patients" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Pie charts */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Répartition des rendez-vous par statut</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.apptStatusBreakdown.length === 0 ? (
                    <p className="text-center text-gray-400 py-8 text-sm">Aucune donnée</p>
                  ) : (
                    <div className="flex items-center gap-6">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie
                            data={data.apptStatusBreakdown}
                            cx="50%" cy="50%"
                            innerRadius={45} outerRadius={75}
                            dataKey="value"
                          >
                            {data.apptStatusBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2 flex-1">
                        {data.apptStatusBreakdown.map((s, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                              <span className="text-gray-600">{s.name}</span>
                            </div>
                            <span className="font-semibold">{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FlaskConical className="h-4 w-4" /> Analyses par statut
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.labStatusBreakdown.length === 0 ? (
                    <p className="text-center text-gray-400 py-8 text-sm">Aucune donnée</p>
                  ) : (
                    <div className="flex items-center gap-6">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie
                            data={data.labStatusBreakdown}
                            cx="50%" cy="50%"
                            innerRadius={45} outerRadius={75}
                            dataKey="value"
                          >
                            {data.labStatusBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2 flex-1">
                        {data.labStatusBreakdown.map((s, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                              <span className="text-gray-600">{s.name}</span>
                            </div>
                            <span className="font-semibold">{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
