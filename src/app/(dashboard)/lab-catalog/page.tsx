'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, TestTube, Pencil } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLabTests, useUpsertLabTest } from '@/hooks/useLab'
import { usePermissions } from '@/hooks/usePermissions'
import { useFormatters } from '@/hooks/useFormatters'
import { useTranslations } from 'next-intl'
import type { LabTest } from '@/types/database'

export default function LabCatalogPage() {
  const t = useTranslations('labCatalog')
  const { formatCurrency } = useFormatters()
  const { can } = usePermissions()
  // Phase 41: page access via Enterprise Authorization (maps 1:1 to laboratory.catalog).
  const isAdmin = can('laboratory.catalog')

  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const schema = z.object({
    name: z.string().min(1, t('zodNameRequired')),
    category: z.string().optional().nullable(),
    sample_type: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    normal_range_low: z.number().optional().nullable(),
    normal_range_high: z.number().optional().nullable(),
    normal_range_text: z.string().optional().nullable(),
    price: z.number().min(0).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  type FormData = z.infer<typeof schema>

  const { data: tests, isLoading } = useLabTests(true)
  const upsert = useUpsertLabTest()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  function openCreate() {
    setEditId(null)
    reset({ name: '', is_active: true, price: 0 })
    setOpen(true)
  }
  function openEdit(test: LabTest) {
    setEditId(test.id)
    reset({
      name: test.name,
      category: test.category,
      sample_type: test.sample_type,
      unit: test.unit,
      normal_range_low: test.normal_range_low,
      normal_range_high: test.normal_range_high,
      normal_range_text: test.normal_range_text,
      price: Number(test.price),
      is_active: test.is_active,
    })
    setOpen(true)
  }

  async function onSubmit(data: FormData) {
    await upsert.mutateAsync({ id: editId ?? undefined, ...data })
    setOpen(false)
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t('title')} />
        <EmptyState icon={TestTube} title={t('title')} description={t('noAccess')} />
      </div>
    )
  }

  const numField = (name: 'normal_range_low' | 'normal_range_high' | 'price') =>
    register(name, { setValueAs: v => (v === '' || v == null ? null : Number(v)) })

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />
      <div className="flex-1 p-4 md:p-6 space-y-4">
        <div className="flex justify-end">
          <Button onClick={openCreate}><Plus className="h-4 w-4" /> {t('newTest')}</Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            )}
            {!isLoading && (!tests || tests.length === 0) && (
              <EmptyState icon={TestTube} title={t('emptyTitle')} description={t('emptyDesc')} action={{ label: t('newTest'), onClick: openCreate }} />
            )}
            {!isLoading && tests && tests.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colName')}</TableHead>
                      <TableHead>{t('colCategory')}</TableHead>
                      <TableHead>{t('colSample')}</TableHead>
                      <TableHead>{t('colRange')}</TableHead>
                      <TableHead>{t('colUnit')}</TableHead>
                      <TableHead className="text-right">{t('colPrice')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead className="text-right">{t('colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tests.map(test => {
                      const range = test.normal_range_text
                        ?? (test.normal_range_low != null && test.normal_range_high != null
                          ? `${test.normal_range_low} – ${test.normal_range_high}` : '—')
                      return (
                        <TableRow key={test.id} className={test.is_active ? undefined : 'opacity-60'}>
                          <TableCell className="font-medium">{test.name}</TableCell>
                          <TableCell className="text-sm text-gray-500">{test.category ?? '—'}</TableCell>
                          <TableCell className="text-sm text-gray-500">{test.sample_type ?? '—'}</TableCell>
                          <TableCell className="text-sm text-gray-500">{range}</TableCell>
                          <TableCell className="text-sm text-gray-500">{test.unit ?? '—'}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(test.price))}</TableCell>
                          <TableCell>
                            {test.is_active
                              ? <Badge variant="secondary" className="text-emerald-700">{t('active')}</Badge>
                              : <Badge variant="outline" className="text-gray-500">{t('inactive')}</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(test)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editId ? t('editTitle') : t('createTitle')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>{t('labelName')}</Label>
                <Input {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelCategory')}</Label>
                <Input {...register('category')} placeholder={t('categoryPlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelSample')}</Label>
                <Input {...register('sample_type')} placeholder={t('samplePlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelUnit')}</Label>
                <Input {...register('unit')} placeholder="mg/dL" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelPrice')}</Label>
                <Input type="number" min={0} {...numField('price')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelRangeLow')}</Label>
                <Input type="number" step="any" {...numField('normal_range_low')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelRangeHigh')}</Label>
                <Input type="number" step="any" {...numField('normal_range_high')} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>{t('labelRangeText')}</Label>
                <Input {...register('normal_range_text')} placeholder={t('rangeTextPlaceholder')} />
              </div>
              <label className="col-span-2 flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" {...register('is_active')} />
                <span className="text-sm font-medium">{t('labelActive')}</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={isSubmitting || upsert.isPending}>
                {(isSubmitting || upsert.isPending) && <Loader2 className="animate-spin" />}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
