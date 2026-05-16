'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Activity, Heart, Wind, Scale, Thermometer,
  Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useConsultationVitals, useRecordVitals } from '@/hooks/useVitals'
import { formatDate, formatTime, cn } from '@/lib/utils'

// ── Schema ───────────────────────────────────────────────────────
// Preprocess: empty string / null / undefined → null; otherwise coerce to number
const optNum = () =>
  z.preprocess(
    v => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().nullable().optional(),
  )

const schema = z.object({
  systolic_bp:      optNum(),
  diastolic_bp:     optNum(),
  heart_rate:       optNum(),
  respiratory_rate: optNum(),
  spo2:             optNum(),
  weight_kg:        optNum(),
  height_cm:        optNum(),
  temperature_c:    optNum(),
  blood_glucose:    optNum(),
  pain_scale:       z.number().int().min(0).max(10).nullable().optional(),
  notes:            z.string().optional().nullable(),
})
type FormData = z.infer<typeof schema>

const BLANK: FormData = {
  systolic_bp: null, diastolic_bp: null, heart_rate: null,
  respiratory_rate: null, spo2: null, weight_kg: null, height_cm: null,
  temperature_c: null, blood_glucose: null, pain_scale: null, notes: null,
}

// ── Vital-range warnings ─────────────────────────────────────────
type VitalStatus = 'normal' | 'warning' | 'critical'

const STATUS_CHECKS: Record<string, (v: number) => VitalStatus> = {
  systolic_bp:      v => v < 70 || v > 200 ? 'critical' : v < 90 || v > 160 ? 'warning' : 'normal',
  diastolic_bp:     v => v < 40 || v > 130 ? 'critical' : v < 60 || v > 100 ? 'warning' : 'normal',
  heart_rate:       v => v < 30 || v > 180 ? 'critical' : v < 50 || v > 130 ? 'warning' : 'normal',
  temperature_c:    v => v < 34 || v > 41  ? 'critical' : v < 36 || v > 38.5 ? 'warning' : 'normal',
  respiratory_rate: v => v < 8  || v > 35  ? 'critical' : v < 12 || v > 25   ? 'warning' : 'normal',
  spo2:             v => v < 88             ? 'critical' : v < 95              ? 'warning' : 'normal',
  blood_glucose:    v => v < 2  || v > 30  ? 'critical' : v < 4  || v > 11   ? 'warning' : 'normal',
}

function getStatus(field: string, raw: unknown): VitalStatus {
  const n = raw == null || raw === '' ? null : Number(raw)
  if (n === null || isNaN(n)) return 'normal'
  return STATUS_CHECKS[field]?.(n) ?? 'normal'
}

const DOT_COLOR: Record<VitalStatus, string> = {
  normal: '', warning: 'bg-amber-400', critical: 'bg-red-500',
}
const BORDER_COLOR: Record<VitalStatus, string> = {
  normal: '', warning: 'border-amber-300', critical: 'border-red-400',
}
const HINT: Record<VitalStatus, string> = {
  normal: '', warning: 'Valeur inhabituelle', critical: 'Valeur critique',
}
const HINT_COLOR: Record<VitalStatus, string> = {
  normal: '', warning: 'text-amber-600', critical: 'text-red-600',
}

// ── BMI helpers ──────────────────────────────────────────────────
function calcBmi(weight: unknown, height: unknown): number | null {
  const w = weight == null || weight === '' ? null : Number(weight)
  const h = height == null || height === '' ? null : Number(height)
  if (!w || !h || isNaN(w) || isNaN(h) || h <= 0) return null
  return Math.round((w / Math.pow(h / 100, 2)) * 10) / 10
}

function bmiCategory(bmi: number | null): { label: string; cls: string } | null {
  if (bmi === null) return null
  if (bmi < 18.5) return { label: 'Insuffisance pondérale', cls: 'bg-blue-50 border-blue-200 text-blue-700' }
  if (bmi < 25)   return { label: 'Poids normal',           cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
  if (bmi < 30)   return { label: 'Surpoids',               cls: 'bg-amber-50 border-amber-200 text-amber-700' }
  return           { label: 'Obésité',                      cls: 'bg-red-50 border-red-200 text-red-700' }
}

// ── Sub-component: one numeric vital field ───────────────────────
function VitalField({
  id, label, unit, field, disabled,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register, rawValue, step = 'any',
}: {
  id: string
  label: string
  unit: string
  field: string
  disabled: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any
  rawValue: unknown
  step?: string
}) {
  const status = getStatus(field, rawValue)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {rawValue != null && rawValue !== '' && status !== 'normal' && (
          <span className={cn('h-2 w-2 rounded-full shrink-0', DOT_COLOR[status])} />
        )}
        <Label htmlFor={id} className="text-xs text-gray-600 leading-tight">{label}</Label>
        <span className="text-xs text-gray-400 shrink-0">{unit}</span>
      </div>
      <Input
        id={id}
        type="number"
        step={step}
        inputMode="decimal"
        placeholder="—"
        {...register(field)}
        disabled={disabled}
        className={cn(
          'h-12 text-base font-medium',
          BORDER_COLOR[status],
          disabled && 'bg-gray-50 text-gray-500',
        )}
      />
      {rawValue != null && rawValue !== '' && HINT[status] && (
        <p className={cn('flex items-center gap-1 text-xs', HINT_COLOR[status])}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {HINT[status]}
        </p>
      )}
    </div>
  )
}

// ── Section heading ──────────────────────────────────────────────
function Section({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <Icon className={cn('h-3.5 w-3.5', color)} />
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
interface Props {
  consultationId: string
  patientId: string
  isEnded: boolean
}

export function VitalsForm({ consultationId, patientId, isEnded }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const prefilled = useRef<string | null>(null)

  const { data: vitalsList, isLoading } = useConsultationVitals(consultationId)
  const recordMutation = useRecordVitals()
  const latest = vitalsList?.[0] ?? null

  const {
    register, handleSubmit, control, reset, watch,
    formState: { isDirty, isSubmitting },
  } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: BLANK,
  })

  // Pre-fill form with the latest vitals once (and again if a new record arrives)
  useEffect(() => {
    if (!latest || latest.id === prefilled.current) return
    prefilled.current = latest.id
    reset({
      systolic_bp:      latest.systolic_bp,
      diastolic_bp:     latest.diastolic_bp,
      heart_rate:       latest.heart_rate,
      respiratory_rate: latest.respiratory_rate,
      spo2:             latest.spo2,
      weight_kg:        latest.weight_kg,
      height_cm:        latest.height_cm,
      temperature_c:    latest.temperature_c,
      blood_glucose:    latest.blood_glucose,
      pain_scale:       latest.pain_scale,
      notes:            latest.notes,
    })
  }, [latest, reset])

  // Watch raw values for live BMI + warning indicators
  const w = watch()
  const bmi = calcBmi(useWatch({ control, name: 'weight_kg' }), useWatch({ control, name: 'height_cm' }))
  const bmiCat = bmiCategory(bmi)

  async function onSubmit(data: FormData) {
    const result = await recordMutation.mutateAsync({
      consultation_id:  consultationId,
      patient_id:       patientId,
      systolic_bp:      data.systolic_bp      ?? null,
      diastolic_bp:     data.diastolic_bp     ?? null,
      heart_rate:       data.heart_rate       ?? null,
      respiratory_rate: data.respiratory_rate ?? null,
      spo2:             data.spo2             ?? null,
      weight_kg:        data.weight_kg        ?? null,
      height_cm:        data.height_cm        ?? null,
      temperature_c:    data.temperature_c    ?? null,
      blood_glucose:    data.blood_glucose    ?? null,
      pain_scale:       data.pain_scale       ?? null,
      notes:            data.notes            ?? null,
    })
    // Update baseline so isDirty resets (new record becomes the new baseline)
    prefilled.current = result.id
    reset(data)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-rose-500" /> Signes vitaux
          </CardTitle>
          {vitalsList && vitalsList.length > 1 && (
            <button
              type="button"
              onClick={() => setHistoryOpen(o => !o)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              {vitalsList.length} mesure{vitalsList.length > 1 ? 's' : ''}
              {historyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        )}

        {/* History list */}
        {historyOpen && vitalsList && (
          <div className="rounded-lg border bg-gray-50 divide-y text-xs overflow-hidden">
            {vitalsList.map((v, i) => (
              <div key={v.id} className="flex items-center justify-between px-3 py-2 gap-2">
                <span className="flex items-center gap-1.5 text-gray-500 shrink-0">
                  <Clock className="h-3 w-3" />
                  {formatDate(v.created_at)} {formatTime(v.created_at)}
                  {i === 0 && (
                    <span className="rounded-full bg-teal-100 text-teal-700 px-1.5 py-0.5 text-[10px] font-medium">
                      Actuelle
                    </span>
                  )}
                </span>
                <span className="font-medium text-gray-700 truncate">
                  {v.systolic_bp != null && v.diastolic_bp != null
                    ? `${v.systolic_bp}/${v.diastolic_bp} · `
                    : ''}
                  {v.heart_rate != null ? `${v.heart_rate} bpm` : ''}
                  {v.temperature_c != null ? ` · ${v.temperature_c}°C` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          {/* Cardiovascular */}
          <div className="space-y-3">
            <Section icon={Heart} label="Cardio-vasculaire" color="text-rose-500" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <VitalField id="sys" label="Systolique" unit="mmHg" field="systolic_bp"
                disabled={isEnded} register={register} rawValue={w.systolic_bp} />
              <VitalField id="dia" label="Diastolique" unit="mmHg" field="diastolic_bp"
                disabled={isEnded} register={register} rawValue={w.diastolic_bp} />
              <VitalField id="hr" label="Fréq. cardiaque" unit="bpm" field="heart_rate"
                disabled={isEnded} register={register} rawValue={w.heart_rate} />
            </div>
          </div>

          {/* Respiratory */}
          <div className="space-y-3">
            <Section icon={Wind} label="Respiration" color="text-blue-500" />
            <div className="grid grid-cols-2 gap-3">
              <VitalField id="rr" label="Fréq. respiratoire" unit="/min" field="respiratory_rate"
                disabled={isEnded} register={register} rawValue={w.respiratory_rate} />
              <VitalField id="spo2" label="SpO₂" unit="%" field="spo2"
                disabled={isEnded} register={register} rawValue={w.spo2} />
            </div>
          </div>

          {/* Anthropometrics */}
          <div className="space-y-3">
            <Section icon={Scale} label="Anthropométrie" color="text-violet-500" />
            <div className="grid grid-cols-2 gap-3">
              <VitalField id="wt" label="Poids" unit="kg" field="weight_kg"
                disabled={isEnded} register={register} rawValue={w.weight_kg} step="0.1" />
              <VitalField id="ht" label="Taille" unit="cm" field="height_cm"
                disabled={isEnded} register={register} rawValue={w.height_cm} step="0.1" />
            </div>
            {bmi !== null && bmiCat && (
              <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', bmiCat.cls)}>
                <span className="text-xl font-bold tabular-nums">{bmi}</span>
                <div>
                  <p className="text-xs font-semibold">IMC</p>
                  <p className="text-xs">{bmiCat.label}</p>
                </div>
              </div>
            )}
          </div>

          {/* Biologie */}
          <div className="space-y-3">
            <Section icon={Thermometer} label="Biologie" color="text-amber-500" />
            <div className="grid grid-cols-2 gap-3">
              <VitalField id="temp" label="Température" unit="°C" field="temperature_c"
                disabled={isEnded} register={register} rawValue={w.temperature_c} step="0.1" />
              <VitalField id="gly" label="Glycémie" unit="mmol/L" field="blood_glucose"
                disabled={isEnded} register={register} rawValue={w.blood_glucose} step="0.1" />
            </div>
          </div>

          {/* Pain scale */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1">
              <span className="text-base">🩹</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Douleur</span>
            </div>
            <Controller
              name="pain_scale"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({ length: 11 }, (_, i) => {
                      const selected = field.value === i
                      const colorClass =
                        i <= 3  ? (selected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50')
                        : i <= 6 ? (selected ? 'bg-amber-500 border-amber-500 text-white'   : 'border-amber-200 text-amber-700 hover:bg-amber-50')
                        :          (selected ? 'bg-red-500 border-red-500 text-white'        : 'border-red-200 text-red-700 hover:bg-red-50')
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={isEnded}
                          onClick={() => field.onChange(field.value === i ? null : i)}
                          className={cn(
                            'h-10 w-10 rounded-xl text-sm font-bold border-2 transition-all',
                            colorClass,
                            isEnded && 'opacity-40 cursor-not-allowed pointer-events-none',
                          )}
                        >
                          {i}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex justify-between px-1 text-[10px] text-gray-400 select-none">
                    <span>Aucune</span><span>Légère</span><span>Modérée</span>
                    <span>Intense</span><span>Max</span>
                  </div>
                  {field.value != null && (
                    <p className={cn(
                      'text-xs font-medium',
                      field.value <= 3 ? 'text-emerald-600'
                      : field.value <= 6 ? 'text-amber-600'
                      : 'text-red-600',
                    )}>
                      {field.value === 0 ? 'Aucune douleur'
                        : field.value <= 3 ? `Douleur légère — ${field.value}/10`
                        : field.value <= 6 ? `Douleur modérée — ${field.value}/10`
                        : field.value <= 9 ? `Douleur intense — ${field.value}/10`
                        : 'Douleur maximale — 10/10'}
                    </p>
                  )}
                </div>
              )}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Notes</Label>
            <Textarea
              {...register('notes')}
              rows={2}
              disabled={isEnded}
              placeholder="Observations particulières..."
              className={cn('resize-none text-sm', isEnded && 'bg-gray-50 text-gray-500')}
            />
          </div>

          {/* Save — sticky on mobile via the consultation page topbar actions */}
          {!isEnded && (
            <div className="sticky bottom-4 flex justify-end pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || recordMutation.isPending || !isDirty}
                className={cn(
                  'gap-1.5 shadow-md transition-all',
                  saved && 'bg-emerald-600 hover:bg-emerald-600',
                )}
              >
                {(isSubmitting || recordMutation.isPending)
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : saved
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : null}
                {saved ? 'Enregistré' : 'Enregistrer les signes vitaux'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
