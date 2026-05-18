import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'

const INTL_LOCALE: Record<string, string> = { fr: 'fr-SN', en: 'en-US' }

// Raw shape returned by the get_clinic_analytics RPC (months use YYYY-MM-01 ISO strings)
interface RpcResult {
  revenue_by_month:      { month: string; revenue: number; invoiced: number }[]
  appointments_by_month: { month: string; total: number; completed: number; cancelled: number }[]
  patients_by_month:     { month: string; new: number }[]
  appt_status_breakdown: { name: string; value: number; fill: string }[]
  lab_status_breakdown:  { name: string; value: number; fill: string }[]
  kpis: {
    totalRevenue:          number
    totalInvoiced:         number
    totalAppointments:     number
    completedAppointments: number
    newPatients:           number
    totalConsultations:    number
    totalLabs:             number
    completionRate:        number
    collectionRate:        number
  }
}

export function useAnalytics() {
  const locale = useLocale()
  const intlLocale = INTL_LOCALE[locale] ?? 'fr-SN'
  const { clinic } = useClinic()
  const supabase = createClient()

  const labelMonth = (isoDate: string) =>
    new Date(isoDate).toLocaleDateString(intlLocale, { month: 'short', year: '2-digit' })

  return useQuery({
    queryKey: ['analytics', clinic?.id, locale],
    enabled: !!clinic,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Single RPC call replaces five raw-row queries.
      // Migration: supabase/021_analytics_rpc.sql must be applied first.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_clinic_analytics', { p_months: 12 })
      if (error) throw error

      const raw = data as RpcResult

      return {
        revenueByMonth:      raw.revenue_by_month.map(r => ({ ...r, month: labelMonth(r.month) })),
        appointmentsByMonth: raw.appointments_by_month.map(r => ({ ...r, month: labelMonth(r.month) })),
        patientsByMonth:     raw.patients_by_month.map(r => ({ ...r, month: labelMonth(r.month) })),
        apptStatusBreakdown: raw.appt_status_breakdown,
        labStatusBreakdown:  raw.lab_status_breakdown,
        kpis:                raw.kpis,
      }
    },
  })
}
