'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft, Loader2, Pencil, Plus, ShieldCheck, FileText,
  BadgeCheck, Clock, GraduationCap, IdCard,
} from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoTextarea } from '@/components/ui/auto-textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import {
  useWorkforceMembers, useClinicCredentials, useClinicTrainings, useEmployeeEvents,
  useUpsertEmployeeProfile, useChangeEmploymentStatus, useSaveCredential, useAddTraining,
} from '@/hooks/useWorkforce'
import { allowedTransitions, transitionEvent } from '@/lib/workforce/lifecycle'
import { credentialReminders } from '@/lib/workforce/credentials'
import { buildProfessionalTimeline } from '@/lib/workforce/timeline'
import { profileCompleteness } from '@/lib/workforce/insights'
import { listDepartments, departmentLabelKey } from '@/lib/workforce/departments'
import { availableWorkforceDocuments, type WorkforceDocumentDefinition } from '@/lib/workforce/documents'
import { cn } from '@/lib/utils'
import {
  Chip, STATUS_STYLES, STATUS_LABEL_KEY, TYPE_LABEL_KEY, CREDENTIAL_TYPE_KEY,
  VERIFICATION_STYLES, EVENT_LABEL_KEY, tierStyle, prettifySpecialty,
} from '@/components/workforce/common'
import { WorkforceDocumentBuilder } from '@/components/workforce/WorkforceDocumentBuilder'
import type { EmploymentStatus, EmploymentType, VerificationStatus } from '@/lib/workforce/types'

const EMPLOYMENT_TYPES: EmploymentType[] = ['permanent', 'contract', 'intern', 'resident', 'consultant', 'volunteer']
const CREDENTIAL_TYPES = ['license', 'board_certification', 'diploma', 'training', 'council_registration', 'other']

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = use(params)
  const t = useTranslations('workforce')
  const { formatDate } = useFormatters()
  const { clinic, profile } = useClinic()
  const now = useMemo(() => new Date(), [])
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const { data: members, isLoading } = useWorkforceMembers()
  const member = members?.find(m => m.userId === userId) ?? null
  const employeeId = member?.employee?.id ?? null

  const { data: allCreds } = useClinicCredentials()
  const { data: allTrainings } = useClinicTrainings()
  const { data: events } = useEmployeeEvents(employeeId)

  // Derived views — the React Compiler memoizes these automatically.
  const credentials = (allCreds ?? []).filter(c => c.employeeId === employeeId)
  const trainings = (allTrainings ?? []).filter(tr => tr.employeeId === employeeId)
  const timeline = buildProfessionalTimeline({ events: events ?? [], credentials, trainings })
  const reminders = credentialReminders(credentials, now)

  const [editProfile, setEditProfile] = useState(false)
  const [credDialog, setCredDialog] = useState<{ open: boolean; id?: string } | null>(null)
  const [trainingDialog, setTrainingDialog] = useState(false)
  const [statusTarget, setStatusTarget] = useState<EmploymentStatus | ''>('')
  const [statusNote, setStatusNote] = useState('')
  const [docDef, setDocDef] = useState<WorkforceDocumentDefinition | null>(null)

  const changeStatus = useChangeEmploymentStatus()

  if (!isAdmin) {
    return <div className="flex flex-col h-full"><Topbar title={t('title')} />
      <div className="flex-1 flex items-center justify-center text-gray-400">{t('noAccess')}</div></div>
  }
  if (isLoading) {
    return <div className="flex flex-col h-full"><Topbar title={t('title')} />
      <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div></div>
  }
  if (!member) {
    return <div className="flex flex-col h-full"><Topbar title={t('title')} />
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
        <p>{t('memberNotFound')}</p>
        <Link href="/workforce" className="text-sm text-teal-700 hover:underline">{t('backToList')}</Link>
      </div></div>
  }

  const emp = member.employee
  const status = emp?.employmentStatus
  const completeness = profileCompleteness(member)

  function applyStatus() {
    if (!emp || !status || !statusTarget) return
    const evt = transitionEvent(status, statusTarget as EmploymentStatus)
    if (!evt) { toast.error(t('invalidTransition')); return }
    changeStatus.mutate(
      { employeeId: emp.id, from: status, to: statusTarget as EmploymentStatus, eventType: evt, note: statusNote || undefined },
      { onSuccess: () => { toast.success(t('statusUpdated')); setStatusTarget(''); setStatusNote('') }, onError: (e: Error) => toast.error(e.message) },
    )
  }

  const docContext = {
    employee: emp ? {
      full_name: member.fullName, matricule: emp.matricule, national_id: emp.nationalId,
      position: emp.position, department: emp.department ? t(departmentLabelKey(emp.department)) : null,
      hire_date: emp.hireDate, employment_type: emp.employmentType ? t(TYPE_LABEL_KEY[emp.employmentType]) : null,
      medical_license_number: emp.medicalLicenseNumber, contract_end_date: emp.contractEndDate,
    } : { full_name: member.fullName },
    clinic: { name: clinic?.name, location: clinic?.location, phone: clinic?.phone },
    now,
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Link href="/workforce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> {t('backToList')}
        </Link>

        {/* Header */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-700">
                {member.fullName[0]}
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{member.fullName}</h1>
                <p className="text-sm text-gray-500">{member.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Chip className="bg-blue-100 text-blue-700">{t(`role_${member.role}`)}</Chip>
                  {status && <Chip className={STATUS_STYLES[status]}>{t(STATUS_LABEL_KEY[status])}</Chip>}
                  {member.primarySpecialty && <Chip className="bg-indigo-100 text-indigo-700">{prettifySpecialty(member.primarySpecialty)}</Chip>}
                  {emp?.department && <Chip className="bg-gray-100 text-gray-600">{t(departmentLabelKey(emp.department))}</Chip>}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{t('profileCompleteness')}</p>
              <p className={cn('text-2xl font-bold', completeness.score >= 80 ? 'text-emerald-600' : completeness.score >= 50 ? 'text-amber-600' : 'text-rose-600')}>{completeness.score}%</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {/* Employment profile */}
            <Section title={t('secProfile')} icon={IdCard} action={
              <Button size="sm" variant="outline" onClick={() => setEditProfile(true)}><Pencil className="h-3.5 w-3.5" /> {emp ? t('edit') : t('createRecord')}</Button>
            }>
              {emp ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <Field label={t('wf_matricule')} value={emp.matricule} />
                  <Field label={t('wf_national_id')} value={emp.nationalId} />
                  <Field label={t('wf_position')} value={emp.position} />
                  <Field label={t('wf_employment_type')} value={emp.employmentType ? t(TYPE_LABEL_KEY[emp.employmentType]) : null} />
                  <Field label={t('wf_hire_date')} value={emp.hireDate ? formatDate(emp.hireDate) : null} />
                  <Field label={t('wf_contract_end')} value={emp.contractEndDate ? formatDate(emp.contractEndDate) : null} />
                  <Field label={t('wf_medical_license')} value={emp.medicalLicenseNumber} />
                  <Field label={t('wf_council')} value={emp.councilRegistration} />
                  <Field label={t('wf_emergency')} value={emp.emergencyContact?.name ? `${emp.emergencyContact.name} · ${emp.emergencyContact.phone ?? ''}` : null} />
                </div>
              ) : (
                <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">{t('noEmploymentRecordHint')}</p>
              )}
            </Section>

            {/* Credentials */}
            <Section title={t('secCredentials')} icon={BadgeCheck} action={
              emp && <Button size="sm" variant="outline" onClick={() => setCredDialog({ open: true })}><Plus className="h-3.5 w-3.5" /> {t('addCredential')}</Button>
            }>
              {!emp ? <Muted text={t('needRecordFirst')} />
                : credentials.length === 0 ? <Muted text={t('noCredentials')} />
                : (
                  <ul className="divide-y">
                    {credentials.map(c => {
                      const rem = reminders.find(r => r.credential.id === c.id)
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900">{t(CREDENTIAL_TYPE_KEY[c.credentialType] ?? 'cred_other')}{c.number ? ` · ${c.number}` : ''}</p>
                            <p className="truncate text-xs text-gray-400">{c.issuingAuthority ?? ''}{c.expiryDate ? ` · ${t('expires')} ${formatDate(c.expiryDate)}` : ''}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {rem && <Chip className={tierStyle(rem.tier)}>{rem.tier === 'expired' ? t('expired') : t('inDays', { days: rem.days })}</Chip>}
                            <Chip className={VERIFICATION_STYLES[c.verificationStatus]}>{t(`verif_${c.verificationStatus}`)}</Chip>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCredDialog({ open: true, id: c.id })}><Pencil className="h-3.5 w-3.5" /></Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </Section>

            {/* Employment lifecycle + timeline */}
            <Section title={t('secLifecycle')} icon={Clock}>
              {emp && status && allowedTransitions(status).length > 0 && (
                <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border bg-gray-50 p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('changeStatus')}</Label>
                    <Select value={statusTarget} onValueChange={v => setStatusTarget(v as EmploymentStatus)}>
                      <SelectTrigger className="w-44"><SelectValue placeholder={t('selectStatus')} /></SelectTrigger>
                      <SelectContent>
                        {allowedTransitions(status).map(s => <SelectItem key={s} value={s}>{t(STATUS_LABEL_KEY[s])}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input className="w-48" placeholder={t('noteOptional')} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                  <Button size="sm" disabled={!statusTarget || changeStatus.isPending} onClick={applyStatus}>
                    {changeStatus.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t('apply')}
                  </Button>
                </div>
              )}
              {timeline.length === 0 ? <Muted text={t('noHistory')} /> : (
                <ol className="relative space-y-3 border-l border-gray-200 pl-4">
                  {timeline.map(e => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-teal-500" />
                      <p className="text-sm font-medium text-gray-800">{t(EVENT_LABEL_KEY[e.type] ?? 'evt_note')}</p>
                      <p className="text-xs text-gray-400">
                        {formatDate(e.date)}
                        {e.fromValue && e.toValue ? ` · ${e.fromValue} → ${e.toValue}` : ''}
                        {e.ref ? ` · ${e.ref}` : ''}{e.note ? ` · ${e.note}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          {/* Right rail */}
          <div className="space-y-5">
            {/* Session & security */}
            <Section title={t('secSession')} icon={ShieldCheck}>
              <dl className="space-y-2 text-sm">
                <SessionRow label={t('mustChangePassword')} value={member.mustChangePassword ? t('yes') : t('no')} tone={member.mustChangePassword ? 'warn' : 'ok'} />
                <SessionRow label={t('accountStatus')} value={member.isActive ? t('active') : t('inactive')} tone={member.isActive ? 'ok' : 'warn'} />
                <SessionRow label={t('lastLogin')} value={t('notInstrumented')} tone="muted" />
                <SessionRow label={t('passwordChanged')} value={t('notInstrumented')} tone="muted" />
                <SessionRow label={t('mfaReady')} value={t('future')} tone="muted" />
                <SessionRow label={t('activeSessions')} value={t('notAvailable')} tone="muted" />
                <SessionRow label={t('failedLogins')} value={t('future')} tone="muted" />
              </dl>
              <p className="mt-3 text-[11px] text-gray-400">{t('sessionNote')}</p>
            </Section>

            {/* Training */}
            <Section title={t('secTraining')} icon={GraduationCap} action={
              emp && <Button size="sm" variant="outline" onClick={() => setTrainingDialog(true)}><Plus className="h-3.5 w-3.5" /> {t('addTraining')}</Button>
            }>
              {!emp ? <Muted text={t('needRecordFirst')} />
                : trainings.length === 0 ? <Muted text={t('noTraining')} />
                : <ul className="space-y-2">{trainings.map(tr => (
                    <li key={tr.id} className="text-sm">
                      <p className="font-medium text-gray-800">{tr.title}</p>
                      <p className="text-xs text-gray-400">{[tr.provider, tr.completedDate ? formatDate(tr.completedDate) : null].filter(Boolean).join(' · ')}</p>
                    </li>
                  ))}</ul>}
            </Section>

            {/* Workforce documents */}
            <Section title={t('secDocuments')} icon={FileText}>
              <ul className="space-y-1">
                {availableWorkforceDocuments(profile?.role ?? null).map(d => (
                  <li key={d.id}>
                    <button onClick={() => setDocDef(d)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50">
                      <FileText className="h-3.5 w-3.5 text-gray-400" /> {t(d.titleKey)}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {editProfile && <ProfileDialog member={member} onClose={() => setEditProfile(false)} />}
      {credDialog?.open && emp && (
        <CredentialDialog employeeId={emp.id} existing={credentials.find(c => c.id === credDialog.id)} onClose={() => setCredDialog(null)} />
      )}
      {trainingDialog && emp && <TrainingDialog employeeId={emp.id} onClose={() => setTrainingDialog(false)} />}
      {docDef && (
        <WorkforceDocumentBuilder def={docDef} context={docContext} signerName={profile?.full_name ?? ''} onClose={() => setDocDef(null)} />
      )}
    </div>
  )
}

// ── Small presentational helpers ───────────────────────────────────
function Section({ title, icon: Icon, action, children }: { title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal-600" /><h2 className="text-sm font-semibold text-gray-900">{title}</h2></div>
        {action}
      </div>
      {children}
    </CardContent></Card>
  )
}
function Field({ label, value }: { label: string; value?: string | null }) {
  return <div><dt className="text-xs text-gray-400">{label}</dt><dd className="font-medium text-gray-800">{value || '—'}</dd></div>
}
function Muted({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">{text}</p>
}
function SessionRow({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={cn('font-medium', tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-400')}>{value}</dd>
    </div>
  )
}

// ── Profile edit dialog ────────────────────────────────────────────
function ProfileDialog({ member, onClose }: { member: NonNullable<ReturnType<typeof useWorkforceMembers>['data']>[number]; onClose: () => void }) {
  const t = useTranslations('workforce')
  const save = useUpsertEmployeeProfile()
  const e = member.employee
  const [f, setF] = useState({
    matricule: e?.matricule ?? '', nationalId: e?.nationalId ?? '', medicalLicenseNumber: e?.medicalLicenseNumber ?? '',
    councilRegistration: e?.councilRegistration ?? '', department: e?.department ?? '', position: e?.position ?? '',
    employmentType: e?.employmentType ?? '', hireDate: e?.hireDate ?? '', contractEndDate: e?.contractEndDate ?? '',
    biography: e?.biography ?? '', ecName: e?.emergencyContact?.name ?? '', ecPhone: e?.emergencyContact?.phone ?? '',
  })
  function submit() {
    save.mutate({
      userId: member.userId, matricule: f.matricule || null, nationalId: f.nationalId || null,
      medicalLicenseNumber: f.medicalLicenseNumber || null, councilRegistration: f.councilRegistration || null,
      department: f.department || null, position: f.position || null, employmentType: f.employmentType || null,
      hireDate: f.hireDate || null, contractEndDate: f.contractEndDate || null, biography: f.biography || null,
      emergencyContact: (f.ecName || f.ecPhone) ? { name: f.ecName, phone: f.ecPhone } : null,
    }, { onSuccess: () => { toast.success(t('saved')); onClose() }, onError: (err: Error) => toast.error(err.message) })
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('secProfile')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <TF label={t('wf_matricule')} v={f.matricule} set={v => setF(s => ({ ...s, matricule: v }))} />
          <TF label={t('wf_national_id')} v={f.nationalId} set={v => setF(s => ({ ...s, nationalId: v }))} />
          <TF label={t('wf_position')} v={f.position} set={v => setF(s => ({ ...s, position: v }))} />
          <div className="space-y-1">
            <Label className="text-xs">{t('wf_department')}</Label>
            <Select value={f.department || '__none'} onValueChange={v => setF(s => ({ ...s, department: v === '__none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder={t('selectDepartment')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {listDepartments().map(d => <SelectItem key={d.code} value={d.code}>{t(d.labelKey)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('wf_employment_type')}</Label>
            <Select value={f.employmentType || '__none'} onValueChange={v => setF(s => ({ ...s, employmentType: v === '__none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder={t('selectType')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {EMPLOYMENT_TYPES.map(ty => <SelectItem key={ty} value={ty}>{t(TYPE_LABEL_KEY[ty])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <TF label={t('wf_medical_license')} v={f.medicalLicenseNumber} set={v => setF(s => ({ ...s, medicalLicenseNumber: v }))} />
          <TF label={t('wf_council')} v={f.councilRegistration} set={v => setF(s => ({ ...s, councilRegistration: v }))} />
          <TF label={t('wf_hire_date')} type="date" v={f.hireDate} set={v => setF(s => ({ ...s, hireDate: v }))} />
          <TF label={t('wf_contract_end')} type="date" v={f.contractEndDate} set={v => setF(s => ({ ...s, contractEndDate: v }))} />
          <TF label={t('ecName')} v={f.ecName} set={v => setF(s => ({ ...s, ecName: v }))} />
          <TF label={t('ecPhone')} v={f.ecPhone} set={v => setF(s => ({ ...s, ecPhone: v }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('wf_biography')}</Label>
          <AutoTextarea value={f.biography} onChange={ev => setF(s => ({ ...s, biography: ev.target.value }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Credential dialog ──────────────────────────────────────────────
function CredentialDialog({ employeeId, existing, onClose }: {
  employeeId: string
  existing?: { id: string; credentialType: string; number: string | null; issuingAuthority: string | null; issueDate: string | null; expiryDate: string | null; status: string; verificationStatus: VerificationStatus; notes: string | null }
  onClose: () => void
}) {
  const t = useTranslations('workforce')
  const save = useSaveCredential()
  const [f, setF] = useState({
    credentialType: existing?.credentialType ?? 'license', number: existing?.number ?? '',
    issuingAuthority: existing?.issuingAuthority ?? '', issueDate: existing?.issueDate ?? '',
    expiryDate: existing?.expiryDate ?? '', status: existing?.status ?? 'active',
    verificationStatus: existing?.verificationStatus ?? 'unverified', notes: existing?.notes ?? '',
  })
  function submit() {
    save.mutate({
      id: existing?.id, employeeId, credentialType: f.credentialType, number: f.number || null,
      issuingAuthority: f.issuingAuthority || null, issueDate: f.issueDate || null, expiryDate: f.expiryDate || null,
      status: f.status, verificationStatus: f.verificationStatus, notes: f.notes || null,
    }, { onSuccess: () => { toast.success(t('saved')); onClose() }, onError: (err: Error) => toast.error(err.message) })
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{existing ? t('editCredential') : t('addCredential')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('credType')}</Label>
            <Select value={f.credentialType} onValueChange={v => setF(s => ({ ...s, credentialType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CREDENTIAL_TYPES.map(c => <SelectItem key={c} value={c}>{t(CREDENTIAL_TYPE_KEY[c])}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <TF label={t('wf_number')} v={f.number} set={v => setF(s => ({ ...s, number: v }))} />
          <TF label={t('wf_issuing_authority')} v={f.issuingAuthority} set={v => setF(s => ({ ...s, issuingAuthority: v }))} />
          <TF label={t('wf_issue_date')} type="date" v={f.issueDate} set={v => setF(s => ({ ...s, issueDate: v }))} />
          <TF label={t('wf_expiry_date')} type="date" v={f.expiryDate} set={v => setF(s => ({ ...s, expiryDate: v }))} />
          <div className="space-y-1">
            <Label className="text-xs">{t('verification')}</Label>
            <Select value={f.verificationStatus} onValueChange={v => setF(s => ({ ...s, verificationStatus: v as VerificationStatus }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unverified">{t('verif_unverified')}</SelectItem>
                <SelectItem value="verified">{t('verif_verified')}</SelectItem>
                <SelectItem value="rejected">{t('verif_rejected')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-gray-400">{t('verificationNote')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Training dialog ────────────────────────────────────────────────
function TrainingDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const t = useTranslations('workforce')
  const add = useAddTraining()
  const [f, setF] = useState({ title: '', provider: '', completedDate: '', expiryDate: '' })
  function submit() {
    if (!f.title.trim()) { toast.error(t('titleRequired')); return }
    add.mutate({ employeeId, title: f.title, provider: f.provider || null, completedDate: f.completedDate || null, expiryDate: f.expiryDate || null },
      { onSuccess: () => { toast.success(t('saved')); onClose() }, onError: (err: Error) => toast.error(err.message) })
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('addTraining')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <TF label={t('wdoc_training_title')} v={f.title} set={v => setF(s => ({ ...s, title: v }))} />
          <TF label={t('wf_provider')} v={f.provider} set={v => setF(s => ({ ...s, provider: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <TF label={t('wf_completed_date')} type="date" v={f.completedDate} set={v => setF(s => ({ ...s, completedDate: v }))} />
            <TF label={t('wf_expiry_date')} type="date" v={f.expiryDate} set={v => setF(s => ({ ...s, expiryDate: v }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={add.isPending} onClick={submit}>{add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TF({ label, v, set, type }: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type={type ?? 'text'} value={v} onChange={e => set(e.target.value)} /></div>
}
