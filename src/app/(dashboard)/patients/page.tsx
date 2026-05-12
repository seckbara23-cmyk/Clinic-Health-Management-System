'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Search, Plus, Loader2, UserRound, Phone, Calendar, Trash2, Pencil, ExternalLink } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePatients, useCreatePatient, useUpdatePatient, useDeletePatient } from '@/hooks/usePatients'
import { formatDate, age } from '@/lib/utils'
import type { Gender, BloodType } from '@/types/database'

const patientSchema = z.object({
  full_name: z.string().min(2, 'Nom requis'),
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

const genderLabel: Record<string, string> = { male: 'Homme', female: 'Femme', other: 'Autre' }

export default function PatientsPage() {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const { data: patients, isLoading } = usePatients(search)
  const createMutation = useCreatePatient()
  const updateMutation = useUpdatePatient()
  const deleteMutation = useDeletePatient()

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
  })

  function openCreate() {
    setEditId(null)
    reset()
    setOpen(true)
  }

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
      <Topbar title="Patients" description="Gérez les dossiers patients de votre clinique" />

      <div className="flex-1 p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Rechercher par nom, numéro, téléphone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nouveau patient
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isLoading ? 'Chargement...' : `${patients?.length ?? 0} patient(s)`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Âge / Genre</TableHead>
                  <TableHead>Groupe sanguin</TableHead>
                  <TableHead>Enregistré le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (!patients || patients.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-gray-400">
                      <UserRound className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucun patient trouvé</p>
                    </TableCell>
                  </TableRow>
                )}
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
                        {p.date_of_birth && (
                          <span className="text-sm">{age(p.date_of_birth)} ans</span>
                        )}
                        {p.gender && (
                          <Badge variant="outline" className="text-xs">{genderLabel[p.gender]}</Badge>
                        )}
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
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (confirm('Supprimer ce patient?')) deleteMutation.mutate(p.id) }}
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
          </CardContent>
        </Card>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Modifier le patient' : 'Nouveau patient'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Nom complet *</Label>
                <Input {...register('full_name')} />
                {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Téléphone</Label>
                <Input {...register('phone')} placeholder="+221 77 000 0000" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" {...register('email')} />
              </div>
              <div className="space-y-1.5">
                <Label>Date de naissance</Label>
                <Input type="date" {...register('date_of_birth')} />
              </div>
              <div className="space-y-1.5">
                <Label>Genre</Label>
                <Select onValueChange={v => setValue('gender', v as Gender)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Homme</SelectItem>
                    <SelectItem value="female">Femme</SelectItem>
                    <SelectItem value="other">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Groupe sanguin</Label>
                <Select onValueChange={v => setValue('blood_type', v as BloodType)}>
                  <SelectTrigger><SelectValue placeholder="Groupe" /></SelectTrigger>
                  <SelectContent>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => (
                      <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Adresse</Label>
                <Input {...register('address')} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact d&apos;urgence</Label>
                <Input {...register('emergency_contact')} />
              </div>
              <div className="space-y-1.5">
                <Label>Téléphone urgence</Label>
                <Input {...register('emergency_phone')} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Input {...register('notes')} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                {editId ? 'Enregistrer' : 'Créer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
