'use client'

// ── Radiology report workspace (Phase 39 — Radiora) ────────────────
//
// Read/edit a radiology report for one order. The radiologist dictates (or types)
// in French; deterministic structuring organises the dictation into sections
// (Technique / Résultats / Conclusion / Recommandations) WITHOUT inventing content;
// the radiologist reviews, edits, and SIGNS. Signing is always an explicit human
// action. A signed report is read-only — changes require a versioned amendment. No
// image interpretation, no autonomous findings, no automatic signing.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Mic, Square, Wand2, Save, PenLine, History, Printer, ShieldQuestion, Loader2, FileEdit } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useClinic } from '@/context/ClinicContext'
import {
  useOrderReport, useReportVersions, useSaveReport, useSignReport, useAmendReport, type WorklistOrder,
} from '@/hooks/useRadiology'
import { canEditReport, canSignReport, isSigned } from '@/lib/radiology/report'
import { structureDictation } from '@/lib/radiology/structuring'
import { RADIOLOGY_TEMPLATES, getRadiologyTemplate } from '@/lib/radiology/templates'
import { buildReportExport } from '@/lib/radiology/export'
import type { RadiologyReport } from '@/lib/radiology/types'

interface Props { order: WorklistOrder; onBack: () => void }

export function ReportWorkspace({ order, onBack }: Props) {
  const t = useTranslations('radiology')
  const { clinic, profile } = useClinic()
  const identity = useProfessionalIdentity()
  const canReport = canSignReport(identity.role, identity.specialties.primary?.id ?? null, 'draft')

  const { data: report } = useOrderReport(order.id)
  const { data: versions } = useReportVersions(report?.id)
  const saveReport = useSaveReport()
  const signReport = useSignReport()
  const amendReport = useAmendReport()

  const signed = isSigned(report?.reportStatus)
  const [amending, setAmending] = useState(false)
  const editable = (!report || canEditReport(report.reportStatus) || amending) && canReport

  const [technique, setTechnique] = useState('')
  const [findings, setFindings] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [recommandations, setRecommandations] = useState('')
  const [dictation, setDictation] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  // Seed the editors from the loaded report (once per report id/version).
  const seededRef = useRef<string>('')
  useEffect(() => {
    const key = report ? `${report.id}:${report.version}:${report.reportStatus}` : 'new'
    if (seededRef.current === key) return
    seededRef.current = key
    setTechnique(report?.technique ?? '')
    setFindings(report?.findings ?? '')
    setConclusion(report?.conclusion ?? '')
    setRecommandations(report?.recommendations ?? '')
  }, [report])

  const preview = useMemo(() => structureDictation(dictation), [dictation])

  // ── Voice dictation scaffold (Web Speech API; graceful fallback) ──
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const speechSupported = typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  function toggleDictation() {
    if (!speechSupported) return
    if (listening) { try { recognitionRef.current?.stop() } catch { /* noop */ } setListening(false); return }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const rec = new Ctor()
      rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        let add = ''
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript
        if (add) setDictation(prev => (prev ? prev + ' ' : '') + add.trim())
      }
      rec.onerror = () => setListening(false)
      rec.onend = () => setListening(false)
      recognitionRef.current = rec
      rec.start(); setListening(true)
    } catch { setListening(false) }
  }
  useEffect(() => () => { try { recognitionRef.current?.stop() } catch { /* noop */ } }, [])

  function applyTemplate(id: string) {
    const tpl = getRadiologyTemplate(id)
    if (!tpl) return
    setTechnique(prev => prev.trim() ? prev : t(tpl.techniqueKey))
  }
  function applyStructure() {
    setTechnique(prev => preview.technique || prev)
    setFindings(prev => preview.resultats || prev)
    setConclusion(prev => preview.conclusion || prev)
    setRecommandations(prev => preview.recommandations || prev)
  }

  const content = { technique, findings, conclusion, recommendations: recommandations }

  async function doSave(status: 'draft' | 'review') {
    await saveReport.mutateAsync({ report, orderId: order.id, patientId: order.patientId, modality: order.modality, examType: order.examType, reportStatus: status, ...content })
    toast.success(t('draftSaved'))
  }
  async function doSign() {
    if (!report?.id) { await doSave('draft'); toast.message(t('saveDraft')); return }
    if (!window.confirm(t('signConfirm'))) return
    await saveReport.mutateAsync({ report, orderId: order.id, patientId: order.patientId, modality: order.modality, examType: order.examType, reportStatus: report.reportStatus, ...content })
    await signReport.mutateAsync({ ...report, ...content } as RadiologyReport)
    toast.success(t('reportSigned'))
  }
  async function doAmend() {
    if (!report) return
    await amendReport.mutateAsync({ report, ...content })
    setAmending(false)
    toast.success(t('reportAmended'))
  }

  function printReport() {
    if (!clinic || !report) return
    const ex = buildReportExport({
      clinic: { name: clinic.name, location: (clinic as { location?: string }).location, phone: (clinic as { phone?: string }).phone },
      patient: { fullName: order.patientName, patientNumber: '' },
      radiologist: { fullName: profile?.full_name, professionalTitle: t('col_radiologist') },
      order: { modality: order.modality, examType: order.examType, requestedAt: order.requestedAt },
      report: { ...report, ...content },
      now: new Date(),
    })
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c))
    const block = (label: string, body: string) => body.trim() ? `<h3>${esc(label)}</h3><p>${esc(body).replace(/\n/g, '<br>')}</p>` : ''
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(t('reportTitle'))}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;color:#111;padding:0 16px}
      header{border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}h1{font-size:18px;margin:0}
      .meta{font-size:12px;color:#555;margin:8px 0}h3{font-size:13px;color:#0f766e;margin:14px 0 4px}
      p{font-size:13px;white-space:pre-wrap;margin:0}.wm{color:#b91c1c;font-weight:700}.sig{margin-top:20px;font-size:12px;border-top:1px solid #ddd;padding-top:8px}</style></head>
      <body><header><h1>${esc(ex.clinic.name)}</h1><div class="meta">${esc(ex.clinic.location)} · ${esc(ex.clinic.phone)}</div></header>
      ${ex.watermarkKey ? `<p class="wm">${esc(t('draft_watermark'))}</p>` : ''}
      <div class="meta"><b>${esc(t('exp_patient'))}:</b> ${esc(ex.patient.name)} &nbsp; <b>${esc(t('exp_exam'))}:</b> ${esc(ex.exam.modality)} / ${esc(ex.exam.examType)} &nbsp; <b>${esc(t('exp_date'))}:</b> ${esc(ex.exam.reportDate)} &nbsp; <b>${esc(t('exp_version'))}:</b> ${ex.version}</div>
      <h1 style="font-size:16px;margin-top:8px">${esc(t('reportTitle'))}</h1>
      ${block(t('exp_technique'), ex.body.technique)}${block(t('exp_findings'), ex.body.findings)}${block(t('exp_conclusion'), ex.body.conclusion)}${block(t('exp_recommendations'), ex.body.recommendations)}
      <div class="sig"><b>${esc(t('exp_radiologist'))}:</b> ${esc(ex.radiologist.name)} — ${ex.radiologist.signed ? esc(t('exp_signed')) : esc(t('draft_watermark'))}</div>
      </body></html>`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { try { w.print() } catch { /* noop */ } }, 250)
  }

  const busy = saveReport.isPending || signReport.isPending || amendReport.isPending

  return (
    <Card className="border-teal-100">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> {t('title')}</Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{order.patientName} · {t(`mod_${order.modality}`, {})}</p>
            <p className="text-[11px] text-gray-400">{order.examType} · {t('reportTitle')}</p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px]">{t(`rs_${report?.reportStatus ?? 'draft'}`)}{report ? ` · ${t('versionLabel', { n: report.version })}` : ''}</Badge>
        </div>

        {!canReport && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">{t('notRadiologist')}</p>}

        {/* Dictation + structuring (editable states only) */}
        {editable && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant={listening ? 'destructive' : 'outline'} className="h-7 gap-1 px-2 text-xs" disabled={!speechSupported} onClick={toggleDictation}>
                {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />} {listening ? t('stopDictation') : t('dictate')}
              </Button>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder={t('selectTemplate')} /></SelectTrigger>
                <SelectContent>{RADIOLOGY_TEMPLATES.map(tpl => <SelectItem key={tpl.id} value={tpl.id}>{t(tpl.labelKey)}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!dictation.trim()} onClick={applyStructure}><Wand2 className="h-3.5 w-3.5" /> {t('applyStructure')}</Button>
            </div>
            {!speechSupported && <p className="text-[11px] text-gray-400">{t('micUnavailable')}</p>}
            <Textarea lang="fr-SN" value={dictation} onChange={e => setDictation(e.target.value)} placeholder={t('dictationHint')} className="min-h-[64px] text-sm" />
            <p className="text-[10px] leading-tight text-gray-400">{t('structuringNote')}</p>
          </div>
        )}

        {/* Sections */}
        {(['technique', 'resultats', 'conclusion', 'recommandations'] as const).map(secKey => {
          const val = secKey === 'technique' ? technique : secKey === 'resultats' ? findings : secKey === 'conclusion' ? conclusion : recommandations
          const setter = secKey === 'technique' ? setTechnique : secKey === 'resultats' ? setFindings : secKey === 'conclusion' ? setConclusion : setRecommandations
          return (
            <div key={secKey}>
              <p className="mb-1 text-xs font-semibold text-gray-700">{t(`sec_${secKey}`)}</p>
              {editable
                ? <Textarea lang="fr-SN" value={val} onChange={e => setter(e.target.value)} className="min-h-[56px] text-sm" />
                : <p className="whitespace-pre-wrap rounded-md border bg-gray-50 p-2 text-sm text-gray-800">{val || '—'}</p>}
            </div>
          )
        })}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {editable && (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1 px-3 text-xs" disabled={busy} onClick={() => doSave('draft')}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t('saveDraft')}
              </Button>
              {!amending && <Button size="sm" variant="outline" className="h-8 gap-1 px-3 text-xs" disabled={busy} onClick={() => doSave('review')}>{t('markReview')}</Button>}
              {amending
                ? <Button size="sm" className="h-8 gap-1 bg-teal-700 px-3 text-xs hover:bg-teal-800" disabled={busy} onClick={doAmend}><PenLine className="h-3.5 w-3.5" /> {t('amend')}</Button>
                : <Button size="sm" className="h-8 gap-1 bg-teal-700 px-3 text-xs hover:bg-teal-800" disabled={busy || !canReport} onClick={doSign}><PenLine className="h-3.5 w-3.5" /> {t('sign')}</Button>}
            </>
          )}
          {signed && !amending && canReport && (
            <Button size="sm" variant="outline" className="h-8 gap-1 px-3 text-xs" onClick={() => setAmending(true)}><FileEdit className="h-3.5 w-3.5" /> {t('amend')}</Button>
          )}
          {report && <Button size="sm" variant="outline" className="h-8 gap-1 px-3 text-xs" onClick={printReport}><Printer className="h-3.5 w-3.5" /> {t('print')}</Button>}
          {report && <Button size="sm" variant="ghost" className="h-8 gap-1 px-3 text-xs" onClick={() => setShowHistory(v => !v)}><History className="h-3.5 w-3.5" /> {t('versionHistory')}</Button>}
        </div>

        {signed && <p className="text-[11px] text-gray-400">{t('immutableNote')}</p>}

        {/* Version history */}
        {showHistory && (
          <div className="rounded-lg border p-2">
            {(!versions || versions.length === 0) ? <p className="text-xs text-gray-400">{t('noVersions')}</p> : (
              <ul className="space-y-1">
                {versions.map(v => (
                  <li key={v.id} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-[10px]">{t('versionLabel', { n: v.version })}</Badge>
                    <span className="text-gray-500">{t(`rs_${v.reportStatus}`)}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{v.snapshotAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Responsibility disclaimer */}
        <div className="flex items-start gap-2 border-t pt-2 text-[10px] leading-tight text-gray-400">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('responsibility')}</span>
        </div>
      </CardContent>
    </Card>
  )
}
