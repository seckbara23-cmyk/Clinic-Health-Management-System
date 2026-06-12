import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('notifications')
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
          .from('lab_orders')
          .select('id, patient_name')
          .eq('clinic_id', clinic!.id)
          .eq('status', 'completed')
          .is('deleted_at', null)
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
          label: t('followUpToday'),
          detail: patient?.full_name ?? 'Patient',
          href: '/consultations',
        })
      }

      for (const l of labs.data ?? []) {
        const row = l as { id: string; patient_name?: string | null }
        notifications.push({
          id: `lab_${row.id}`,
          type: 'lab_result',
          label: t('labResult'),
          detail: row.patient_name ?? 'Patient',
          href: '/lab-orders',
        })
      }

      for (const inv of invoices.data ?? []) {
        const patient = (inv as { patient?: { full_name?: string } }).patient
        notifications.push({
          id: `inv_${inv.id}`,
          type: inv.status === 'overdue' ? 'overdue_invoice' : 'unpaid_invoice',
          label: inv.status === 'overdue' ? t('overdueInvoice') : t('partialPayment'),
          detail: `${inv.invoice_number} — ${patient?.full_name ?? '—'}`,
          href: '/billing',
        })
      }

      return notifications
    },
  })
}
