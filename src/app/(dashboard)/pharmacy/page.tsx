'use client'

import { useState } from 'react'
import { Loader2, Pill, Eye, CheckCircle2, Receipt } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useInventory, useDispensings, useDispense, useGenerateDispensingInvoice } from '@/hooks/usePharmacy'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { Prescription, Medication, ClinicMedicationInventory, MedicationDispensing } from '@/types/database'

type RxRow = Prescription & { patient?: { full_name?: string; patient_number?: string }; doctor?: { full_name?: string } }

const statusColors: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  partially_dispensed: 'bg-amber-100 text-amber-700',
  dispensed: 'bg-emerald-100 text-emerald-700',
}

export default function PharmacyPage() {
  const t = useTranslations('pharmacy')
  const { formatDate } = useFormatters()
  const { data: prescriptions, isLoading } = usePrescriptions()
  const [target, setTarget] = useState<RxRow | null>(null)

  const queue = (prescriptions as RxRow[] | undefined)?.filter(rx => ['active', 'partially_dispensed'].includes(rx.status)) ?? []
  const statusLabels: Record<string, string> = {
    active: t('rxActive'), partially_dispensed: t('rxPartial'), dispensed: t('rxDispensed'),
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('dispensingTitle')} description={t('dispensingSubtitle')} />
      <div className="flex-1 p-4 md:p-6 space-y-4">
        <Card>
          <CardContent className="p-0">
            {isLoading && <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
            {!isLoading && queue.length === 0 && (
              <EmptyState icon={Pill} title={t('queueEmptyTitle')} description={t('queueEmptyDesc')} />
            )}
            {!isLoading && queue.length > 0 && (
              <div className="divide-y">
                {queue.map(rx => (
                  <div key={rx.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{rx.patient?.full_name ?? '—'}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                        <span>{rx.medications.length} {t('medsUnit')}</span>
                        <span>· {formatDate(rx.created_at)}</span>
                        {rx.doctor?.full_name && <span>· Dr. {rx.doctor.full_name}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[rx.status])}>{statusLabels[rx.status]}</span>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setTarget(rx)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> {t('dispense')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {target && <DispenseDialog rx={target} onClose={() => setTarget(null)} />}
    </div>
  )
}

function DispenseDialog({ rx, onClose }: { rx: RxRow; onClose: () => void }) {
  const t = useTranslations('pharmacy')
  const { data: inventory } = useInventory(false)
  const { data: dispensings } = useDispensings({ prescriptionId: rx.id })
  const generateInvoice = useGenerateDispensingInvoice()

  const hasBillable = (dispensings ?? []).some(d => ['dispensed', 'partial'].includes(d.status) && d.quantity_dispensed > 0 && !d.invoice_id)

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pill className="h-5 w-5" /> {rx.patient?.full_name ?? '—'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {(rx.medications as Medication[]).map((med, idx) => (
            <DispenseLine
              key={idx}
              prescriptionId={rx.id}
              lineIndex={idx}
              med={med}
              inventory={inventory ?? []}
              dispensings={(dispensings ?? []).filter(d => d.prescription_line_index === idx)}
            />
          ))}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {hasBillable && (
            <Button variant="outline" onClick={() => generateInvoice.mutate(rx.id)} disabled={generateInvoice.isPending}>
              {generateInvoice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              {t('generateInvoice')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DispenseLine({ prescriptionId, lineIndex, med, inventory, dispensings }: {
  prescriptionId: string
  lineIndex: number
  med: Medication
  inventory: ClinicMedicationInventory[]
  dispensings: MedicationDispensing[]
}) {
  const t = useTranslations('pharmacy')
  const dispense = useDispense()
  const inv = med.medication_id ? inventory.find(i => i.medication_id === med.medication_id) : undefined
  const stock = inv?.stock_quantity ?? 0

  const alreadyDispensed = dispensings.filter(d => d.status !== 'unavailable').reduce((s, d) => s + d.quantity_dispensed, 0)
  const isUnavailable = dispensings.some(d => d.status === 'unavailable')
  const prescribedKnown = dispensings.reduce((m, d) => Math.max(m, d.quantity_prescribed), 0)
  const resolved = isUnavailable || (prescribedKnown > 0 && alreadyDispensed >= prescribedKnown)

  const [qtyPresc, setQtyPresc] = useState(prescribedKnown > 0 ? String(prescribedKnown) : '1')
  const [qtyDisp, setQtyDisp] = useState('')
  const [subNotes, setSubNotes] = useState('')
  const [unavailOpen, setUnavailOpen] = useState(false)
  const [reason, setReason] = useState('')

  async function doDispense() {
    const qd = Number(qtyDisp)
    if (!qd || qd <= 0) return
    await dispense.mutateAsync({
      prescription_id: prescriptionId, line_index: lineIndex,
      medication_id: med.medication_id ?? null, inventory_id: inv?.id ?? null,
      medication_name: med.name, quantity_prescribed: Number(qtyPresc) || 0, quantity_dispensed: qd,
      substitution_notes: subNotes || null,
    })
    setQtyDisp(''); setSubNotes('')
  }
  async function doUnavailable() {
    await dispense.mutateAsync({
      prescription_id: prescriptionId, line_index: lineIndex,
      medication_id: med.medication_id ?? null, inventory_id: inv?.id ?? null,
      medication_name: med.name, quantity_prescribed: Number(qtyPresc) || 0, quantity_dispensed: 0,
      unavailable_reason: reason || t('unavailableDefault'),
    })
    setUnavailOpen(false); setReason('')
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{med.name}</p>
          <p className="text-xs text-gray-500">
            {[med.dosage, med.frequency, med.duration].filter(Boolean).join(' · ')}
            {med.dosage_form && <span className="ml-1 text-gray-400">({med.dosage_form})</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          {med.medication_id
            ? <span className={cn('text-xs font-medium', stock > 0 ? 'text-gray-600' : 'text-red-600')}>{t('inStock', { n: stock })}</span>
            : <span className="text-xs text-gray-400">{t('notInCatalog')}</span>}
          {alreadyDispensed > 0 && <span className="block text-xs text-emerald-600">{t('dispensedSoFar', { n: alreadyDispensed })}</span>}
        </div>
      </div>

      {resolved ? (
        <Badge variant="outline" className={cn('text-xs', isUnavailable ? 'text-red-600 border-red-200' : 'text-emerald-700 border-emerald-200')}>
          {isUnavailable ? t('lineUnavailable') : t('lineDispensed')}
        </Badge>
      ) : unavailOpen ? (
        <div className="flex items-center gap-2">
          <Input placeholder={t('unavailableReason')} value={reason} onChange={e => setReason(e.target.value)} className="h-8 text-sm" />
          <Button size="sm" className="h-8 bg-red-600 hover:bg-red-700" onClick={doUnavailable} disabled={dispense.isPending}>{t('confirm')}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setUnavailOpen(false)}>{t('cancel')}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t('qtyPrescribed')}</Label>
            <Input type="number" min={0} value={qtyPresc} onChange={e => setQtyPresc(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t('qtyDispensed')}</Label>
            <Input type="number" min={0} max={med.medication_id ? stock : undefined} value={qtyDisp} onChange={e => setQtyDisp(e.target.value)} placeholder="0" className="h-8 text-sm" />
          </div>
          <div className="col-span-4 space-y-1">
            <Label className="text-xs">{t('substitution')}</Label>
            <Input value={subNotes} onChange={e => setSubNotes(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="col-span-2 flex gap-1">
            <Button size="icon" className="h-8 w-8" title={t('dispense')} onClick={doDispense} disabled={dispense.isPending || !qtyDisp}>
              {dispense.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8 text-red-500" title={t('markUnavailable')} onClick={() => setUnavailOpen(true)}>✕</Button>
          </div>
        </div>
      )}
    </div>
  )
}
