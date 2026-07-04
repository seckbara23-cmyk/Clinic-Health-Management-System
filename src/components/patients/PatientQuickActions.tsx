'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Stethoscope, Pill, FlaskConical, CalendarPlus, Receipt, PackageCheck, Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateConsultation } from '@/hooks/useConsultations'
import { useCreateLabOrder, useLabTests } from '@/hooks/useLab'
import { useCreateAppointment } from '@/hooks/useAppointments'
import { useCreateInvoice } from '@/hooks/useInvoices'
import { toast } from 'sonner'
import type { AppointmentPriority } from '@/types/database'
import type { PatientQuickAction } from '@/lib/patient-intel'

interface Ctx {
  patientId: string
  patientName: string
  doctorId: string
  currency?: string
}

type DialogKey = null | 'lab' | 'appointment' | 'invoice'

export function PatientQuickActions({
  ctx, actions,
}: { ctx: Ctx; actions: PatientQuickAction[] }) {
  const t = useTranslations('patientProfile')
  const router = useRouter()
  const createConsultation = useCreateConsultation()
  const [open, setOpen] = useState<DialogKey>(null)

  // A prescription / dispensing needs a clinical encounter / pharmacy queue —
  // start a consultation (prescriptions are written there) or go to pharmacy.
  async function startConsultation() {
    try {
      const res = await createConsultation.mutateAsync({ patient_id: ctx.patientId, appointment_id: null, doctor_id: ctx.doctorId })
      router.push(`/consultations/${res.id}`)
    } catch { /* toasted by hook */ }
  }

  const BUTTONS: Record<PatientQuickAction, { icon: React.ElementType; label: string; color: string; onClick: () => void }> = {
    consultation: { icon: Stethoscope, label: t('qaConsultation'), color: 'text-teal-600',    onClick: startConsultation },
    prescription: { icon: Pill,        label: t('qaPrescription'), color: 'text-indigo-600',  onClick: startConsultation },
    lab:          { icon: FlaskConical, label: t('qaLab'),          color: 'text-amber-600',   onClick: () => setOpen('lab') },
    appointment:  { icon: CalendarPlus, label: t('qaAppointment'),  color: 'text-blue-600',    onClick: () => setOpen('appointment') },
    invoice:      { icon: Receipt,      label: t('qaInvoice'),      color: 'text-emerald-600', onClick: () => setOpen('invoice') },
    dispense:     { icon: PackageCheck, label: t('qaDispense'),     color: 'text-lime-600',    onClick: () => router.push('/pharmacy') },
  }
  const shown = actions.map(a => ({ key: a, ...BUTTONS[a] }))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t('quickActionsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {shown.map(b => (
            <button
              key={b.key}
              type="button"
              onClick={b.onClick}
              disabled={(b.key === 'consultation' || b.key === 'prescription') && createConsultation.isPending}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-white px-3 py-4 text-center transition-colors hover:border-teal-300 hover:bg-teal-50/40 disabled:opacity-50"
            >
              {(b.key === 'consultation' || b.key === 'prescription') && createConsultation.isPending
                ? <Loader2 className={`h-5 w-5 animate-spin ${b.color}`} />
                : <b.icon className={`h-5 w-5 ${b.color}`} />}
              <span className="text-xs font-medium text-gray-700">{b.label}</span>
            </button>
          ))}
        </div>
      </CardContent>

      {open === 'lab' && <LabDialog ctx={ctx} onClose={() => setOpen(null)} />}
      {open === 'appointment' && <AppointmentDialog ctx={ctx} onClose={() => setOpen(null)} />}
      {open === 'invoice' && <InvoiceDialog ctx={ctx} onClose={() => setOpen(null)} />}
    </Card>
  )
}

function LabDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const t = useTranslations('patientProfile')
  const { data: tests, isLoading } = useLabTests()
  const create = useCreateLabOrder()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priority, setPriority] = useState<AppointmentPriority>('normal')
  const [notes, setNotes] = useState('')

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
  })

  async function submit() {
    const chosen = (tests ?? []).filter(x => selected.has(x.id))
    if (chosen.length === 0) return
    await create.mutateAsync({
      patient_id: ctx.patientId, consultation_id: null, priority,
      clinical_notes: notes.trim() || null,
      tests: chosen.map(x => ({ lab_test_id: x.id, test_name: x.name })),
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>{t('qaLab')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="space-y-1.5">
            <Label>{t('labPriority')}</Label>
            <Select value={priority} onValueChange={v => setPriority(v as AppointmentPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">{t('priorityNormal')}</SelectItem>
                <SelectItem value="urgent">{t('priorityUrgent')}</SelectItem>
                <SelectItem value="emergency">{t('priorityEmergency')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('labTests')}</Label>
            {isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
            ) : (tests ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">{t('labNoTests')}</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                {(tests ?? []).map(x => (
                  <label key={x.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-50">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" checked={selected.has(x.id)} onChange={() => toggle(x.id)} />
                    <span className="flex-1 text-sm">{x.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t('notesLabel')}</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={selected.size === 0 || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('labCreate', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AppointmentDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const t = useTranslations('patientProfile')
  const create = useCreateAppointment()
  const [scheduledAt, setScheduledAt] = useState('')
  const [title, setTitle] = useState(t('apptDefaultTitle'))
  const [notes, setNotes] = useState('')

  async function submit() {
    if (!scheduledAt) { toast.error(t('quickApptDateRequired')); return }
    await create.mutateAsync({
      patient_id: ctx.patientId, doctor_id: ctx.doctorId || null,
      title: title.trim() || t('apptDefaultTitle'),
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_min: 30, status: 'scheduled', priority: 'normal', notes: notes.trim() || null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('qaAppointment')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('apptWhen')}</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('apptTitle')}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('notesLabel')}</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={!scheduledAt || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('apptCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InvoiceDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const t = useTranslations('patientProfile')
  const create = useCreateInvoice()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')

  const METHODS = [
    { value: 'cash', label: t('paymentCash') },
    { value: 'mobile_money', label: t('paymentMobile') },
    { value: 'card', label: t('paymentCard') },
    { value: 'insurance', label: t('paymentInsurance') },
    { value: 'other', label: t('paymentOther') },
  ]

  async function submit() {
    const subtotal = Number(amount) || 0
    if (subtotal <= 0) return
    await create.mutateAsync({
      patient_id: ctx.patientId, consultation_id: null,
      line_items: [{ description: t('invoiceConsult'), quantity: 1, unit_price: subtotal, total: subtotal }],
      subtotal, tax_amount: 0, discount_amount: 0, total_amount: subtotal, amount_paid: 0,
      currency: ctx.currency ?? 'XOF', status: 'draft', payment_method: method,
      due_date: null, paid_at: null, notes: null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('qaInvoice')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('invoiceAmount')}</Label>
            <Input type="number" min={0} step={100} placeholder="5000" value={amount} onChange={e => setAmount(e.target.value)} className="text-lg font-semibold" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('invoiceMethod')}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={!(Number(amount) > 0) || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('invoiceCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
