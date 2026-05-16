'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, UserRound, Phone, Mail, MapPin, AlertCircle,
  Droplets, Calendar, Stethoscope, Receipt, Clock, Pencil,
  Pill, FlaskConical, History,
} from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePatient } from '@/hooks/usePatients'
import { useAppointments } from '@/hooks/useAppointments'
import { useConsultations } from '@/hooks/useConsultations'
import { useInvoices } from '@/hooks/useInvoices'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useLabRequests } from '@/hooks/useLabRequests'
import { formatDate, formatTime, formatCurrency, age, cn } from '@/lib/utils'
import type { Prescription, LabRequest } from '@/types/database'

const apptStatusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800', in_queue: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-violet-100 text-violet-800', completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600', no_show: 'bg-red-100 text-red-800',
}
const apptStatusLabels: Record<string, string> = {
  scheduled: 'Planifié', in_queue: 'En attente', in_progress: 'En cours',
  completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent',
}
const invStatusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700', partial: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400',
}
const invStatusLabels: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée',
  partial: 'Partiel', overdue: 'En retard', cancelled: 'Annulée',
}
const rxStatusColors: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700', dispensed: 'bg-blue-100 text-blue-700',
  expired: 'bg-gray-100 text-gray-500', cancelled: 'bg-red-100 text-red-500',
}
const rxStatusLabels: Record<string, string> = {
  active: 'Active', dispensed: 'Délivrée', expired: 'Expirée', cancelled: 'Annulée',
}
const labStatusColors: Record<string, string> = {
  ordered: 'bg-blue-100 text-blue-700', collected: 'bg-purple-100 text-purple-700',
  processing: 'bg-amber-100 text-amber-700', resulted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-500',
}
const labStatusLabels: Record<string, string> = {
  ordered: 'Demandé', collected: 'Prélevé', processing: 'En cours',
  resulted: 'Résultat disponible', cancelled: 'Annulé',
}
const genderLabel: Record<string, string> = { male: 'Homme', female: 'Femme', other: 'Autre' }

type Tab = 'history' | 'prescriptions' | 'labs' | 'timeline'

export default function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [activeTab, setActiveTab] = useState<Tab>('history')

  const { data: patient, isLoading } = usePatient(id)
  const { data: appointments } = useAppointments()
  const { data: consultations } = useConsultations(id)
  const { data: invoices } = useInvoices()
  const { data: prescriptions } = usePrescriptions()
  const { data: labRequests } = useLabRequests(id)

  const patientAppointments = appointments?.filter(a => a.patient_id === id) ?? []
  const patientInvoices = invoices?.filter(i => i.patient_id === id) ?? []
  const patientPrescriptions = prescriptions?.filter(rx => rx.patient_id === id) ?? []

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Profil patient" />
        <div className="flex-1 flex items-center justify-center text-gray-400">Chargement...</div>
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Profil patient" />
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <UserRound className="h-12 w-12 opacity-30" />
          <p>Patient introuvable</p>
          <Link href="/patients"><Button variant="outline" size="sm">Retour aux patients</Button></Link>
        </div>
      </div>
    )
  }

  // Timeline: merge all events by date descending
  type TimelineEvent = {
    date: string
    type: 'consultation' | 'appointment' | 'invoice' | 'prescription' | 'lab'
    title: string
    subtitle?: string
    badge?: string
    badgeColor?: string
    icon: React.ElementType
  }
  const timelineEvents: TimelineEvent[] = [
    ...(consultations ?? []).map(c => ({
      date: c.created_at, type: 'consultation' as const,
      title: c.chief_complaint ?? 'Consultation',
      subtitle: c.diagnosis ? `Diag: ${c.diagnosis}` : undefined,
      badge: `Dr. ${(c as { doctor?: { full_name?: string } }).doctor?.full_name ?? ''}`,
      badgeColor: 'bg-violet-100 text-violet-700',
      icon: Stethoscope,
    })),
    ...(patientAppointments).map(a => ({
      date: a.scheduled_at, type: 'appointment' as const,
      title: `RDV — ${formatTime(a.scheduled_at)}`,
      subtitle: a.notes ?? undefined,
      badge: apptStatusLabels[a.status] ?? a.status,
      badgeColor: apptStatusColors[a.status] ?? '',
      icon: Calendar,
    })),
    ...(patientInvoices).map(inv => ({
      date: inv.created_at, type: 'invoice' as const,
      title: `${inv.invoice_number} — ${formatCurrency(Number(inv.total_amount))}`,
      subtitle: undefined,
      badge: invStatusLabels[inv.status] ?? inv.status,
      badgeColor: invStatusColors[inv.status] ?? '',
      icon: Receipt,
    })),
    ...(patientPrescriptions as unknown as Prescription[]).map(rx => ({
      date: rx.created_at, type: 'prescription' as const,
      title: `Ordonnance (${rx.medications.length} méd.)`,
      subtitle: rx.medications.map(m => m.name).join(', '),
      badge: rxStatusLabels[rx.status] ?? rx.status,
      badgeColor: rxStatusColors[rx.status] ?? '',
      icon: Pill,
    })),
    ...(labRequests ?? []).map(lab => ({
      date: lab.created_at, type: 'lab' as const,
      title: lab.test_name,
      subtitle: lab.result_notes ?? undefined,
      badge: labStatusLabels[lab.status] ?? lab.status,
      badgeColor: labStatusColors[lab.status] ?? '',
      icon: FlaskConical,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const tabs = [
    { id: 'history' as Tab, label: 'Dossier', icon: Stethoscope },
    { id: 'prescriptions' as Tab, label: 'Ordonnances', icon: Pill },
    { id: 'labs' as Tab, label: 'Analyses', icon: FlaskConical },
    { id: 'timeline' as Tab, label: 'Chronologie', icon: History },
  ]

  return (
    <div className="flex flex-col h-full">
      <Topbar title={patient.full_name} description={`Dossier ${patient.patient_number}`} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
        <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> Retour aux patients
        </Link>

        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {/* Left column — patient info */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserRound className="h-4 w-4" /> Identité
                  </CardTitle>
                  <Link href={`/patients?edit=${id}`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-3.5 w-3.5" /></Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-lg font-bold">
                    {patient.full_name[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{patient.full_name}</p>
                    <p className="text-xs font-mono text-blue-600">{patient.patient_number}</p>
                  </div>
                </div>
                <div className="space-y-2 pt-1">
                  {patient.date_of_birth && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatDate(patient.date_of_birth)} ({age(patient.date_of_birth)} ans)</span>
                    </div>
                  )}
                  {patient.gender && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <UserRound className="h-3.5 w-3.5 shrink-0" />
                      <span>{genderLabel[patient.gender]}</span>
                    </div>
                  )}
                  {patient.phone && (
                    <a href={`tel:${patient.phone}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                      <Phone className="h-3.5 w-3.5 shrink-0" /><span>{patient.phone}</span>
                    </a>
                  )}
                  {patient.email && (
                    <a href={`mailto:${patient.email}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                      <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{patient.email}</span>
                    </a>
                  )}
                  {patient.address && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{patient.address}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Droplets className="h-4 w-4" /> Informations médicales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {patient.blood_type && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Groupe sanguin</span>
                    <Badge variant="secondary" className="font-mono">{patient.blood_type}</Badge>
                  </div>
                )}
                {patient.allergies && patient.allergies.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-red-600 mb-1.5">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="font-medium text-xs">Allergies</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {patient.allergies.map(a => (
                        <span key={a} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 border border-red-200">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                {patient.notes && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <p className="text-gray-700 text-xs">{patient.notes}</p>
                  </div>
                )}
                {!patient.blood_type && (!patient.allergies || patient.allergies.length === 0) && !patient.notes && (
                  <p className="text-gray-400 text-xs">Aucune information médicale renseignée</p>
                )}
              </CardContent>
            </Card>

            {(patient.emergency_contact || patient.emergency_phone) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" /> Contact d&apos;urgence
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1.5">
                  {patient.emergency_contact && <p className="font-medium text-gray-900">{patient.emergency_contact}</p>}
                  {patient.emergency_phone && (
                    <a href={`tel:${patient.emergency_phone}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                      <Phone className="h-3.5 w-3.5" /> {patient.emergency_phone}
                    </a>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column — tabbed history */}
          <div className="lg:col-span-2 space-y-4">
            {/* Summary chips */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Consult.', value: consultations?.length ?? 0, color: 'bg-violet-50 text-violet-700' },
                { label: 'RDV', value: patientAppointments.length, color: 'bg-blue-50 text-blue-700' },
                { label: 'Factures', value: patientInvoices.length, color: 'bg-emerald-50 text-emerald-700' },
                { label: 'Ordonn.', value: patientPrescriptions.length, color: 'bg-amber-50 text-amber-700' },
                { label: 'Analyses', value: labRequests?.length ?? 0, color: 'bg-pink-50 text-pink-700' },
              ].map(s => (
                <div key={s.label} className={cn('rounded-xl p-2 md:p-3 text-center', s.color)}>
                  <div className="text-lg font-bold md:text-xl">{s.value}</div>
                  <div className="text-[10px] md:text-xs mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b">
              {tabs.map(tab => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Tab: Dossier */}
            {activeTab === 'history' && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Stethoscope className="h-4 w-4" /> Consultations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {!consultations || consultations.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">Aucune consultation</p>
                    ) : consultations.slice(0, 5).map(c => (
                      <div key={c.id} className="rounded-lg border p-3 space-y-1.5 hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">{formatDate(c.created_at)}</p>
                          {c.follow_up_date && (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <Clock className="h-3 w-3" /> Suivi: {formatDate(c.follow_up_date)}
                            </span>
                          )}
                        </div>
                        {c.chief_complaint && <p className="text-sm font-medium text-gray-800">{c.chief_complaint}</p>}
                        {c.diagnosis && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-700">Diagnostic:</span> {c.diagnosis}
                          </p>
                        )}
                        {c.treatment_plan && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-700">Traitement:</span> {c.treatment_plan}
                          </p>
                        )}
                        <p className="text-xs text-gray-400">Dr. {(c as { doctor?: { full_name?: string } }).doctor?.full_name ?? '—'}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Rendez-vous récents
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {patientAppointments.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">Aucun rendez-vous</p>
                    ) : patientAppointments.slice(0, 5).map(a => (
                      <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {formatDate(a.scheduled_at)} à {formatTime(a.scheduled_at)}
                          </p>
                          {a.notes && <p className="text-xs text-gray-500 mt-0.5">{a.notes}</p>}
                        </div>
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', apptStatusColors[a.status])}>
                          {apptStatusLabels[a.status]}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4" /> Factures
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {patientInvoices.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">Aucune facture</p>
                    ) : patientInvoices.slice(0, 5).map(inv => (
                      <div key={inv.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="text-sm font-mono font-medium text-blue-600">{inv.invoice_number}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{formatDate(inv.created_at)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{formatCurrency(Number(inv.total_amount))}</p>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', invStatusColors[inv.status])}>
                            {invStatusLabels[inv.status]}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tab: Ordonnances */}
            {activeTab === 'prescriptions' && (
              <Card>
                <CardContent className="p-0">
                  {patientPrescriptions.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Pill className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucune ordonnance</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {(patientPrescriptions as unknown as Prescription[]).map(rx => (
                        <div key={rx.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{formatDate(rx.created_at)}</span>
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', rxStatusColors[rx.status])}>
                              {rxStatusLabels[rx.status]}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {rx.medications.map((m, i) => (
                              <div key={i} className="rounded-md bg-gray-50 border px-2.5 py-1.5 text-xs">
                                <p className="font-medium">{m.name} {m.dosage}</p>
                                <p className="text-gray-500">{m.frequency} × {m.duration}</p>
                              </div>
                            ))}
                          </div>
                          {rx.valid_until && (
                            <p className="text-xs text-amber-600">Valable jusqu&apos;au {formatDate(rx.valid_until)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tab: Analyses */}
            {activeTab === 'labs' && (
              <Card>
                <CardContent className="p-0">
                  {!labRequests || labRequests.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <FlaskConical className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucune analyse demandée</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {(labRequests as unknown as LabRequest[]).map(lab => (
                        <div key={lab.id} className="p-4 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-gray-900">{lab.test_name}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', labStatusColors[lab.status])}>
                              {labStatusLabels[lab.status]}
                            </span>
                          </div>
                          <div className="flex gap-2 text-xs text-gray-500">
                            <span>{lab.test_type}</span>
                            {lab.priority !== 'normal' && (
                              <span className="text-amber-600 font-medium">⚠ {lab.priority}</span>
                            )}
                            <span>{formatDate(lab.created_at)}</span>
                          </div>
                          {lab.clinical_notes && <p className="text-xs text-gray-500 italic">{lab.clinical_notes}</p>}
                          {lab.result_notes && (
                            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2">
                              <p className="text-xs font-medium text-emerald-700 mb-0.5">Résultat:</p>
                              <p className="text-xs text-emerald-800">{lab.result_notes}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tab: Chronologie */}
            {activeTab === 'timeline' && (
              <div className="space-y-2">
                {timelineEvents.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <History className="mx-auto h-10 w-10 mb-3 opacity-30" />
                    <p>Aucun événement enregistré</p>
                  </div>
                ) : timelineEvents.map((event, idx) => {
                  const Icon = event.icon
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                          <Icon className="h-3.5 w-3.5 text-gray-600" />
                        </div>
                        {idx < timelineEvents.length - 1 && (
                          <div className="w-px flex-1 bg-gray-200 my-1" />
                        )}
                      </div>
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                          {event.badge && (
                            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium shrink-0', event.badgeColor)}>
                              {event.badge}
                            </span>
                          )}
                        </div>
                        {event.subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{event.subtitle}</p>}
                        <p className="text-xs text-gray-400 mt-1">{formatDate(event.date, { dateStyle: 'medium' })}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
