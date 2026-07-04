'use client'

import { useTranslations } from 'next-intl'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { buildReceiptLines, type RxMedLite, type DispenseLite } from '@/lib/dispensing-workflow'

/**
 * Printable medication dispensing receipt. Browser-first — uses window.print()
 * with a scoped print stylesheet (no PDF library, works on any device). Lists
 * only medications that were actually dispensed.
 */
export function DispensingReceipt({
  patientName, patientNumber, meds, dispensings, onClose,
}: {
  patientName: string
  patientNumber?: string | null
  meds: RxMedLite[]
  dispensings: DispenseLite[]
  onClose: () => void
}) {
  const t = useTranslations('pharmacy')
  const { clinic, profile } = useClinic()
  const { formatDate, formatTime } = useFormatters()
  const now = new Date()
  const lines = buildReceiptLines(meds, dispensings)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 print:static print:bg-white print:p-0">
      {/* Scoped print CSS: print only the receipt. */}
      <style>{`@media print { body * { visibility: hidden !important; } .receipt-print, .receipt-print * { visibility: visible !important; } .receipt-print { position: absolute; inset: 0; margin: 0; box-shadow: none; } .no-print { display: none !important; } }`}</style>

      <div className="receipt-print max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="border-b pb-3 text-center">
          <h2 className="text-lg font-bold text-gray-900">{clinic?.name ?? 'CHMS'}</h2>
          {clinic?.location && <p className="text-xs text-gray-500">{clinic.location}</p>}
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-teal-700">{t('receiptTitle')}</p>
        </div>

        {/* Patient + date */}
        <div className="flex justify-between gap-2 border-b py-3 text-sm">
          <div>
            <p className="font-semibold text-gray-900">{patientName}</p>
            {patientNumber && <p className="font-mono text-xs text-gray-500">{patientNumber}</p>}
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>{formatDate(now)}</p>
            <p>{formatTime(now)}</p>
          </div>
        </div>

        {/* Dispensed medications */}
        <div className="divide-y py-2">
          {lines.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">{t('receiptEmpty')}</p>
          ) : lines.map(l => (
            <div key={l.index} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-900">{l.name}</p>
                <span className="shrink-0 font-semibold tabular-nums text-teal-700">× {l.dispensedQty}</span>
              </div>
              {l.posology && <p className="text-xs text-gray-600">{l.posology}</p>}
              {l.instructions && <p className="text-xs italic text-gray-500">{l.instructions}</p>}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t pt-3 text-xs text-gray-500">
          <p>{t('receiptPharmacist')}: <span className="font-medium text-gray-700">{profile?.full_name ?? '—'}</span></p>
          <p className="mt-3 text-center text-[10px] text-gray-400">{t('receiptFooter')}</p>
        </div>

        {/* Actions (hidden when printing) */}
        <div className="no-print mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> {t('close')}</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {t('receiptPrint')}</Button>
        </div>
      </div>
    </div>
  )
}
