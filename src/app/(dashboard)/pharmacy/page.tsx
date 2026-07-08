'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Pill, CheckCircle2, Receipt, Package, CalendarClock, ClipboardList, ArrowUpRight, Plus, FileBarChart, ScanLine, AlertOctagon, ShieldCheck, MapPin, FlaskConical, Clock } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useInventory, useBatches, useDispensings, useDispense, useGenerateDispensingInvoice, useLowStock, useNearExpiry } from '@/hooks/usePharmacy'
import { useMedicationCatalog } from '@/hooks/useMedications'
import { useMedicationSafety, usePatientAllergies } from '@/hooks/useMedicationSafety'
import { fetchMedicationByBarcode, useRecordDispensingVerification } from '@/hooks/usePharmacyScan'
import { SafetyAlerts } from '@/components/pharmacy/SafetyAlerts'
import { ScanBarcode } from '@/components/scan/ScanBarcode'
import { DispensingReceipt } from '@/components/pharmacy/DispensingReceipt'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { InsightsPanel } from '@/components/ai/InsightsPanel'
import {
  matchCatalogByCode, verifyMedicationScan, recommendFefoBatch, formatLocation,
  type VerifyResult,
} from '@/lib/pharmacy-scan'
import { stockAfterDispense, isAlmostDepleted, type VerificationMethod } from '@/lib/dispensing-workflow'
import type { Prescription, Medication, ClinicMedicationInventory, MedicationDispensing, CatalogMedication } from '@/types/database'
import type { SafetyWarning, Substitution } from '@/lib/medication-safety'

type RxRow = Prescription & { patient?: { full_name?: string; patient_number?: string }; doctor?: { full_name?: string } }

const statusColors: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  partially_dispensed: 'bg-amber-100 text-amber-700',
  dispensed: 'bg-emerald-100 text-emerald-700',
}

export default function PharmacyPage() {
  const t = useTranslations('pharmacy')
  const nowTs = new Date().getTime()
  const { data: prescriptions, isLoading } = usePrescriptions()
  // The "dispensed today" KPI only needs today's rows — bound the query to
  // start-of-day so it doesn't scan the whole dispensing history.
  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }, [])
  const { data: dispensings } = useDispensings({ sinceCreatedAt: startOfToday })
  const { data: lowStock } = useLowStock()
  const { data: nearExpiry } = useNearExpiry()
  const [target, setTarget] = useState<RxRow | null>(null)

  const queue = (prescriptions as RxRow[] | undefined)?.filter(rx => ['active', 'partially_dispensed'].includes(rx.status)) ?? []
  const statusLabels: Record<string, string> = {
    active: t('rxActive'), partially_dispensed: t('rxPartial'), dispensed: t('rxDispensed'),
  }

  const today = new Date().toISOString().slice(0, 10)
  const dispensedToday = (dispensings ?? []).filter(
    d => ['dispensed', 'partial'].includes(d.status) && d.quantity_dispensed > 0 && (d.dispensed_at ?? d.created_at)?.slice(0, 10) === today,
  ).length
  const lowStockCount = lowStock?.length ?? 0
  const nearExpiryCount = nearExpiry?.length ?? 0

  const kpis = [
    { label: t('kpiToDispense'),     value: queue.length,     icon: Pill,         color: 'text-teal-700',   bg: 'bg-teal-50' },
    { label: t('kpiDispensedToday'), value: dispensedToday,   icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: t('kpiLowStock'),       value: lowStockCount,    icon: Package,      color: 'text-amber-700',  bg: 'bg-amber-50' },
    { label: t('kpiNearExpiry'),     value: nearExpiryCount,  icon: CalendarClock, color: 'text-rose-600',   bg: 'bg-rose-50' },
  ]

  const watchItems = [
    { label: t('watchLowStock'),  href: '/pharmacy/reports',   icon: Package,        badge: lowStockCount || undefined },
    { label: t('watchNearExpiry'),href: '/pharmacy/reports',   icon: CalendarClock,  badge: nearExpiryCount || undefined },
    { label: t('watchAddStock'),  href: '/pharmacy/inventory', icon: Plus },
    { label: t('watchReports'),   href: '/pharmacy/reports',   icon: FileBarChart },
  ]

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('dispensingTitle')} description={t('dispensingSubtitle')} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 p-5 shadow-sm md:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-teal-200/30 blur-3xl" />
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white shadow-md shadow-teal-900/20">
                <Pill className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{t('heroTitle')}</h1>
                <p className="text-sm font-semibold text-teal-700">{t('heroSubtitle')}</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">{t('heroHelper')}</p>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0 bg-white/70 text-teal-800">
              {t('pillToDispense', { count: queue.length })}
            </Badge>
          </div>
        </section>

        {/* KPI cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(kpi => (
            <Card key={kpi.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', kpi.bg)}>
                  <kpi.icon className={cn('h-5 w-5', kpi.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
                  <p className="truncate text-xs text-gray-500">{kpi.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* AI insights (below hero/KPIs, above the list) */}
        <InsightsPanel variant="pharmacy" />

        {/* Main: dispensing list + À surveiller */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="p-0">
                {isLoading && <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}

                {!isLoading && queue.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50">
                      <Pill className="h-7 w-7 text-teal-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{t('queueEmptyTitle')}</h3>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">{t('queueEmptyDesc')}</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="outline" asChild>
                        <Link href="/prescriptions">{t('ctaViewPrescriptions')}</Link>
                      </Button>
                      <Button className="bg-teal-700 hover:bg-teal-800" asChild>
                        <Link href="/pharmacy/inventory">{t('ctaManageStock')}</Link>
                      </Button>
                    </div>
                  </div>
                )}

                {!isLoading && queue.length > 0 && (
                  <div className="divide-y">
                    {queue.map(rx => {
                      const waitedH = Math.floor((nowTs - new Date(rx.created_at).getTime()) / 3_600_000)
                      const waitLabel = waitedH < 1 ? t('waitRecent') : waitedH < 24 ? t('waitHours', { h: waitedH }) : t('waitDays', { d: Math.floor(waitedH / 24) })
                      return (
                        <div key={rx.id} className="flex items-center justify-between gap-3 p-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700">
                              {rx.patient?.full_name?.[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{rx.patient?.full_name ?? '—'}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                                <span className="inline-flex items-center gap-1"><Pill className="h-3 w-3" />{rx.medications.length} {t('medsUnit')}</span>
                                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{waitLabel}</span>
                                {rx.doctor?.full_name && <span>· Dr. {rx.doctor.full_name}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={cn('hidden rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline', statusColors[rx.status])}>{statusLabels[rx.status]}</span>
                            <Button size="sm" className="h-8 gap-1.5 bg-teal-700 hover:bg-teal-800" onClick={() => setTarget(rx)}>
                              <ScanLine className="h-3.5 w-3.5" /> {t('verifyDispense')}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* À surveiller */}
          <div className="lg:col-span-1">
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-teal-600" />
                  <h2 className="text-sm font-semibold text-gray-900">{t('watchTitle')}</h2>
                </div>
                <div className="space-y-1.5">
                  {watchItems.map(item => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-gray-50"
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-gray-500" />
                      <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
                      {item.badge != null && <Badge variant="warning">{item.badge}</Badge>}
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {target && <DispenseDialog rx={target} onClose={() => setTarget(null)} />}
    </div>
  )
}

function DispenseDialog({ rx, onClose }: { rx: RxRow; onClose: () => void }) {
  const t = useTranslations('pharmacy')
  const { data: inventory } = useInventory(false)
  const { data: catalog } = useMedicationCatalog()
  const { data: dispensings } = useDispensings({ prescriptionId: rx.id })
  const generateInvoice = useGenerateDispensingInvoice()
  const [receiptOpen, setReceiptOpen] = useState(false)

  // ── Medication Safety Layer 1 (read-only warnings before dispensing) ──
  const safety = useMedicationSafety()
  const { data: patientAllergies } = usePatientAllergies(rx.patient_id)
  const { data: nearExpiryBatches } = useNearExpiry()
  const nowMs = new Date().getTime()
  const nearExpiryByInvId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const b of nearExpiryBatches ?? []) {
      const invId = b.inventory?.id
      if (!invId || !b.expiry_date) continue
      const list = map.get(invId) ?? []
      list.push(b.expiry_date)
      map.set(invId, list)
    }
    return map
  }, [nearExpiryBatches])

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
              patientName={rx.patient?.full_name ?? '—'}
              lineIndex={idx}
              med={med}
              inventory={inventory ?? []}
              catalog={catalog ?? []}
              dispensings={(dispensings ?? []).filter(d => d.prescription_line_index === idx)}
              safety={safety}
              allergies={patientAllergies ?? null}
              nearExpiryByInvId={nearExpiryByInvId}
              nowMs={nowMs}
            />
          ))}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {(dispensings ?? []).some(d => d.status !== 'unavailable' && d.quantity_dispensed > 0) && (
            <Button variant="outline" onClick={() => setReceiptOpen(true)}>
              <Receipt className="h-4 w-4" /> {t('receiptBtn')}
            </Button>
          )}
          {hasBillable && (
            <Button variant="outline" onClick={() => generateInvoice.mutate(rx.id)} disabled={generateInvoice.isPending}>
              {generateInvoice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              {t('generateInvoice')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>

      {receiptOpen && (
        <DispensingReceipt
          patientName={rx.patient?.full_name ?? '—'}
          patientNumber={rx.patient?.patient_number ?? null}
          meds={rx.medications as Medication[]}
          dispensings={dispensings ?? []}
          onClose={() => setReceiptOpen(false)}
        />
      )}
    </Dialog>
  )
}

function DispenseLine({ prescriptionId, patientName, lineIndex, med, inventory, catalog, dispensings, safety, allergies, nearExpiryByInvId, nowMs }: {
  prescriptionId: string
  patientName: string
  lineIndex: number
  med: Medication
  inventory: ClinicMedicationInventory[]
  catalog: CatalogMedication[]
  dispensings: MedicationDispensing[]
  safety: ReturnType<typeof useMedicationSafety>
  allergies: string[] | null
  nearExpiryByInvId: Map<string, string[]>
  nowMs: number
}) {
  const t = useTranslations('pharmacy')
  const { formatDate } = useFormatters()
  const dispense = useDispense()
  const recordVerification = useRecordDispensingVerification()
  const inv = med.medication_id ? inventory.find(i => i.medication_id === med.medication_id) : undefined
  const stock = inv?.stock_quantity ?? 0
  const { data: batches } = useBatches(inv?.id)

  // Barcode verification state (Phase 10B). Never auto-corrects.
  const [verify, setVerify] = useState<{ method: VerificationMethod; result: VerifyResult | null; scannedName: string | null } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const fefo = recommendFefoBatch((batches ?? []).map(b => ({ id: b.id, expiry_date: b.expiry_date, quantity_remaining: b.quantity_remaining })))
  const location = formatLocation({ cabinet: inv?.location_cabinet, shelf: inv?.location_shelf, row: inv?.location_row, bin: inv?.location_bin })

  async function onScan(code: string, method: 'camera' | 'manual') {
    setScannerOpen(false)
    const byBarcode = await fetchMedicationByBarcode(code)
    let scanned = byBarcode
      ? { name: byBarcode.name, strength: byBarcode.strength, dosageForm: byBarcode.dosage_form, isActive: byBarcode.is_active }
      : null
    if (!scanned) {
      const m = matchCatalogByCode(code, catalog.map(c => ({ id: c.id, name: c.name, barcode: c.barcode ?? null, normalizedName: c.normalized_name ?? null })))
      const full = m ? catalog.find(c => c.id === m.id) : null
      if (full) scanned = { name: full.name, strength: full.strength, dosageForm: full.dosage_form, isActive: full.is_active }
    }
    if (!scanned) { setVerify({ method, result: null, scannedName: null }); return }
    const result = verifyMedicationScan(
      { name: med.name, strength: med.strength, dosageForm: med.dosage_form },
      { name: scanned.name, strength: scanned.strength, dosageForm: scanned.dosageForm, isActive: scanned.isActive },
    )
    setVerify({ method, result, scannedName: scanned.name })
  }

  // ── Safety warnings for this line: stock/formulary + allergy + near-expiry ──
  const safetyWarnings: SafetyWarning[] = [
    ...safety.analyzeSingle({ medication_id: med.medication_id ?? null, name: med.name }, allergies),
    ...(inv ? safety.analyzeExpiry(med.name, nearExpiryByInvId.get(inv.id) ?? [], nowMs) : []),
  ]
  const substitutions: Substitution[] = safetyWarnings.some(w => w.code === 'out_of_stock')
    ? safety.substitutionsFor(med.medication_id)
    : []

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
    // Existing atomic RPC: deducts FEFO, updates batch, records the stock
    // movement + dispensing row. Returns the new dispensing id.
    const dispensingId = await dispense.mutateAsync({
      prescription_id: prescriptionId, line_index: lineIndex,
      medication_id: med.medication_id ?? null, inventory_id: inv?.id ?? null,
      medication_name: med.name, quantity_prescribed: Number(qtyPresc) || 0, quantity_dispensed: qd,
      substitution_notes: subNotes || null,
    })
    // Append the barcode-verification audit (best-effort; never blocks).
    await recordVerification({
      dispensing_id: dispensingId, prescription_id: prescriptionId, line_index: lineIndex,
      medication_name: med.name, scanned_name: verify?.scannedName ?? null,
      verified: verify?.result?.ok ?? false, method: verify?.method ?? 'none',
      mismatches: verify?.result?.mismatches ?? [],
    })
    setQtyDisp(''); setSubNotes(''); setConfirmOpen(false); setVerify(null)
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

      {(safetyWarnings.length > 0 || substitutions.length > 0) && (
        <SafetyAlerts warnings={safetyWarnings} substitutions={substitutions} />
      )}

      {/* Barcode verification banner — never auto-corrects, never auto-substitutes */}
      {verify && (
        verify.result?.ok ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" /> {t('verifyOk', { name: verify.scannedName ?? '' })}
          </div>
        ) : verify.result ? (
          <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5 text-red-800">
            <p className="flex items-center gap-2 text-sm font-bold"><AlertOctagon className="h-5 w-5 shrink-0 text-red-600" /> {t('verifyWrong')}</p>
            <p className="mt-0.5 text-xs">{t('verifyScanned', { name: verify.scannedName ?? '' })}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {verify.result.mismatches.map(m => (
                <span key={m} className="rounded-full bg-red-200 px-2 py-0.5 text-[11px] font-medium text-red-800">{t(`mismatch_${m}`)}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertOctagon className="h-4 w-4 shrink-0 text-amber-600" /> {t('verifyUnknown')}
          </div>
        )
      )}

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
      ) : confirmOpen ? (
        // Dispensing confirmation summary
        <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{t('confirmTitle')}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <ConfRow label={t('confMed')} value={med.name} />
            <ConfRow label={t('confQty')} value={qtyDisp} />
            <ConfRow label={t('confPatient')} value={patientName} />
            <ConfRow label={t('confBatch')} value={fefo?.expiry_date ? formatDate(fefo.expiry_date) : t('confBatchAny')} />
            <ConfRow label={t('confStockAfter')} value={String(stockAfterDispense(stock, Number(qtyDisp)))} />
            {location && <ConfRow label={t('confLocation')} value={location} />}
          </dl>
          {inv && isAlmostDepleted(stockAfterDispense(stock, Number(qtyDisp)), inv.reorder_level) && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700"><Package className="h-3.5 w-3.5" /> {t('confAlmostDepleted')}</p>
          )}
          {fefo && (
            <p className="flex items-center gap-1.5 text-xs text-teal-700"><FlaskConical className="h-3.5 w-3.5" /> {t('confFefo', { date: fefo.expiry_date ? formatDate(fefo.expiry_date) : '' })}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)}>{t('cancel')}</Button>
            <Button size="sm" className="gap-1.5 bg-teal-700 hover:bg-teal-800" onClick={doDispense} disabled={dispense.isPending}>
              {dispense.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {t('confirmDispense')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {(fefo || location) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {fefo && <span className="inline-flex items-center gap-1 text-teal-700"><FlaskConical className="h-3 w-3" /> {t('fefoHint', { date: fefo.expiry_date ? formatDate(fefo.expiry_date) : '', qty: fefo.quantity_remaining })}</span>}
              {location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-teal-600" /> {location}</span>}
            </div>
          )}
          <div className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">{t('qtyPrescribed')}</Label>
              <Input type="number" min={0} value={qtyPresc} onChange={e => setQtyPresc(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">{t('qtyDispensed')}</Label>
              <Input type="number" min={0} max={med.medication_id ? stock : undefined} value={qtyDisp} onChange={e => setQtyDisp(e.target.value)} placeholder="0" className="h-8 text-sm" />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">{t('substitution')}</Label>
              <Input value={subNotes} onChange={e => setSubNotes(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="col-span-3 flex gap-1">
              <Button size="icon" variant="outline" className="h-8 w-8" title={t('scanVerify')} onClick={() => setScannerOpen(true)}><ScanLine className="h-3.5 w-3.5" /></Button>
              <Button size="icon" className="h-8 w-8" title={t('dispense')} onClick={() => { if (Number(qtyDisp) > 0) setConfirmOpen(true) }} disabled={!qtyDisp}>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="outline" className="h-8 w-8 text-red-500" title={t('markUnavailable')} onClick={() => setUnavailOpen(true)}>✕</Button>
            </div>
          </div>
        </>
      )}

      {scannerOpen && <ScanBarcode title={t('scanVerifyTitle', { name: med.name })} onDetected={onScan} onClose={() => setScannerOpen(false)} />}
    </div>
  )
}

function ConfRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-gray-800">{value}</dd>
    </div>
  )
}
