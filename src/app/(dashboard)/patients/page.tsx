'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Search, Plus, UserRound, Phone, Calendar, Trash2, Pencil, ExternalLink, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PatientRowSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePatients, useCreatePatient, useUpdatePatient, useDeletePatient, usePatientDeletionCounts } from '@/hooks/usePatients'
import { formatDate, age } from '@/lib/utils'
import type { Gender, BloodType } from '@/types/database'
import { useTranslations } from 'next-intl'

export default function PatientsPage() {
  const t = useTranslations('patients')

  const patientSchema = z.object({
    full_name: z.string().min(2, t('zodNameRequired')),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().or(z.literal('')).nullable(),
    date_of_birth: z.string().optional().nullable(),
    gender: z.enum(['male', 'female', 'other']).optional().nullable(),
    blood_type: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    emergency_contact: z.string().optional().nullable(),
    emergency_phone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  type PatientFormData = z.infer<typeof patientSchema>

  const genderLabel: Record<string, string> = {
    male: t('genderMale'),
    female: t('genderFemale'),
    other: t('genderOther'),
  }

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [deletePatientId, setDeletePatientId] = useState<string | null>(null)
  const [deletePatientName, setDeletePatientName] = useState<string>('')

  useEffect(() => { setPage(0) }, [search])

  const openCreate = useCallback(() => { setEditId(null); reset(); setOpen(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('fab:create-patient', openCreate)
    return () => window.removeEventListener('fab:create-patient', openCreate)
  }, [openCreate])

  const { data: result, isLoading, isError, refetch } = usePatients(search, page)
  const patients = result?.data
  const totalPatients = result?.total ?? 0
  const totalPages = Math.ceil(totalPatients / 25)
  const createMutation = useCreatePatient()
  const updateMutation = useUpdatePatient()
  const deleteMutation = useDeletePatient()
  const { data: deletionCounts, isLoading: countsLoading } = usePatientDeletionCounts(deletePatientId)

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
  })

  function openEdit(p: NonNullable<typeof patients>[0]) {
    setEditId(p.id)
    reset({
      full_name: p.full_name,
      phone: p.phone,
      email: p.email,
      date_of_birth: p.date_of_birth,
      gender: p.gender as Gender,
      blood_type: p.blood_type,
      address: p.address,
      emergency_contact: p.emergency_contact,
      emergency_phone: p.emergency_phone,
      notes: p.notes,
    })
    setOpen(true)
  }

  async function onSubmit(data: PatientFormData) {
    if (editId) {
      await updateMutation.mutateAsync({ id: editId, ...data, blood_type: (data.blood_type ?? null) as BloodType | null })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await createMutation.mutateAsync(data as any)
    }
    setOpen(false)
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('newPatient')}</span>
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isLoading ? t('loading') : t('count', { count: totalPatients })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="divide-y">
                {Array.from({ length: 8 }).map((_, i) => <PatientRowSkeleton key={i} />)}
              </div>
            )}
            {isError && (
              <EmptyState
                icon={UserRound}
                title={t('errorTitle')}
                description={t('errorDesc')}
                action={{ label: t('retry'), onClick: () => refetch() }}
              />
            )}
            {!isLoading && !isError && (!patients || patients.length === 0) && (
              <EmptyState
                icon={UserRound}
                title={search ? t('noResults') : t('emptyTitle')}
                description={search ? t('noResultsDesc', { query: search }) : t('emptyDesc')}
                action={!search ? { label: t('newPatient'), onClick: openCreate } : undefined}
              />
            )}

            {/* Mobile card list */}
            <div className="divide-y md:hidden">
              {patients?.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-700 text-sm">
                    {p.full_name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{p.full_name}</p>
                      <span className="shrink-0 font-mono text-xs text-blue-600">{p.patient_number}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                      {p.phone && (
                        <a href={`tel:${p.phone}`} className="flex items-center gap-1 hover:text-blue-600">
                          <Phone className="h-3 w-3" />{p.phone}
                        </a>
                      )}
                      {p.date_of_birth && <span>{age(p.date_of_birth)} {t('ageUnit')}</span>}
                      {p.gender && <span>{genderLabel[p.gender]}</span>}
                      {p.blood_type && <span className="font-mono font-semibold text-red-700">{p.blood_type}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Link href={`/patients/${p.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colNumber')}</TableHead>
                    <TableHead>{t('colName')}</TableHead>
                    <TableHead>{t('colPhone')}</TableHead>
                    <TableHead>{t('colAgeGender')}</TableHead>
                    <TableHead>{t('colBloodType')}</TableHead>
                    <TableHead>{t('colRegistered')}</TableHead>
                    <TableHead className="text-right">{t('colActions')}</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs text-blue-600">{p.patient_number}</TableCell>
                      <TableCell className="font-medium">{p.full_name}</TableCell>
                      <TableCell>
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600">
                            <Phone className="h-3 w-3" /> {p.phone}
                          </a>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {p.date_of_birth && <span className="text-sm">{age(p.date_of_birth)} {t('ageUnit')}</span>}
                          {p.gender && <Badge variant="outline" className="text-xs">{genderLabel[p.gender]}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.blood_type ? (
                          <Badge variant="secondary" className="font-mono">{p.blood_type}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(p.created_at)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => { setDeletePatientId(p.id); setDeletePatientName(p.full_name) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/patients/${p.id}`} className="text-gray-400 hover:text-blue-600">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {!isLoading && !isError && totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <Button
                  variant="outline" size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> {t('prevPage')}
                </Button>
                <span className="text-xs text-gray-500">
                  {t('pageInfo', { page: page + 1, total: totalPages, count: totalPatients })}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  {t('nextPage')} <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletePatientId} onOpenChange={open => { if (!open) setDeletePatientId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> {t('deleteTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p>
              {t('deleteConfirm', { name: deletePatientName })}
            </p>
            {countsLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('deletionLoading')}
              </div>
            ) : deletionCounts && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                <p className="font-medium text-red-700 mb-2">{t('deletionDataTitle')}</p>
                {[
                  { label: t('deletionAppointments'), count: deletionCounts.appointments },
                  { label: t('deletionConsultations'), count: deletionCounts.consultations },
                  { label: t('deletionPrescriptions'), count: deletionCounts.prescriptions },
                  { label: t('deletionLab'),           count: deletionCounts.lab_requests },
                  { label: t('deletionInvoices'),      count: deletionCounts.invoices },
                ].map(({ label, count }) => (
                  <div key={label} className="flex justify-between text-red-800">
                    <span>{label}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePatientId(null)}>{t('cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || countsLoading}
              onClick={() => {
                if (!deletePatientId) return
                deleteMutation.mutate(deletePatientId, { onSuccess: () => setDeletePatientId(null) })
              }}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              {t('deleteConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? t('editTitle') : t('createTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>{t('labelFullName')}</Label>
                <Input {...register('full_name')} />
                {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelPhone')}</Label>
                <Input {...register('phone')} placeholder="+221 77 000 0000" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelEmail')}</Label>
                <Input type="email" {...register('email')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelDOB')}</Label>
                <Input type="date" {...register('date_of_birth')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelGender')}</Label>
                <Select onValueChange={v => setValue('gender', v as Gender)}>
                  <SelectTrigger><SelectValue placeholder={t('selectPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">{t('genderMale')}</SelectItem>
                    <SelectItem value="female">{t('genderFemale')}</SelectItem>
                    <SelectItem value="other">{t('genderOther')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelBloodType')}</Label>
                <Select onValueChange={v => setValue('blood_type', v as BloodType)}>
                  <SelectTrigger><SelectValue placeholder={t('labelBloodType')} /></SelectTrigger>
                  <SelectContent>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => (
                      <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>{t('labelAddress')}</Label>
                <Input {...register('address')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelEmergencyContact')}</Label>
                <Input {...register('emergency_contact')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelEmergencyPhone')}</Label>
                <Input {...register('emergency_phone')} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>{t('labelNotes')}</Label>
                <Input {...register('notes')} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                {editId ? t('save') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
