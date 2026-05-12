import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'

function monthRange(monthsBack: number) {
  const end = new Date()
  end.setDate(end.getDate() + 1) // include today
  const start = new Date()
  start.setMonth(start.getMonth() - monthsBack)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

function labelMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-SN', { month: 'short', year: '2-digit' })
}

export function useAnalytics() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const { start, end } = monthRange(11) // last 12 months

  return useQuery({
    queryKey: ['analytics', clinic?.id],
    enabled: !!clinic,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [invoicesRes, appointmentsRes, patientsRes, labsRes, consultationsRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('total_amount, amount_paid, status, created_at')
          .eq('clinic_id', clinic!.id)
          .gte('created_at', start)
          .lte('created_at', end),
        supabase
          .from('appointments')
          .select('status, created_at, scheduled_at')
          .eq('clinic_id', clinic!.id)
          .gte('created_at', start)
          .lte('created_at', end),
        supabase
          .from('patients')
          .select('created_at')
          .eq('clinic_id', clinic!.id)
          .gte('created_at', start)
          .lte('created_at', end),
        supabase
          .from('lab_requests')
          .select('status, created_at')
          .eq('clinic_id', clinic!.id)
          .gte('created_at', start)
          .lte('created_at', end),
        supabase
          .from('consultations')
          .select('created_at, diagnosis')
          .eq('clinic_id', clinic!.id)
          .gte('created_at', start)
          .lte('created_at', end),
      ])

      if (invoicesRes.error) throw invoicesRes.error
      if (appointmentsRes.error) throw appointmentsRes.error
      if (patientsRes.error) throw patientsRes.error
      if (labsRes.error) throw labsRes.error
      if (consultationsRes.error) throw consultationsRes.error

      const invoices = invoicesRes.data
      const appointments = appointmentsRes.data
      const patients = patientsRes.data
      const labs = labsRes.data
      const consultations = consultationsRes.data

      // Build 12-month buckets
      const months: string[] = []
      for (let i = 11; i >= 0; i--) {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }

      const revenueByMonth = months.map(m => ({
        month: labelMonth(m + '-01'),
        revenue: invoices
          .filter(inv => inv.created_at.startsWith(m) && inv.status === 'paid')
          .reduce((s, inv) => s + Number(inv.total_amount), 0),
        invoiced: invoices
          .filter(inv => inv.created_at.startsWith(m))
          .reduce((s, inv) => s + Number(inv.total_amount), 0),
      }))

      const appointmentsByMonth = months.map(m => ({
        month: labelMonth(m + '-01'),
        total: appointments.filter(a => a.created_at.startsWith(m)).length,
        completed: appointments.filter(a => a.created_at.startsWith(m) && a.status === 'completed').length,
        cancelled: appointments.filter(a => a.created_at.startsWith(m) && a.status === 'cancelled').length,
      }))

      const patientsByMonth = months.map(m => ({
        month: labelMonth(m + '-01'),
        new: patients.filter(p => p.created_at.startsWith(m)).length,
      }))

      // Appointment status breakdown (overall)
      const apptStatusBreakdown = [
        { name: 'Terminé',   value: appointments.filter(a => a.status === 'completed').length,  fill: '#10b981' },
        { name: 'Annulé',   value: appointments.filter(a => a.status === 'cancelled').length,  fill: '#ef4444' },
        { name: 'Absent',   value: appointments.filter(a => a.status === 'no_show').length,    fill: '#f59e0b' },
        { name: 'Planifié', value: appointments.filter(a => a.status === 'scheduled').length,  fill: '#3b82f6' },
        { name: 'En cours', value: appointments.filter(a => ['in_queue','in_progress'].includes(a.status)).length, fill: '#8b5cf6' },
      ].filter(s => s.value > 0)

      // Lab requests by status
      const labStatusBreakdown = [
        { name: 'Demandé',   value: labs.filter(l => l.status === 'ordered').length,    fill: '#3b82f6' },
        { name: 'Prélevé',   value: labs.filter(l => l.status === 'collected').length,  fill: '#8b5cf6' },
        { name: 'En cours',  value: labs.filter(l => l.status === 'processing').length, fill: '#f59e0b' },
        { name: 'Résulté',   value: labs.filter(l => l.status === 'resulted').length,   fill: '#10b981' },
        { name: 'Annulé',    value: labs.filter(l => l.status === 'cancelled').length,  fill: '#ef4444' },
      ].filter(s => s.value > 0)

      // KPIs
      const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total_amount), 0)
      const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total_amount), 0)
      const completionRate = appointments.length
        ? Math.round((appointments.filter(a => a.status === 'completed').length / appointments.length) * 100)
        : 0
      const collectionRate = totalInvoiced ? Math.round((totalRevenue / totalInvoiced) * 100) : 0

      return {
        revenueByMonth,
        appointmentsByMonth,
        patientsByMonth,
        apptStatusBreakdown,
        labStatusBreakdown,
        kpis: {
          totalRevenue,
          totalInvoiced,
          totalAppointments: appointments.length,
          completedAppointments: appointments.filter(a => a.status === 'completed').length,
          newPatients: patients.length,
          totalConsultations: consultations.length,
          totalLabs: labs.length,
          completionRate,
          collectionRate,
        },
      }
    },
  })
}
