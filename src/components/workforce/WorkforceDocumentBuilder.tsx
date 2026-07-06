'use client'

// ── Workforce document builder (Phase 21) ──────────────────────────
//
// Reuses the Phase 20 scoped-print pattern but renders an EMPLOYEE document —
// never a patient one. Prefills from existing employee/clinic data, lets the
// admin edit every field, then prints via window.print(). Generates no content.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoTextarea } from '@/components/ui/auto-textarea'
import { useFormatters } from '@/hooks/useFormatters'
import {
  buildWorkforceInitialValues, workforceMissingRequired,
  type WorkforceDocumentDefinition, type WorkforceDocumentContext,
} from '@/lib/workforce/documents'

export function WorkforceDocumentBuilder({
  def, context, signerName, signerTitle, onClose,
}: {
  def: WorkforceDocumentDefinition
  context: WorkforceDocumentContext
  signerName: string
  signerTitle?: string | null
  onClose: () => void
}) {
  const t = useTranslations('workforce')
  const { formatDate } = useFormatters()
  const [values, setValues] = useState<Record<string, string>>(() => buildWorkforceInitialValues(def, context))
  const missing = workforceMissingRequired(def, values)

  const printCss = useMemo(() => `@media print {
    body * { visibility: hidden !important; }
    .wf-doc-print, .wf-doc-print * { visibility: visible !important; }
    .wf-doc-print { position: absolute; left: 0; top: 0; width: 100%; }
    .wf-no-print { display: none !important; }
  }`, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <div className="wf-no-print flex items-center justify-between border-b bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{t(def.titleKey)}</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={missing.length > 0} onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('print')}
          </Button>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100" aria-label={t('close')}><X className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editable fields */}
        <div className="wf-no-print w-full max-w-sm overflow-y-auto border-r bg-white p-4 space-y-3">
          {def.fields.map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{t(f.labelKey)}{f.required && <span className="text-rose-500"> *</span>}</Label>
              {f.type === 'textarea'
                ? <AutoTextarea value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
                : <Input type={f.type === 'date' ? 'date' : 'text'} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />}
            </div>
          ))}
          {missing.length > 0 && <p className="text-xs text-amber-600">{t('missingRequired')}</p>}
        </div>

        {/* Print preview */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div className="wf-doc-print mx-auto max-w-[210mm] bg-white p-8 text-sm text-gray-900 shadow">
            {def.print.showClinicHeader && (
              <div className="border-b pb-3 text-center">
                <p className="text-lg font-bold">{context.clinic?.name ?? ''}</p>
                <p className="text-xs text-gray-500">{[context.clinic?.location, context.clinic?.phone].filter(Boolean).join(' · ')}</p>
              </div>
            )}
            <h1 className="mt-5 text-center text-base font-bold uppercase tracking-wide">{t(def.titleKey)}</h1>
            {def.print.showDate && <p className="mt-2 text-right text-xs text-gray-500">{formatDate(context.now.toISOString())}</p>}

            <div className="mt-5 space-y-4">
              {def.sections.map(s => (
                <div key={s.id} className="space-y-2">
                  {s.labelKey && <p className="text-xs font-semibold uppercase text-gray-400">{t(s.labelKey)}</p>}
                  {s.fieldKeys.map(k => {
                    const f = def.fields.find(x => x.key === k)
                    const raw = (values[k] ?? '').trim()
                    if (!f || !raw) return null
                    const shown = f.type === 'date' && !Number.isNaN(new Date(raw).getTime()) ? formatDate(raw) : raw
                    return (
                      <div key={k} className="text-sm">
                        <span className="font-semibold text-gray-700">{t(f.labelKey)}: </span>
                        <span className="whitespace-pre-wrap text-gray-800">{shown}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {def.print.showDoctorSignature && (
              <div className="mt-12 flex justify-end">
                <div className="w-48 border-t border-gray-400 pt-1 text-center text-xs">
                  <p className="font-semibold text-gray-800">{signerTitle ? `${signerTitle} ` : ''}{signerName}</p>
                  <p className="text-gray-400">{t('signature')}</p>
                </div>
              </div>
            )}
            <p className="mt-8 border-t pt-2 text-center text-[10px] text-gray-400">{t('docFooter')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
