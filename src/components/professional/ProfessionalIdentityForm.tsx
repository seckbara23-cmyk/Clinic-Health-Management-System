'use client'

// ── Professional Identity editor (Phase 14.2.2) ────────────────────
// Internal infrastructure editor for the current professional's own profile
// (professional_profiles, migration 038). Rendered as a native section inside the
// existing Settings hub — it adds NO new top-level navigation and changes no
// existing workflow. Every professional edits ONLY their own row (RLS-enforced).
// It consumes the Professional Identity API exclusively — never the table.

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Loader2, Save, Plus, Trash2, Upload, X, IdCard, BadgeCheck, AlertTriangle, Camera, PenLine,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  useProfessionalIdentity, useProfessionalCredentials, useProfessionalMedia,
} from '@/hooks/useProfessionalIdentity'
import {
  validateIdentity, validateCredentials, duplicateLicenseNumbers, licenseConflictsInClinic,
  normalizeLanguage, normalizeLicenseNumber, licenseNumbersFrom, initialsOf, CREDENTIAL_KINDS,
} from '@/lib/professional-identity'
import { displayNameFor } from '@/lib/professional-profile'
import type { Credential, CredentialKind, ProfessionalMediaKind } from '@/lib/professions/types'
import { cn } from '@/lib/utils'

interface Draft {
  profession: string | null
  professionalTitle: string
  displayName: string
  department: string
  position: string
  yearsExperience: string
  languages: string[]
  credentials: Credential[]
}

export function ProfessionalIdentityForm() {
  const t = useTranslations('professionalIdentity')
  const tp = useTranslations('professions')
  const identity = useProfessionalIdentity()
  const creds = useProfessionalCredentials()
  const media = useProfessionalMedia()

  const profile = identity.profile
  // Seed the draft once the profile resolves; re-seed if the underlying row changes.
  const seedKey = JSON.stringify([
    profile?.profession, profile?.professionalTitle, profile?.displayName, profile?.department,
    profile?.position, profile?.yearsExperience, profile?.languages, profile?.credentials,
  ])
  const [lastSeed, setLastSeed] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile, identity.profession.id))
  if (seedKey !== lastSeed && !identity.isLoading) {
    setLastSeed(seedKey)
    setDraft(toDraft(profile, identity.profession.id))
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))

  // ── Validation ───────────────────────────────────────────────────
  const identityErrors = useMemo(
    () => validateIdentity({ displayName: draft.displayName, yearsExperience: draft.yearsExperience, languages: draft.languages }),
    [draft.displayName, draft.yearsExperience, draft.languages],
  )
  const credErrors = useMemo(() => validateCredentials(draft.credentials), [draft.credentials])
  const withinDupes = useMemo(() => duplicateLicenseNumbers(draft.credentials), [draft.credentials])
  // Clinic conflict = a license present on ANOTHER professional's profile.
  const ownLicenses = useMemo(() => licenseNumbersFrom([{ credentials: profile?.credentials ?? [] }]), [profile])
  const othersLicenses = useMemo(
    () => creds.clinicLicenseNumbers.filter(n => !ownLicenses.includes(n)),
    [creds.clinicLicenseNumbers, ownLicenses],
  )
  const clinicConflicts = useMemo(() => draft.credentials.flatMap((c, i) =>
    c.kind === 'medical_license' && licenseConflictsInClinic(c.identifier, othersLicenses) ? [i] : [],
  ), [draft.credentials, othersLicenses])

  const hasErrors =
    Object.keys(identityErrors).length > 0 ||
    Object.keys(credErrors).length > 0 ||
    withinDupes.length > 0 ||
    clinicConflicts.length > 0

  // ── Save ─────────────────────────────────────────────────────────
  function onSave() {
    if (hasErrors) { toast.error(t('fixErrors')); return }
    identity.save.mutate({
      profession: draft.profession,
      professionalTitle: emptyToNull(draft.professionalTitle),
      displayName: emptyToNull(draft.displayName),
      department: emptyToNull(draft.department),
      position: emptyToNull(draft.position),
      yearsExperience: draft.yearsExperience === '' ? null : Number(draft.yearsExperience),
      languages: draft.languages,
      credentials: cleanCredentials(draft.credentials),
    }, {
      onSuccess: () => toast.success(t('saved')),
      onError: (e: Error) => toast.error(e.message || t('saveError')),
    })
  }

  // ── Media handlers ───────────────────────────────────────────────
  async function onUpload(kind: ProfessionalMediaKind, file?: File | null) {
    if (!file) return
    try { await media.upload.mutateAsync({ kind, file }); toast.success(t('mediaSaved')) }
    catch (e) { toast.error((e as Error).message || t('mediaError')) }
  }
  async function onRemove(kind: ProfessionalMediaKind) {
    try { await media.remove.mutateAsync(kind); toast.success(t('mediaRemoved')) }
    catch (e) { toast.error((e as Error).message || t('mediaError')) }
  }

  const professionOptions = identity.selectableProfessions
  const canPickProfession = professionOptions.length > 1

  return (
    <div className="space-y-6">
      {/* Header: avatar + identity summary */}
      <div className="flex items-center gap-4">
        <AvatarBlock
          url={media.photoUrl}
          name={displayNameFor(profile, draft.displayName)}
          busy={media.isBusy}
          hasMedia={media.hasPhoto}
          onUpload={f => onUpload('photo', f)}
          onRemove={() => onRemove('photo')}
          uploadLabel={t('uploadPhoto')}
          removeLabel={t('removePhoto')}
        />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-gray-900">{displayNameFor(profile, draft.displayName)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 text-teal-700"><IdCard className="h-3 w-3" /> {tp(identity.profession.labelKey)}</Badge>
            {draft.professionalTitle && <span className="text-xs text-gray-500">{draft.professionalTitle}</span>}
          </div>
        </div>
      </div>

      {/* Expiry reminders (operational only) */}
      {creds.reminders.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> {t('reminderTitle')}</p>
          <ul className="space-y-1">
            {creds.reminders.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs text-amber-900">
                <span>{r.title}</span>
                <Badge variant="outline" className={cn('text-[10px]', r.severity === 'expired' ? 'border-red-300 text-red-600' : 'border-amber-300 text-amber-700')}>
                  {r.severity === 'expired' ? t('expired') : t('expiringSoon', { days: r.daysUntilExpiry })}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Identity fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t('profession')}</Label>
          {canPickProfession ? (
            <Select value={draft.profession ?? identity.profession.id} onValueChange={v => set('profession', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{professionOptions.map(p => <SelectItem key={p.id} value={p.id}>{tp(p.labelKey)}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={tp(identity.profession.labelKey)} disabled className="bg-gray-50" />
          )}
        </div>
        <Field label={t('professionalTitle')} value={draft.professionalTitle} onChange={v => set('professionalTitle', v)} placeholder="Dr, MD, RN…" />
        <div className="space-y-1.5">
          <Label>{t('displayName')}</Label>
          <Input value={draft.displayName} onChange={e => set('displayName', e.target.value)} />
          {identityErrors.displayName && <ErrText t={t} code={identityErrors.displayName} />}
        </div>
        <Field label={t('department')} value={draft.department} onChange={v => set('department', v)} />
        <Field label={t('position')} value={draft.position} onChange={v => set('position', v)} />
        <div className="space-y-1.5">
          <Label>{t('yearsExperience')}</Label>
          <Input type="number" min={0} max={70} value={draft.yearsExperience} onChange={e => set('yearsExperience', e.target.value)} />
          {identityErrors.yearsExperience && <ErrText t={t} code={identityErrors.yearsExperience} />}
        </div>
      </div>

      {/* Languages */}
      <LanguagesField
        languages={draft.languages}
        onChange={langs => set('languages', langs)}
        error={identityErrors.languages}
        t={t}
      />

      {/* Digital signature */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5"><PenLine className="h-4 w-4 text-teal-700" /> {t('signature')}</Label>
        <SignatureBlock
          url={media.signatureUrl}
          hasMedia={media.hasSignature}
          busy={media.isBusy}
          onUpload={f => onUpload('signature', f)}
          onRemove={() => onRemove('signature')}
          t={t}
        />
      </div>

      {/* Credentials + hospital privileges */}
      <CredentialsEditor
        credentials={draft.credentials}
        onChange={c => set('credentials', c)}
        errors={credErrors}
        withinDupes={withinDupes}
        clinicConflicts={clinicConflicts}
        t={t}
      />

      {/* Save */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-white/95 py-3 backdrop-blur">
        {hasErrors && <span className="text-xs text-red-500">{t('fixErrors')}</span>}
        <Button onClick={onSave} disabled={identity.save.isPending || hasErrors}>
          {identity.save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('save')}
        </Button>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function ErrText({ t, code }: { t: ReturnType<typeof useTranslations>; code: string }) {
  return <p className="text-xs text-red-500">{t(`err_${code}`)}</p>
}

function AvatarBlock({ url, name, busy, hasMedia, onUpload, onRemove, uploadLabel, removeLabel }: {
  url: string | null; name: string; busy: boolean; hasMedia: boolean
  onUpload: (f: File | null) => void; onRemove: () => void; uploadLabel: string; removeLabel: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="relative">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-teal-100 text-xl font-bold text-teal-700 shadow">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : <span>{initialsOf(name)}</span>}
      </div>
      <button
        type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white shadow hover:bg-teal-800 disabled:opacity-60"
        aria-label={uploadLabel}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { onUpload(e.target.files?.[0] ?? null); e.target.value = '' }} />
      {hasMedia && (
        <button type="button" onClick={onRemove} disabled={busy} className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-red-500 shadow hover:bg-red-50" aria-label={removeLabel}>
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function SignatureBlock({ url, hasMedia, busy, onUpload, onRemove, t }: {
  url: string | null; hasMedia: boolean; busy: boolean
  onUpload: (f: File | null) => void; onRemove: () => void; t: ReturnType<typeof useTranslations>
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-lg border bg-gray-50 text-xs text-gray-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="signature" className="max-h-full max-w-full object-contain" /> : <span>{t('noSignature')}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {hasMedia ? t('replaceSignature') : t('uploadSignature')}
        </Button>
        {hasMedia && <Button type="button" size="sm" variant="ghost" className="text-red-500" onClick={onRemove} disabled={busy}><Trash2 className="h-3.5 w-3.5" /> {t('removeSignature')}</Button>}
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => { onUpload(e.target.files?.[0] ?? null); e.target.value = '' }} />
    </div>
  )
}

function LanguagesField({ languages, onChange, error, t }: {
  languages: string[]; onChange: (l: string[]) => void; error?: string; t: ReturnType<typeof useTranslations>
}) {
  const [entry, setEntry] = useState('')
  function add() {
    const n = normalizeLanguage(entry)
    if (!n) { setEntry(''); return }
    if (!languages.includes(n)) onChange([...languages, n])
    setEntry('')
  }
  return (
    <div className="space-y-1.5">
      <Label>{t('languages')}</Label>
      <div className="flex flex-wrap gap-1.5">
        {languages.map(l => (
          <Badge key={l} variant="outline" className="gap-1 uppercase">
            {l}
            <button type="button" onClick={() => onChange(languages.filter(x => x !== l))} aria-label="remove"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={entry} onChange={e => setEntry(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder={t('languagePlaceholder')} className="max-w-[200px]" />
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-3.5 w-3.5" /> {t('addLanguage')}</Button>
      </div>
      {error && <ErrText t={t} code={error} />}
    </div>
  )
}

function CredentialsEditor({ credentials, onChange, errors, withinDupes, clinicConflicts, t }: {
  credentials: Credential[]; onChange: (c: Credential[]) => void
  errors: Record<number, Record<string, string>>; withinDupes: string[]; clinicConflicts: number[]
  t: ReturnType<typeof useTranslations>
}) {
  function update(i: number, patch: Partial<Credential>) {
    onChange(credentials.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }
  function add(kind: CredentialKind) { onChange([...credentials, { kind }]) }
  function remove(i: number) { onChange(credentials.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-teal-700" /> {t('credentials')}</Label>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => add('medical_license')}><Plus className="h-3.5 w-3.5" /> {t('addCredential')}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add('hospital_privilege')}><Plus className="h-3.5 w-3.5" /> {t('addPrivilege')}</Button>
        </div>
      </div>
      {credentials.length === 0 && <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">{t('noCredentials')}</p>}
      <div className="space-y-3">
        {credentials.map((c, i) => {
          const e = errors[i] ?? {}
          const isDupe = c.kind === 'medical_license' && withinDupes.includes(normalizeLicenseNumber(c.identifier))
          const isClinicConflict = clinicConflicts.includes(i)
          return (
            <div key={i} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Select value={c.kind} onValueChange={v => update(i, { kind: v as CredentialKind })}>
                  <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{CREDENTIAL_KINDS.map(k => <SelectItem key={k} value={k}>{t(`k_${k}`)}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" size="sm" variant="ghost" className="text-red-500" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Input value={c.identifier ?? ''} onChange={ev => update(i, { identifier: ev.target.value })} placeholder={t('credIdentifier')} />
                  {e.identifier && <ErrText t={t} code={e.identifier} />}
                  {isDupe && <p className="text-xs text-red-500">{t('err_duplicate_license')}</p>}
                  {isClinicConflict && <p className="text-xs text-red-500">{t('err_license_clinic_conflict')}</p>}
                </div>
                <Input value={c.authority ?? ''} onChange={ev => update(i, { authority: ev.target.value })} placeholder={t('credAuthority')} />
                <Input value={c.title ?? ''} onChange={ev => update(i, { title: ev.target.value })} placeholder={t('credTitle')} />
                {c.kind === 'cme' && (
                  <Input type="number" min={0} value={c.cmeCredits ?? ''} onChange={ev => update(i, { cmeCredits: ev.target.value === '' ? null : Number(ev.target.value) })} placeholder={t('credCredits')} />
                )}
                <div className="space-y-1">
                  <Label className="text-[11px] text-gray-400">{t('credIssued')}</Label>
                  <Input type="date" value={c.issuedAt ?? ''} onChange={ev => update(i, { issuedAt: ev.target.value || null })} />
                  {e.issuedAt && <ErrText t={t} code={e.issuedAt} />}
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-gray-400">{t('credExpires')}</Label>
                  <Input type="date" value={c.expiresAt ?? ''} onChange={ev => update(i, { expiresAt: ev.target.value || null })} />
                  {e.expiresAt && <ErrText t={t} code={e.expiresAt} />}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────
function toDraft(profile: ReturnType<typeof useProfessionalIdentity>['profile'], fallbackProfession: string): Draft {
  return {
    profession: profile?.profession ?? fallbackProfession,
    professionalTitle: profile?.professionalTitle ?? '',
    displayName: profile?.displayName ?? '',
    department: profile?.department ?? '',
    position: profile?.position ?? '',
    yearsExperience: profile?.yearsExperience != null ? String(profile.yearsExperience) : '',
    languages: profile?.languages ?? [],
    credentials: profile?.credentials ?? [],
  }
}
function emptyToNull(v: string): string | null { const t = v.trim(); return t.length ? t : null }
function cleanCredentials(creds: Credential[]): Credential[] {
  return creds
    .filter(c => c && CREDENTIAL_KINDS.includes(c.kind))
    .map(c => ({
      ...c,
      identifier: c.identifier?.trim() || null,
      authority: c.authority?.trim() || null,
      title: c.title?.trim() || null,
      issuedAt: c.issuedAt || null,
      expiresAt: c.expiresAt || null,
    }))
}
