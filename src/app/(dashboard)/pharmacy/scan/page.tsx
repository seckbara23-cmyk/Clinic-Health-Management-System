'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ScanLine, Keyboard, Pill, MapPin, Boxes, FlaskConical, AlertOctagon, ClipboardCheck,
  Loader2, ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScanBarcode } from '@/components/scan/ScanBarcode'
import { useMedicationCatalog } from '@/hooks/useMedications'
import { useInventory, useBatches } from '@/hooks/usePharmacy'
import { fetchMedicationByBarcode, useCreateCycleCount, useCycleCounts } from '@/hooks/usePharmacyScan'
import { usePermissions } from '@/hooks/usePermissions'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  matchCatalogByCode, formatLocation, expiryStatus, recommendFefoBatch, cycleCountVariance,
  type ExpiryLevel,
} from '@/lib/pharmacy-scan'

type Tab = 'lookup' | 'cycle'

const EXPIRY_CLS: Record<ExpiryLevel, string> = {
  expired: 'border-red-300 bg-red-50 text-red-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  none: 'border-gray-200 bg-gray-50 text-gray-500',
}

export default function PharmacyScanPage() {
  const t = useTranslations('pharmacyScan')
  const { can } = usePermissions()
  const { formatDate } = useFormatters()
  const nowMs = new Date().getTime()

  const [tab, setTab] = useState<Tab>('lookup')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [medId, setMedId] = useState<string | null>(null)
  const [counted, setCounted] = useState('')

  // Phase 41: page access via Enterprise Authorization (maps 1:1 to pharmacy.scan).
  const isPharmacyRole = can('pharmacy.scan')

  const { data: catalog } = useMedicationCatalog()
  const { data: inventory } = useInventory(true)
  const createCount = useCreateCycleCount()
  const { data: recentCounts } = useCycleCounts(10)

  const med = useMemo(() => catalog?.find(m => m.id === medId) ?? null, [catalog, medId])
  const invLine = useMemo(
    () => inventory?.find(i => i.medication_id === medId) ?? null,
    [inventory, medId],
  )
  const { data: batches } = useBatches(invLine?.id)

  const location = formatLocation({
    cabinet: invLine?.location_cabinet, shelf: invLine?.location_shelf,
    row: invLine?.location_row, bin: invLine?.location_bin,
  })
  const fefo = useMemo(
    () => recommendFefoBatch((batches ?? []).map(b => ({ id: b.id, expiry_date: b.expiry_date, quantity_remaining: b.quantity_remaining }))),
    [batches],
  )

  async function onDetected(code: string) {
    setResolving(true)
    try {
      const byBarcode = await fetchMedicationByBarcode(code)
      let resolvedId = byBarcode?.id ?? null
      if (!resolvedId) {
        const m = matchCatalogByCode(code, (catalog ?? []).map(c => ({
          id: c.id, name: c.name, barcode: c.barcode ?? null, normalizedName: c.normalized_name ?? null,
        })))
        resolvedId = m?.id ?? null
      }
      if (!resolvedId) { toast.error(t('notFound', { code })); setMedId(null); return }
      setMedId(resolvedId)
      setCounted('')
    } finally {
      setResolving(false)
    }
  }

  if (!isPharmacyRole) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title={t('title')} />
        <div className="flex flex-1 items-center justify-center text-gray-400">{t('noAccess')}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" /> {t('back')}
          </Link>

          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {([['lookup', ScanLine], ['cycle', ClipboardCheck]] as const).map(([id, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px',
                  tab === id ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon className="h-4 w-4" /> {t(id === 'lookup' ? 'tabLookup' : 'tabCycle')}
              </button>
            ))}
          </div>

          {/* Scan trigger */}
          <div className="flex gap-2">
            <Button onClick={() => setScannerOpen(true)} className="flex-1 gap-2" size="lg">
              {resolving ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
              {t('scanBtn')}
            </Button>
            <Button variant="outline" size="lg" className="gap-2" onClick={() => setScannerOpen(true)}>
              <Keyboard className="h-5 w-5" /> {t('manualBtn')}
            </Button>
          </div>

          {!med ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-gray-400">
                <ScanLine className="h-10 w-10 opacity-30" />
                <p className="text-sm">{t('empty')}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Resolved medication header */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Pill className="h-4 w-4 text-teal-700" /> {med.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <Field label={t('fieldStrength')} value={med.strength ?? '—'} />
                  <Field label={t('fieldForm')} value={med.dosage_form ?? '—'} />
                  <Field label={t('fieldClass')} value={med.therapeutic_class ?? '—'} />
                  <Field label={t('fieldStock')} value={invLine ? String(invLine.stock_quantity) : t('notStocked')} />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('fieldLocation')}</p>
                    <p className="mt-0.5 flex items-center gap-1 font-mono font-semibold text-gray-800">
                      <MapPin className="h-3.5 w-3.5 text-teal-600" /> {location ?? t('noLocation')}
                    </p>
                  </div>
                  <Field label={t('fieldSupplier')} value={invLine?.supplier ?? '—'} />
                </CardContent>
              </Card>

              {tab === 'lookup' && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Boxes className="h-4 w-4 text-amber-600" /> {t('batchesTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {!invLine ? (
                      <p className="text-sm text-gray-400">{t('notStocked')}</p>
                    ) : (batches ?? []).length === 0 ? (
                      <p className="text-sm text-gray-400">{t('noBatches')}</p>
                    ) : (
                      (batches ?? []).map(b => {
                        const st = expiryStatus(b.expiry_date, nowMs)
                        const isFefo = fefo?.id === b.id
                        return (
                          <div key={b.id} className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2', EXPIRY_CLS[st.level])}>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 text-sm font-medium">
                                <FlaskConical className="h-3.5 w-3.5" />
                                {b.batch_number || t('batchNoNumber')}
                                {isFefo && <Badge variant="secondary" className="text-teal-700">{t('fefo')}</Badge>}
                              </p>
                              <p className="text-xs opacity-80">
                                {b.expiry_date ? formatDate(b.expiry_date) : t('noExpiry')}
                                {st.daysLeft != null && (
                                  <> · {st.level === 'expired' ? t('expired') : t('expiresIn', { days: st.daysLeft })}</>
                                )}
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-bold tabular-nums">×{b.quantity_remaining}</span>
                          </div>
                        )
                      })
                    )}
                    {fefo && (
                      <p className="flex items-center gap-1.5 pt-1 text-xs text-teal-700">
                        <FlaskConical className="h-3.5 w-3.5" />
                        {t('fefoRecommended', { batch: fefo.expiry_date ? formatDate(fefo.expiry_date) : '' })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {tab === 'cycle' && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ClipboardCheck className="h-4 w-4 text-teal-700" /> {t('cycleTitle')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!invLine ? (
                      <p className="text-sm text-gray-400">{t('notStocked')}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <Metric label={t('cycleExpected')} value={String(invLine.stock_quantity)} />
                          <Metric label={t('cycleCounted')} value={counted || '—'} />
                          <VarianceMetric label={t('cycleVariance')} value={counted === '' ? null : cycleCountVariance(invLine.stock_quantity, Number(counted)).difference} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>{t('cycleCountedLabel')}</Label>
                          <Input type="number" min={0} inputMode="numeric" value={counted} onChange={e => setCounted(e.target.value)} placeholder="0" className="text-lg font-semibold" />
                        </div>
                        <Button
                          className="w-full"
                          disabled={counted === '' || createCount.isPending}
                          onClick={() => {
                            createCount.mutate(
                              { inventory_id: invLine.id, expected_qty: invLine.stock_quantity, counted_qty: Number(counted) },
                              { onSuccess: () => setCounted('') },
                            )
                          }}
                        >
                          {createCount.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                          {t('cycleSave')}
                        </Button>
                      </>
                    )}

                    {(recentCounts?.length ?? 0) > 0 && (
                      <div className="border-t pt-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('recentCounts')}</p>
                        <div className="space-y-1">
                          {recentCounts!.map(c => (
                            <div key={c.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-gray-600">
                                {c.inventory?.medication?.name ?? '—'} · {formatDate(c.created_at)}
                              </span>
                              <span className={cn('shrink-0 font-semibold tabular-nums', c.variance === 0 ? 'text-emerald-600' : c.variance < 0 ? 'text-red-600' : 'text-amber-600')}>
                                {c.variance > 0 ? `+${c.variance}` : c.variance}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {scannerOpen && (
        <ScanBarcode
          title={t('scannerTitle')}
          onDetected={onDetected}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 font-medium text-gray-800">{value}</p>
    </div>
  )
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-lg font-bold tabular-nums text-gray-800">{value}</p>
    </div>
  )
}
function VarianceMetric({ label, value }: { label: string; value: number | null }) {
  const cls = value == null ? 'text-gray-800' : value === 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-amber-600'
  return (
    <div className="rounded-xl bg-gray-50 px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn('flex items-center justify-center gap-1 text-lg font-bold tabular-nums', cls)}>
        {value != null && value !== 0 && <AlertOctagon className="h-4 w-4" />}
        {value == null ? '—' : value > 0 ? `+${value}` : value}
      </p>
    </div>
  )
}
