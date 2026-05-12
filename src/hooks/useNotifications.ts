import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'

export interface Notification {
  id: string
  type: 'follow_up' | 'lab_result' | 'overdue_invoice' | 'unpaid_invoice'
  label: string
  detail: string
  href: string
}

export function useNotifications() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const today = new Date().toISOString().slice(0, 10)

  return useQuery({
    queryKey: ['notifications', clinic?.id, today],
    enabled: !!clinic?.id,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<Notification[]> => {
      const [followUps, labs, invoices] = await Promise.all([
        supabase
          .from('consultations')
          .select('id, follow_up_date, patient:patients(full_name)')
          .eq('clinic_id', clinic!.id)
          .eq('follow_up_date', today)
          .limit(20),
        supabase
          .from('lab_requests')
          .select('id, test_name, patient:patients(full_name)')
          .eq('clinic_id', clinic!.id)
          .eq('status', 'resulted')
          .limit(20),
        supabase
          .from('invoices')
          .select('id, invoice_number, status, patient:patients(full_name)')
          .eq('clinic_id', clinic!.id)
          .in('status', ['overdue', 'partial'])
          .limit(20),
      ])

      const notifications: Notification[] = []

      for (const c of followUps.data ?? []) {
        const patient = (c as { patient?: { full_name?: string } }).patient
        notifications.push({
          id: `follow_up_${c.id}`,
          type: 'follow_up',
          label: 'Suivi prévu aujourd\'hui',
          detail: patient?.full_name ?? 'Patient',
          href: '/consultations',
        })
      }

      for (const l of labs.data ?? []) {
        const patient = (l as { patient?: { full_name?: string } }).patient
        notifications.push({
          id: `lab_${l.id}`,
          type: 'lab_result',
          label: 'Résultat disponible',
          detail: `${l.test_name} — ${patient?.full_name ?? 'Patient'}`,
          href: '/lab-requests',
        })
      }

      for (const inv of invoices.data ?? []) {
        const patient = (inv as { patient?: { full_name?: string } }).patient
        notifications.push({
          id: `inv_${inv.id}`,
          type: inv.status === 'overdue' ? 'overdue_invoice' : 'unpaid_invoice',
          label: inv.status === 'overdue' ? 'Facture en retard' : 'Paiement partiel',
          detail: `${inv.invoice_number} — ${patient?.full_name ?? '—'}`,
          href: '/billing',
        })
      }

      return notifications
    },
  })
}
