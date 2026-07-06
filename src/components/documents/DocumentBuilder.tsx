'use client'

// ── Clinical Document builder (Phase 20) ───────────────────────────
//
// Prefills a document from existing recorded data (identity/admin + the
// clinician's own consultation text), lets the clinician EDIT and CONFIRM every
// field, previews it live, and prints via the browser (window.print). It NEVER
// generates clinical findings, a diagnosis, or a treatment recommendation.
// Printing logs a metadata-only audit row (no document content persisted).
//
// Uses the proven scoped-print pattern (DispensingReceipt): a full-screen
// overlay + inline @media-print CSS so only the `.doc-print` region prints.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoTextarea } from '@/components/ui/auto-textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { DocumentRenderer } from './DocumentRenderer'
import { buildInitialValues, missingRequired } from '@/lib/documents/prefill'
import { useLogDocumentGeneration } from '@/hooks/useDocuments'
import type { DocumentContext, DocumentDefinition, DocumentValues } from '@/lib/documents/types'

interface Props {
  definition: DocumentDefinition
  context: DocumentContext
  doctorName: string
  doctorTitle?: string | null
  signatureUrl?: string | null
  patientId?: string | null
  consultationId?: string | null
  onClose: () => void
}

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .doc-print, .doc-print * { visibility: visible !important; }
  .doc-print { position: absolute; inset: 0; margin: 0; box-shadow: none; }
  .no-print { display: none !important; }
}`

export function DocumentBuilder({ definition, context, doctorName, doctorTitle, signatureUrl, patientId, consultationId, onClose }: Props) {
  const t = useTranslations('documents')
  const logDoc = useLogDocumentGeneration()
  const [values, setValues] = useState<DocumentValues>(() => buildInitialValues(definition, context))

  const missing = useMemo(() => missingRequired(definition, values), [definition, values])
  const set = (key: string, v: string) => setValues(prev => ({ ...prev, [key]: v }))

  function onPrint() {
    if (missing.length > 0) { toast.error(t('build_missing')); return }
    // Best-effort audit BEFORE printing (never blocks the print).
    logDoc.mutate({ documentId: definition.id, patientId, consultationId, action: 'printed' })
    setTimeout(() => window.print(), 50)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/60 p-4 print:static print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>

      <div className="flex max-h-full w-full max-w-5xl gap-4 overflow-hidden">
        {/* Editor (never printed) */}
        <div className="no-print flex w-80 shrink-0 flex-col overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">{t('build_edit')}</p>
            <button onClick={onClose} aria-label="close" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3">
            {definition.fields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{t(f.labelKey)}{f.required && <span className="text-red-500"> *</span>}</Label>
                {f.type === 'textarea' ? (
                  <AutoTextarea value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className="text-sm" />
                ) : f.type === 'select' ? (
                  <Select value={values[f.key] ?? ''} onValueChange={v => set(f.key, v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{f.options?.map(o => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className="h-8 text-sm" />
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-tight text-gray-400">{t('build_confirm_note')}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} className="flex-1">{t('build_close')}</Button>
            <Button size="sm" onClick={onPrint} className="flex-1 gap-1"><Printer className="h-3.5 w-3.5" /> {t('build_print')}</Button>
          </div>
        </div>

        {/* Live preview — the ONLY region that prints */}
        <div className="doc-print flex-1 overflow-y-auto rounded-xl bg-white shadow-xl">
          <DocumentRenderer
            definition={definition}
            values={values}
            context={context}
            doctorName={doctorName}
            doctorTitle={doctorTitle}
            signatureUrl={signatureUrl}
          />
        </div>
      </div>
    </div>
  )
}
