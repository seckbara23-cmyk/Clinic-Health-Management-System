'use client'

import { useTranslations } from 'next-intl'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { buildSampleLabel, type LabOrderLite } from '@/lib/lab-workflow'

/**
 * Printable laboratory sample label. Browser-first — window.print() with a
 * scoped print stylesheet, no special label printer required. The sample code
 * is rendered as large monospace text that the Smart-Pharmacy scanner (or a
 * USB/Bluetooth wedge) can read back via manual/keyboard entry.
 */
export function LabSampleLabel({ order, onClose }: { order: LabOrderLite; onClose: () => void }) {
  const t = useTranslations('labOrders')
  const { clinic } = useClinic()
  const { formatDate } = useFormatters()
  const label = buildSampleLabel(order, clinic?.name ?? 'CHMS')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 print:static print:bg-white print:p-0">
      <style>{`@media print { body * { visibility: hidden !important; } .label-print, .label-print * { visibility: visible !important; } .label-print { position: absolute; inset: 0; margin: 0; box-shadow: none; } .no-print { display: none !important; } }`}</style>

      <div className="label-print w-full max-w-xs rounded-xl border-2 border-dashed border-gray-300 bg-white p-4 shadow-xl">
        <div className="text-center">
          <p className="text-xs font-semibold text-gray-500">{label.clinicName}</p>
          <p className="mt-1 text-sm font-bold text-gray-900">{label.patientName}</p>
          {label.patientNumber && <p className="font-mono text-xs text-blue-600">{label.patientNumber}</p>}
        </div>

        {/* Sample code — prominent, monospace, scannable-ready */}
        <div className="my-3 rounded-lg border bg-gray-50 py-3 text-center">
          <p className="text-[10px] uppercase tracking-widest text-gray-400">{t('labelSampleId')}</p>
          <p className="font-mono text-2xl font-bold tracking-wider text-gray-900">{label.sampleBarcode}</p>
          <div aria-hidden className="mx-auto mt-1 flex h-6 max-w-[80%] items-stretch justify-center gap-px overflow-hidden opacity-80">
            {label.sampleBarcode.split('').map((ch, i) => (
              <span key={i} className="bg-gray-900" style={{ width: (ch.charCodeAt(0) % 3) + 1 }} />
            ))}
          </div>
        </div>

        <div className="space-y-1 text-xs text-gray-600">
          <div className="flex justify-between"><span className="text-gray-400">{t('labelOrderNo')}</span><span className="font-mono">{label.orderNumber}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">{t('labelDate')}</span><span>{formatDate(label.collectionDate)}</span></div>
          {label.testNames.length > 0 && (
            <div>
              <p className="text-gray-400">{t('labelTests')}</p>
              <p className="font-medium text-gray-800">{label.testNames.join(', ')}</p>
            </div>
          )}
        </div>

        <div className="no-print mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> {t('close')}</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {t('labelPrint')}</Button>
        </div>
      </div>
    </div>
  )
}
