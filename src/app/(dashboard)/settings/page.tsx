'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Settings2, Search, ChevronRight, Loader2, Save, RotateCcw, Lock, ArrowUpRight,
  Building2, Palette, Clock, Stethoscope, Pill, FlaskConical, Receipt, MessageSquare,
  Sparkles, ShieldCheck, History, User, Download, Users, Activity, Mail, ClipboardList,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClinic } from '@/context/ClinicContext'
import { useExportEntity } from '@/hooks/useCompliance'
import { useClinicSettings, useSaveClinicSettings, useSettingsHistory, useSettingsOverview } from '@/hooks/useClinicSettings'
import { isValidPhone, toStoredPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useFormatters } from '@/hooks/useFormatters'
import {
  SETTINGS_CATEGORY_ORDER, getSection,
  type SettingsSection, type SettingsField, type SectionValues, type SettingValue,
} from '@/lib/settings/registry'
import {
  canEditSettings, visibleSections, searchSettings, mergeSectionValues, changedKeys, pickSectionValues,
} from '@/lib/settings/logic'

const ICONS: Record<string, React.ElementType> = {
  Building2, Palette, Clock, Stethoscope, Pill, FlaskConical, Receipt, MessageSquare,
  Sparkles, ShieldCheck, History, User, Download,
}
const CATEGORY_ICON: Record<string, React.ElementType> = {
  clinic: Building2, organization: Users, clinical: Stethoscope, pharmacy: Pill,
  laboratory: FlaskConical, billing: Receipt, communication: MessageSquare, ai: Sparkles,
  users: ShieldCheck, security: Lock, audit: History,
}

export default function SettingsHubPage() {
  const t = useTranslations('adminHub')
  const { clinic, profile } = useClinic()
  const role = profile?.role ?? ''
  const canEdit = canEditSettings(role)

  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState('profile')

  const sections = useMemo(() => visibleSections(role), [role])
  const searchHits = useMemo(() => (query.trim() ? searchSettings(query, role) : []), [query, role])
  const shownSections = useMemo(
    () => (query.trim() ? sections.filter(s => searchHits.some(h => h.section.id === s.id)) : sections),
    [sections, searchHits, query],
  )
  const active = sections.find(s => s.id === activeId) ?? sections[0]

  const { data: stored } = useClinicSettings()
  const { data: overview } = useSettingsOverview()

  const overviewCards = [
    { icon: Users, label: t('ovUsers'), value: overview?.users ?? '—' },
    { icon: Stethoscope, label: t('ovDoctors'), value: overview?.activeDoctors ?? '—' },
    { icon: Mail, label: t('ovInvites'), value: overview?.pendingInvitations ?? '—' },
    { icon: Activity, label: t('ovChanges'), value: overview?.recentChanges ?? '—' },
    { icon: ShieldCheck, label: t('ovLicense'), value: clinic?.subscription_plan ?? '—' },
  ]

  return (
    <div className="flex h-full flex-col">
      <Topbar title={t('title')} description={t('subtitle')} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">

          {/* Executive overview */}
          <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 p-4 shadow-sm md:p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-white"><Settings2 className="h-5 w-5" /></div>
              <div>
                <h1 className="text-base font-bold text-gray-900">{t('heroTitle')}</h1>
                <p className="text-xs text-gray-500">{t('heroHelper')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {overviewCards.map(c => (
                <div key={c.label} className="rounded-xl border bg-white/70 px-3 py-2">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><c.icon className="h-3 w-3" /> {c.label}</p>
                  <p className="mt-0.5 text-lg font-bold capitalize text-gray-900">{c.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-9" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:gap-6">
            {/* Navigation */}
            <nav className="space-y-3">
              {SETTINGS_CATEGORY_ORDER.map(cat => {
                const catSections = shownSections.filter(s => s.category === cat)
                if (catSections.length === 0) return null
                const CatIcon = CATEGORY_ICON[cat] ?? Settings2
                return (
                  <div key={cat}>
                    <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      <CatIcon className="h-3 w-3" /> {t(`cat_${cat}`)}
                    </p>
                    <div className="space-y-0.5">
                      {catSections.map(s => {
                        const Icon = ICONS[s.icon] ?? Settings2
                        return (
                          <button
                            key={s.id}
                            onClick={() => setActiveId(s.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                              active?.id === s.id ? 'bg-teal-50 font-medium text-teal-700' : 'text-gray-600 hover:bg-gray-100',
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{t(s.titleKey)}</span>
                            {active?.id === s.id && <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {shownSections.length === 0 && <p className="px-2 text-sm text-gray-400">{t('noResults')}</p>}
            </nav>

            {/* Workspace */}
            <div className="min-w-0">
              {active && <SectionWorkspace section={active} stored={stored?.[active.id] ?? null} canEdit={canEdit} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section router ─────────────────────────────────────────────────
function SectionWorkspace({ section, stored, canEdit }: { section: SettingsSection; stored: SectionValues | null; canEdit: boolean }) {
  const t = useTranslations('adminHub')
  const Icon = ICONS[section.icon] ?? Settings2
  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="mb-4 flex items-start gap-2.5 border-b pb-3">
          <Icon className="mt-0.5 h-5 w-5 text-teal-700" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t(section.titleKey)}</h2>
            {section.descKey && <p className="text-xs text-gray-500">{t(section.descKey)}</p>}
          </div>
          {!canEdit && section.kind === 'settings' && (
            <Badge variant="outline" className="ml-auto text-gray-500"><Lock className="mr-1 h-3 w-3" /> {t('readOnly')}</Badge>
          )}
        </div>

        {section.kind === 'settings' && <SettingsForm section={section} stored={stored} canEdit={canEdit} />}
        {section.kind === 'link' && (
          <Button asChild><Link href={section.href!}>{t('open')} <ArrowUpRight className="h-4 w-4" /></Link></Button>
        )}
        {section.kind === 'audit' && <AuditPanel />}
        {section.kind === 'native' && section.id === 'profile' && <ProfileForm />}
        {section.kind === 'native' && section.id === 'clinic_identity' && <ClinicIdentityForm canEdit={canEdit} />}
        {section.kind === 'native' && section.id === 'sms' && <SmsForm canEdit={canEdit} />}
        {section.kind === 'native' && section.id === 'export' && <ExportPanel />}
      </CardContent>
    </Card>
  )
}

// ── Generic registry-driven settings form ──────────────────────────
function SettingsForm({ section, stored, canEdit }: { section: SettingsSection; stored: SectionValues | null; canEdit: boolean }) {
  const t = useTranslations('adminHub')
  const save = useSaveClinicSettings()
  const saved = useMemo(() => mergeSectionValues(section, stored), [section, stored])
  const [draft, setDraft] = useState<SectionValues>(saved)
  // Re-sync when the persisted values change (e.g. after a save/refetch).
  const savedKey = JSON.stringify(saved)
  const [lastSavedKey, setLastSavedKey] = useState(savedKey)
  if (savedKey !== lastSavedKey) { setLastSavedKey(savedKey); setDraft(saved) }

  const changed = changedKeys(saved, draft)
  const setField = (key: string, value: SettingValue) => setDraft(d => ({ ...d, [key]: value }))

  function onSave() {
    save.mutate({ sectionId: section.id, values: pickSectionValues(section, draft), changedKeys: changed })
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {section.fields.map(f => (
          <FieldInput key={f.key} field={f} value={draft[f.key]} disabled={!canEdit} onChange={v => setField(f.key, v)} />
        ))}
      </div>

      {/* Sticky save bar with unsaved indicator */}
      {canEdit && changed.length > 0 && (
        <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> {t('unsaved', { count: changed.length })}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft(saved)} disabled={save.isPending}>
              <RotateCcw className="h-3.5 w-3.5" /> {t('discard')}
            </Button>
            <Button size="sm" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t('save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldInput({ field, value, disabled, onChange }: {
  field: SettingsField; value: SettingValue | undefined; disabled: boolean; onChange: (v: SettingValue) => void
}) {
  const t = useTranslations('adminHub')
  const v = value ?? field.default

  if (field.type === 'boolean') {
    return (
      <label className={cn('flex items-center justify-between gap-2 rounded-lg border p-3 sm:col-span-2', disabled ? 'opacity-70' : 'cursor-pointer hover:bg-gray-50')}>
        <span className="text-sm font-medium text-gray-700">{t(field.labelKey)}</span>
        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" checked={!!v} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      </label>
    )
  }
  return (
    <div className={cn('space-y-1.5', field.type === 'textarea' && 'sm:col-span-2')}>
      <Label className="text-sm">{t(field.labelKey)}</Label>
      {field.type === 'select' ? (
        <Select value={String(v)} onValueChange={val => onChange(val)} disabled={disabled}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{field.options?.map(o => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}</SelectContent>
        </Select>
      ) : field.type === 'textarea' ? (
        <Textarea value={String(v)} rows={2} disabled={disabled} onChange={e => onChange(e.target.value)} />
      ) : field.type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={String(v)} disabled={disabled} onChange={e => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border" />
          <Input value={String(v)} disabled={disabled} onChange={e => onChange(e.target.value)} className="font-mono" />
        </div>
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(v)} disabled={disabled}
          min={field.min} max={field.max}
          onChange={e => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </div>
  )
}

// ── Native: my profile (user_profiles) ─────────────────────────────
function ProfileForm() {
  const t = useTranslations('settings')
  const { profile, refetch } = useClinic()
  const supabase = createClient()
  const schema = z.object({ full_name: z.string().min(2), phone: z.string().optional().nullable().refine(isValidPhone, t('zodPhoneInvalid')) })
  type F = z.infer<typeof schema>
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' } })
  async function onSave(data: F) {
    if (!profile) return
    const { error } = await supabase.from('user_profiles').update({ full_name: data.full_name, phone: toStoredPhone(data.phone) }).eq('id', profile.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('profileSaved')); refetch()
  }
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label>{t('labelFullName')}</Label><Input {...form.register('full_name')} /></div>
      <div className="space-y-1.5"><Label>{t('labelPhone')}</Label><Input {...form.register('phone')} placeholder="+221 77 123 45 67" />
        {form.formState.errors.phone && <p className="text-xs text-red-500">{form.formState.errors.phone.message}</p>}</div>
      <div className="space-y-1.5"><Label>{t('labelEmail')}</Label><Input value={profile?.email ?? ''} disabled className="bg-gray-50" /></div>
      <div className="sm:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} {t('saveProfile')}</Button></div>
    </form>
  )
}

// ── Native: clinic identity (clinics) ──────────────────────────────
function ClinicIdentityForm({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('settings')
  const { clinic, refetch } = useClinic()
  const supabase = createClient()
  const schema = z.object({
    name: z.string().min(2), location: z.string().min(2),
    phone: z.string().optional().nullable().refine(isValidPhone, t('zodPhoneInvalid')),
    email: z.string().email().optional().or(z.literal('')).nullable(),
    ninea: z.string().optional().nullable(), rc_number: z.string().optional().nullable(),
  })
  type F = z.infer<typeof schema>
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: {
    name: clinic?.name ?? '', location: clinic?.location ?? '', phone: clinic?.phone ?? '',
    email: clinic?.email ?? '', ninea: clinic?.ninea ?? '', rc_number: clinic?.rc_number ?? '',
  } })
  async function onSave(data: F) {
    if (!clinic) return
    const { error } = await supabase.from('clinics').update({
      name: data.name, location: data.location, phone: toStoredPhone(data.phone),
      email: data.email ?? null, ninea: data.ninea?.trim() || null, rc_number: data.rc_number?.trim() || null,
    }).eq('id', clinic.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('clinicSaved')); refetch()
  }
  if (!canEdit) return <p className="text-sm text-gray-400">{t('clinicDesc')}</p>
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label>{t('labelClinicName')}</Label><Input {...form.register('name')} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label>{t('labelLocation')}</Label><Input {...form.register('location')} /></div>
      <div className="space-y-1.5"><Label>{t('labelPhone')}</Label><Input {...form.register('phone')} placeholder="+221 33 821 00 00" />
        {form.formState.errors.phone && <p className="text-xs text-red-500">{form.formState.errors.phone.message}</p>}</div>
      <div className="space-y-1.5"><Label>{t('labelEmail')}</Label><Input type="email" {...form.register('email')} /></div>
      <div className="space-y-1.5"><Label>{t('labelNinea')}</Label><Input {...form.register('ninea')} placeholder="0012345678" /></div>
      <div className="space-y-1.5"><Label>{t('labelRc')}</Label><Input {...form.register('rc_number')} placeholder="SN-DKR-2024-A-12345" /></div>
      <div className="sm:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} {t('saveClinic')}</Button></div>
    </form>
  )
}

// ── Native: SMS reminders (clinics sms_*) ──────────────────────────
function SmsForm({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('settings')
  const { clinic, refetch } = useClinic()
  const supabase = createClient()
  const form = useForm<{ sms_reminders_enabled: boolean; reminder_24h_enabled: boolean; reminder_same_day_enabled: boolean; sms_sender_id: string }>({
    defaultValues: {
      sms_reminders_enabled: clinic?.sms_reminders_enabled ?? false,
      reminder_24h_enabled: clinic?.reminder_24h_enabled ?? true,
      reminder_same_day_enabled: clinic?.reminder_same_day_enabled ?? true,
      sms_sender_id: clinic?.sms_sender_id ?? '',
    },
  })
  async function onSave(data: { sms_reminders_enabled: boolean; reminder_24h_enabled: boolean; reminder_same_day_enabled: boolean; sms_sender_id: string }) {
    if (!clinic) return
    const { error } = await supabase.from('clinics').update({
      sms_reminders_enabled: data.sms_reminders_enabled, reminder_24h_enabled: data.reminder_24h_enabled,
      reminder_same_day_enabled: data.reminder_same_day_enabled, sms_sender_id: data.sms_sender_id?.trim() || null,
    }).eq('id', clinic.id)
    if (error) { toast.error(error.message); return }
    toast.success(t('clinicSaved')); refetch()
  }
  if (!canEdit) return <p className="text-sm text-gray-400">{t('smsRemindersHint')}</p>
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="space-y-3">
      <label className="flex cursor-pointer items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" {...form.register('sms_reminders_enabled')} />
        <span className="text-sm"><span className="font-medium">{t('labelSmsReminders')}</span><span className="block text-xs text-gray-500">{t('smsRemindersHint')}</span></span></label>
      <div className="space-y-2 pl-7">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" {...form.register('reminder_24h_enabled')} /> {t('labelReminder24h')}</label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" {...form.register('reminder_same_day_enabled')} /> {t('labelReminderSameDay')}</label>
      </div>
      <div className="space-y-1.5"><Label>{t('labelSmsSender')}</Label><Input {...form.register('sms_sender_id')} placeholder="CLINIQUE" maxLength={11} /><p className="text-xs text-gray-400">{t('smsSenderHint')}</p></div>
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} {t('saveClinic')}</Button>
    </form>
  )
}

// ── Native: data export ────────────────────────────────────────────
const EXPORT_ENTITIES = ['patients', 'appointments', 'consultations', 'prescriptions', 'invoices', 'payments'] as const
function ExportPanel() {
  const t = useTranslations('settings')
  const exportEntity = useExportEntity()
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EXPORT_ENTITIES.map(entity => (
          <Button key={entity} variant="outline" className="justify-start" disabled={exportEntity.isPending} onClick={() => exportEntity.mutate(entity)}>
            {exportEntity.isPending && exportEntity.variables === entity ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t(`export_${entity}`)}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">{t('exportNote')}</p>
    </div>
  )
}

// ── Audit: recent configuration changes ────────────────────────────
function AuditPanel() {
  const t = useTranslations('adminHub')
  const { formatDate, formatTime } = useFormatters()
  const { data: history, isLoading } = useSettingsHistory(12)
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{t('auditIntro')}</p>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
      ) : (history ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">{t('auditEmpty')}</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {history!.map(h => (
            <div key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-gray-700"><ClipboardList className="h-3.5 w-3.5 text-teal-600" /> {getSection(h.section_id) ? t(getSection(h.section_id)!.titleKey) : h.section_id}</span>
              <span className="text-xs text-gray-400">{h.changed_keys.length} · {formatDate(h.created_at)} {formatTime(h.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] leading-tight text-muted-foreground/70">{t('auditNote')}</p>
    </div>
  )
}
