'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pill, FlaskConical, CalendarPlus, Receipt, Plus, Trash2, Loader2, Radiation } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SafetyAlerts } from '@/components/pharmacy/SafetyAlerts'
import { useCreatePrescription } from '@/hooks/usePrescriptions'
import { useCreateLabOrder, useLabTests } from '@/hooks/useLab'
import { useCreateAppointment } from '@/hooks/useAppointments'
import { useCreateInvoice } from '@/hooks/useInvoices'
import { useCreateRadiologyOrder } from '@/hooks/useRadiology'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { usePermissions } from '@/hooks/usePermissions'
import { MODALITIES, PRIORITIES } from '@/lib/radiology/types'
import type { Medication, AppointmentPriority } from '@/types/database'

interface QuickActionsCtx {
  consultationId: string
  patientId: string
  doctorId: string
  patientName: string
  allergies: string[] | null
  currency?: string
}

type ActiveDialog = null | 'rx' | 'lab' | 'imaging' | 'followup' | 'invoice'

export function QuickActions(ctx: QuickActionsCtx) {
  const t = useTranslations('consultationDetail')
  const { can } = usePermissions()
  const [open, setOpen] = useState<ActiveDialog>(null)
  const close = () => setOpen(null)

  const actions: { key: ActiveDialog; icon: React.ElementType; label: string; color: string }[] = [
    { key: 'rx',       icon: Pill,         label: t('actionNewRx'),      color: 'text-indigo-600' },
    { key: 'lab',      icon: FlaskConical, label: t('actionOrderLab'),   color: 'text-amber-600' },
    // Imaging order — only for clinicians who can reach radiology (doctor/admin).
    // This closes the Radiora workflow: the order is what populates the worklist.
    ...(can('radiology.view')
      ? [{ key: 'imaging' as const, icon: Radiation, label: t('actionOrderImaging'), color: 'text-teal-600' }]
      : []),
    { key: 'followup', icon: CalendarPlus, label: t('actionFollowUp'),   color: 'text-blue-600' },
    { key: 'invoice',  icon: Receipt,      label: t('actionInvoice'),    color: 'text-emerald-600' },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t('quickActionsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(a => (
            <button
              key={a.key}
              type="button"
              onClick={() => setOpen(a.key)}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-white px-3 py-3 text-center transition-colors hover:border-teal-300 hover:bg-teal-50/40"
            >
              <a.icon className={`h-5 w-5 ${a.color}`} />
              <span className="text-xs font-medium text-gray-700">{a.label}</span>
            </button>
          ))}
        </div>
      </CardContent>

      {open === 'rx'       && <PrescriptionDialog ctx={ctx} onClose={close} />}
      {open === 'lab'      && <LabOrderDialog ctx={ctx} onClose={close} />}
      {open === 'imaging'  && <ImagingOrderDialog ctx={ctx} onClose={close} />}
      {open === 'followup' && <FollowUpDialog ctx={ctx} onClose={close} />}
      {open === 'invoice'  && <InvoiceDialog ctx={ctx} onClose={close} />}
    </Card>
  )
}

// ─── Order Imaging (radiology) — populates the Radiora worklist ─────
function ImagingOrderDialog({ ctx, onClose }: { ctx: QuickActionsCtx; onClose: () => void }) {
  const t = useTranslations('consultationDetail')
  const tr = useTranslations('radiology')
  const create = useCreateRadiologyOrder()
  const [modality, setModality] = useState<string>('xray')
  const [examType, setExamType] = useState('')
  const [priority, setPriority] = useState<string>('routine')
  const [indication, setIndication] = useState('')

  async function submit() {
    if (!examType.trim()) return
    await create.mutateAsync({
      patientId: ctx.patientId,
      consultationId: ctx.consultationId,
      modality,
      examType: examType.trim(),
      clinicalIndication: indication.trim() || null,
      priority,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('actionOrderImaging')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('imagingModality')}</Label>
            <Select value={modality} onValueChange={setModality}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODALITIES.map(m => <SelectItem key={m} value={m}>{tr(`mod_${m}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('imagingExamType')}</Label>
            <Input
              placeholder={t('imagingExamPlaceholder')}
              value={examType}
              onChange={e => setExamType(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('imagingPriority')}</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(p => <SelectItem key={p} value={p}>{tr(`prio_${p}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('imagingIndication')}</Label>
            <Textarea rows={2} value={indication} onChange={e => setIndication(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={!examType.trim() || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('imagingCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── New Prescription (with embedded Phase 8 safety) ───────────────
function PrescriptionDialog({ ctx, onClose }: { ctx: QuickActionsCtx; onClose: () => void }) {
  const t = useTranslations('consultationDetail')
  const create = useCreatePrescription()
  const safety = useMedicationSafety()
  const [lines, setLines] = useState<Medication[]>([{ name: '', dosage: '', frequency: '', duration: '' }])
  const [instructions, setInstructions] = useState('')

  const filled = lines.filter(l => l.name.trim())
  const warnings = useMemo(
    () => safety.analyzeLines(filled.map(l => ({ medication_id: l.medication_id ?? null, name: l.name })), ctx.allergies),
    [safety, filled, ctx.allergies],
  )

  const setLine = (i: number, patch: Partial<Medication>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines(prev => [...prev, { name: '', dosage: '', frequency: '', duration: '' }])
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  async function submit() {
    if (filled.length === 0) return
    await create.mutateAsync({
      consultation_id: ctx.consultationId,
      patient_id: ctx.patientId,
      medications: filled,
      instructions: instructions.trim() || null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>{t('actionNewRx')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('rxMedName')}
                  value={l.name}
                  onChange={e => setLine(i, { name: e.target.value })}
                  className="flex-1"
                />
                {lines.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeLine(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder={t('rxDosage')} value={l.dosage} onChange={e => setLine(i, { dosage: e.target.value })} />
                <Input placeholder={t('rxFrequency')} value={l.frequency} onChange={e => setLine(i, { frequency: e.target.value })} />
                <Input placeholder={t('rxDuration')} value={l.duration} onChange={e => setLine(i, { duration: e.target.value })} />
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addLine}>
            <Plus className="h-4 w-4" /> {t('rxAddLine')}
          </Button>

          {warnings.length > 0 && <SafetyAlerts warnings={warnings} />}

          <div className="space-y-1.5">
            <Label>{t('rxInstructions')}</Label>
            <Textarea rows={2} value={instructions} onChange={e => setInstructions(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={filled.length === 0 || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('rxCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Order Lab Tests ───────────────────────────────────────────────
function LabOrderDialog({ ctx, onClose }: { ctx: QuickActionsCtx; onClose: () => void }) {
  const t = useTranslations('consultationDetail')
  const { data: tests, isLoading } = useLabTests()
  const create = useCreateLabOrder()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priority, setPriority] = useState<AppointmentPriority>('normal')
  const [notes, setNotes] = useState('')

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  async function submit() {
    const chosen = (tests ?? []).filter(x => selected.has(x.id))
    if (chosen.length === 0) return
    await create.mutateAsync({
      patient_id: ctx.patientId,
      consultation_id: ctx.consultationId,
      priority,
      clinical_notes: notes.trim() || null,
      tests: chosen.map(x => ({ lab_test_id: x.id, test_name: x.name })),
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>{t('actionOrderLab')}</DialogTitle>
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
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      checked={selected.has(x.id)}
                      onChange={() => toggle(x.id)}
                    />
                    <span className="flex-1 text-sm">{x.name}</span>
                    {x.category && <span className="text-xs text-gray-400">{x.category}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('labNotes')}</Label>
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

// ─── Schedule Follow-up ────────────────────────────────────────────
function FollowUpDialog({ ctx, onClose }: { ctx: QuickActionsCtx; onClose: () => void }) {
  const t = useTranslations('consultationDetail')
  const create = useCreateAppointment()
  const [scheduledAt, setScheduledAt] = useState('')
  const [title, setTitle] = useState(t('followUpDefaultTitle'))
  const [notes, setNotes] = useState('')

  async function submit() {
    if (!scheduledAt) return
    await create.mutateAsync({
      patient_id: ctx.patientId,
      doctor_id: ctx.doctorId,
      title: title.trim() || t('followUpDefaultTitle'),
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_min: 30,
      status: 'scheduled',
      priority: 'normal',
      notes: notes.trim() || null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('actionFollowUp')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('followUpWhen')}</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('followUpTitle')}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('labNotes')}</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={!scheduledAt || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('followUpCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Generate Invoice ──────────────────────────────────────────────
function InvoiceDialog({ ctx, onClose }: { ctx: QuickActionsCtx; onClose: () => void }) {
  const t = useTranslations('consultationDetail')
  const create = useCreateInvoice()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')

  const PAYMENT_METHODS = [
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
      patient_id: ctx.patientId,
      consultation_id: ctx.consultationId,
      line_items: [{ description: t('invoiceMedicalConsult'), quantity: 1, unit_price: subtotal, total: subtotal }],
      subtotal,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: subtotal,
      amount_paid: 0,
      currency: ctx.currency ?? 'XOF',
      status: 'draft',
      payment_method: method,
      due_date: null,
      paid_at: null,
      notes: null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('invoiceTitle')}</DialogTitle>
          <DialogDescription>{ctx.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('invoiceLabelAmount')}</Label>
            <Input
              type="number" min={0} step={100} placeholder="5000"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="text-lg font-semibold"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('invoiceLabelMethod')}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" onClick={submit} disabled={!(Number(amount) > 0) || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('invoiceCreateBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
