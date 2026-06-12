import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'

// Manual appointment-reminder resend. Posts to the service-role API route, which
// queues a one-off SMS and dispatches it immediately.
export function useResendReminder() {
  const qc = useQueryClient()
  const { clinic } = useClinic()

  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const res = await fetch('/api/sms/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_id: appointmentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Échec de l’envoi du SMS')
      return json as { ok: boolean; sms_message_id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinic?.id] })
      toast.success('Rappel SMS envoyé')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
