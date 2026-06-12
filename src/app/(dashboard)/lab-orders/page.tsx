'use client'

import { useState } from 'react'
import { Plus, Loader2, FlaskConical, Eye, Printer } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePatients } from '@/hooks/usePatients'
import {
  useLabTests, useLabOrders, useCreateLabOrder, useUpdateLabOrderStatus,
  useEnterLabResult, useReviewLabOrder, useGenerateLabInvoice, fetchLabOrderIdentity,
} from '@/hooks/useLab'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { logRecordView } from '@/lib/audit-client'
import { openLabResultPDF } from '@/lib/pdf'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { LabOrder, LabOrderItem, LabOrderStatus, LabResultFlag, AppointmentPriority } from '@/types/database'

const statusColors: Record<LabOrderStatus, string> = {
  ordered:          'bg-blue-100 text-blue-700',
  sample_collected: 'bg-purple-100 text-purple-700',
  sample_rejected:  'bg-red-100 text-red-700',
  in_progress:      'bg-amber-100 text-amber-700',
  completed:        'bg-emerald-100 text-emerald-700',
  reviewed:         'bg-teal-100 text-teal-700',
  cancelled:        'bg-gray-100 text-gray-500',
}
const flagColors: Record<LabResultFlag, string> = {
  normal:   'text-gray-600',
  abnormal: 'text-amber-700 font-semibold',
  high:     'text-red-700 font-semibold',
  low:      'text-blue-700 font-semibold',
  critical: 'text-red-800 font-bold',
}

export default function LabOrdersPage() {
  const t = useTranslations('labOrders')
  const { formatDate } = useFormatters()
  const { profile } = useClinic()
  const role = profile?.role ?? ''
  const canCreate = ['doctor', 'nurse', 'admin'].includes(role)
  const canResult = ['doctor', 'nurse', 'admin', 'lab_technician'].includes(role)
  const canReview = ['doctor', 'admin'].includes(role)

  const statusLabels: Record<LabOrderStatus, string> = {
    ordered:          t('statusOrdered'),
    sample_collected: t('statusSampleCollected'),
    sample_rejected:  t('statusSampleRejected'),
    in_progress:      t('statusInProgress'),
    completed:        t('statusCompleted'),
    reviewed:         t('statusReviewed'),
    cancelled:        t('statusCancelled'),
  }
  const flagLabels: Record<LabResultFlag, string> = {
    normal:   t('flagNormal'),
    abnormal: t('flagAbnormal'),
    high:     t('flagHigh'),
    low:      t('flagLow'),
    critical: t('flagCritical'),
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<LabOrder | null>(null)

  const { data: orders, isLoading } = useLabOrders()
  const { data: tests } = useLabTests()
  const { data: patientsResult } = usePatients()
  const patients = patientsResult?.data

  const createOrder = useCreateLabOrder()

  // Create-form local state
  const [patientId, setPatientId] = useState('')
  const [priority, setPriority] = useState<AppointmentPriority>('normal')
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [selectedTests, setSelectedTests] = useState<Record<string, boolean>>({})
  const [adhoc, setAdhoc] = useState('')

  function resetCreate() {
    setPatientId(''); setPriority('normal'); setClinicalNotes(''); setSelectedTests({}); setAdhoc('')
  }

  async function submitCreate() {
    const chosen = (tests ?? []).filter(t => selectedTests[t.id]).map(t => ({ lab_test_id: t.id, test_name: t.name }))
    const adhocTests = adhoc.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ lab_test_id: null, test_name: name }))
    const allTests = [...chosen, ...adhocTests]
    if (!patientId || allTests.length === 0) return
    await createOrder.mutateAsync({ patient_id: patientId, priority, clinical_notes: clinicalNotes || null, tests: allTests })
    setCreateOpen(false); resetCreate()
  }

  function openDetail(order: LabOrder) {
    logRecordView('lab_order', order.id)
    setDetail(order)
  }

  // Keep the open detail dialog in sync with refreshed list data.
  const liveDetail = detail ? orders?.find(o => o.id === detail.id) ?? detail : null

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />
      <div className="flex-1 p-4 md:p-6 space-y-4">
        {canCreate && (
          <div className="flex justify-end">
            <Button onClick={() => { resetCreate(); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" /> {t('newOrder')}
            </Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            )}
            {!isLoading && (!orders || orders.length === 0) && (
              <EmptyState icon={FlaskConical} title={t('emptyTitle')} description={t('emptyDesc')} />
            )}
            {!isLoading && orders && orders.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colPatient')}</TableHead>
                      <TableHead>{t('colTests')}</TableHead>
                      <TableHead>{t('colPriority')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead>{t('colDate')}</TableHead>
                      <TableHead className="text-right">{t('colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map(order => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.patient_name ?? '—'}
                          {order.patient_number && <span className="block font-mono text-xs text-blue-600">{order.patient_number}</span>}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">{order.items?.length ?? 0} {t('testsUnit')}</TableCell>
                        <TableCell>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                            order.priority === 'normal' ? 'bg-gray-100 text-gray-600' : order.priority === 'urgent' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                            {order.priority}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[order.status])}>
                            {statusLabels[order.status]}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-400">{formatDate(order.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-8" onClick={() => openDetail(order)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> {t('open')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create order dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t('createTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('labelPatient')}</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder={t('selectPatient')} /></SelectTrigger>
                <SelectContent>
                  {patients?.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelTests')}</Label>
              <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
                {(tests ?? []).length === 0 && <p className="p-3 text-xs text-gray-400">{t('noCatalog')}</p>}
                {(tests ?? []).map(test => (
                  <label key={test.id} className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-gray-50 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      checked={!!selectedTests[test.id]}
                      onChange={e => setSelectedTests(s => ({ ...s, [test.id]: e.target.checked }))}
                    />
                    <span className="flex-1">{test.name}</span>
                    {test.category && <span className="text-xs text-gray-400">{test.category}</span>}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelAdhoc')}</Label>
              <Input value={adhoc} onChange={e => setAdhoc(e.target.value)} placeholder={t('adhocPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelPriority')}</Label>
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
              <Label>{t('labelClinicalNotes')}</Label>
              <Input value={clinicalNotes} onChange={e => setClinicalNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
            <Button onClick={submitCreate} disabled={createOrder.isPending || !patientId}>
              {createOrder.isPending && <Loader2 className="animate-spin" />}
              {t('btnOrder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order detail dialog */}
      {liveDetail && (
        <LabOrderDetail
          order={liveDetail}
          statusLabels={statusLabels}
          flagLabels={flagLabels}
          flagColors={flagColors}
          statusColors={statusColors}
          canResult={canResult}
          canReview={canReview}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

// ─── Detail dialog ──────────────────────────────────────────────
function LabOrderDetail({
  order, statusLabels, flagLabels, flagColors, statusColors, canResult, canReview, onClose,
}: {
  order: LabOrder
  statusLabels: Record<LabOrderStatus, string>
  flagLabels: Record<LabResultFlag, string>
  flagColors: Record<LabResultFlag, string>
  statusColors: Record<LabOrderStatus, string>
  canResult: boolean
  canReview: boolean
  onClose: () => void
}) {
  const t = useTranslations('labOrders')
  const { formatDate } = useFormatters()
  const { clinic, profile } = useClinic()
  const updateStatus = useUpdateLabOrderStatus()
  const review = useReviewLabOrder()
  const generateInvoice = useGenerateLabInvoice()
  const [interpretation, setInterpretation] = useState(order.interpretation ?? '')
  const [printing, setPrinting] = useState(false)

  const items = order.items ?? []
  const allResulted = items.length > 0 && items.every(i => i.result_value != null && i.result_value !== '')
  const canBill = ['admin', 'receptionist', 'cashier', 'doctor'].includes(profile?.role ?? '')
  const printable = ['completed', 'reviewed'].includes(order.status)

  async function handlePrint() {
    if (!clinic) return
    setPrinting(true)
    try {
      const identity = await fetchLabOrderIdentity(order.id)
      openLabResultPDF(order, items, clinic, identity, order.doctor?.full_name ?? '', '')
    } finally {
      setPrinting(false)
    }
  }

  // Contextual status transitions.
  const transitions: LabOrderStatus[] = (() => {
    switch (order.status) {
      case 'ordered':          return ['sample_collected', 'sample_rejected', 'cancelled']
      case 'sample_collected': return ['in_progress', 'sample_rejected']
      case 'sample_rejected':  return ['sample_collected']
      case 'in_progress':      return allResulted ? ['completed'] : []
      default:                 return []
    }
  })()

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            {order.patient_name ?? '—'}
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[order.status])}>
              {statusLabels[order.status]}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-500">
            <span>{t('detailOrdered', { date: formatDate(order.created_at) })}</span>
            {order.doctor?.full_name && <span>{t('detailBy', { name: order.doctor.full_name })}</span>}
            {order.clinical_notes && <span className="w-full text-gray-700">{t('detailNotes')}: {order.clinical_notes}</span>}
          </div>

          {/* Items + results */}
          <div className="rounded-lg border divide-y">
            {items.map(item => (
              <LabItemRow
                key={item.id}
                item={item}
                editable={canResult && ['sample_collected', 'in_progress'].includes(order.status)}
                flagLabels={flagLabels}
                flagColors={flagColors}
              />
            ))}
          </div>

          {/* Status transitions */}
          {transitions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {transitions.map(s => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === 'cancelled' || s === 'sample_rejected' ? 'outline' : 'default'}
                  className={cn('h-8 text-xs', (s === 'cancelled' || s === 'sample_rejected') && 'text-red-600')}
                  disabled={updateStatus.isPending}
                  onClick={() => updateStatus.mutate({ id: order.id, status: s })}
                >
                  {statusLabels[s]}
                </Button>
              ))}
            </div>
          )}

          {/* Review (doctor/admin) */}
          {order.status === 'completed' && canReview && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 space-y-2">
              <Label className="text-teal-800">{t('interpretationLabel')}</Label>
              <Textarea value={interpretation} onChange={e => setInterpretation(e.target.value)} rows={3} />
              <Button
                size="sm" className="bg-teal-700 hover:bg-teal-800"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: order.id, interpretation })}
              >
                {review.isPending && <Loader2 className="animate-spin" />}
                {t('btnReview')}
              </Button>
            </div>
          )}

          {order.status === 'reviewed' && (
            <div className="rounded-lg border bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{t('reviewedBy', { name: order.reviewer?.full_name ?? '—', date: order.reviewed_at ? formatDate(order.reviewed_at) : '—' })}</p>
              {order.interpretation && <p className="mt-1 text-gray-700">{order.interpretation}</p>}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {printable && (
            <Button variant="outline" onClick={handlePrint} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {t('btnPrint')}
            </Button>
          )}
          {canBill && printable && !order.invoice_id && (
            <Button variant="outline" onClick={() => generateInvoice.mutate(order)} disabled={generateInvoice.isPending}>
              {generateInvoice.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('btnGenerateInvoice')}
            </Button>
          )}
          {order.invoice_id && <span className="text-xs text-emerald-600 self-center">{t('alreadyBilled')}</span>}
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Item row with inline result entry ──────────────────────────
function LabItemRow({
  item, editable, flagLabels, flagColors,
}: {
  item: LabOrderItem
  editable: boolean
  flagLabels: Record<LabResultFlag, string>
  flagColors: Record<LabResultFlag, string>
}) {
  const t = useTranslations('labOrders')
  const enter = useEnterLabResult()
  const [value, setValue] = useState(item.result_value ?? '')
  const [flag, setFlag] = useState<LabResultFlag>(item.flag)
  const [notes, setNotes] = useState(item.result_notes ?? '')

  const range = item.normal_range_text
    ?? (item.normal_range_low != null && item.normal_range_high != null ? `${item.normal_range_low} – ${item.normal_range_high}` : '—')

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{item.test_name}</span>
        <span className="text-xs text-gray-400">{t('refRange')}: {range}{item.unit ? ` ${item.unit}` : ''}</span>
      </div>
      {editable ? (
        <div className="grid grid-cols-12 gap-2 items-center">
          <Input className="col-span-4 h-8 text-sm" placeholder={t('resultValue')} value={value} onChange={e => setValue(e.target.value)} />
          <div className="col-span-4">
            <Select value={flag} onValueChange={v => setFlag(v as LabResultFlag)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(flagLabels) as LabResultFlag[]).map(f => <SelectItem key={f} value={f}>{flagLabels[f]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input className="col-span-3 h-8 text-sm" placeholder={t('resultNotes')} value={notes} onChange={e => setNotes(e.target.value)} />
          <Button
            size="icon" className="col-span-1 h-8 w-8"
            disabled={enter.isPending || !value.trim()}
            onClick={() => enter.mutate({
              id: item.id, result_value: value, flag, result_notes: notes,
              result_numeric: Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : null,
            })}
          >
            {enter.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '✓'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className={cn('text-sm', flagColors[item.flag])}>
            {item.result_value ?? t('pending')}{item.unit && item.result_value ? ` ${item.unit}` : ''}
          </span>
          {item.result_value && item.flag !== 'normal' && (
            <Badge variant="outline" className={cn('text-xs', flagColors[item.flag])}>{flagLabels[item.flag]}</Badge>
          )}
          {item.result_notes && <span className="text-xs text-gray-400">{item.result_notes}</span>}
        </div>
      )}
    </div>
  )
}
