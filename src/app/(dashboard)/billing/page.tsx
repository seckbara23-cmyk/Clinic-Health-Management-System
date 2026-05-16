'use client'

import { useState, useEffect, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Receipt, Trash2, CheckCircle2, Eye, Printer, Download } from 'lucide-react'
import { InvoiceRowSkeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useInvoices, useCreateInvoice, useUpdateInvoice } from '@/hooks/useInvoices'
import { usePatients } from '@/hooks/usePatients'
import { useClinic } from '@/context/ClinicContext'
import { openInvoicePDF } from '@/lib/pdf'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { Invoice, InvoiceStatus, PaymentMethod } from '@/types/database'

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(1),
  unit_price: z.number().min(0),
  total: z.number(),
})

const invoiceSchema = z.object({
  patient_id: z.string().min(1, 'Patient requis'),
  line_items: z.array(lineItemSchema).min(1, 'Au moins un article requis'),
  discount_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
})
type InvoiceFormData = z.infer<typeof invoiceSchema>

const partialSchema = z.object({
  amount: z.number().min(1, 'Montant requis'),
  payment_method: z.string().min(1, 'Mode de paiement requis'),
})
type PartialForm = z.infer<typeof partialSchema>

const statusVariant: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
}
const statusLabel: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée',
  partial: 'Partiel', overdue: 'En retard', cancelled: 'Annulée',
}

export default function BillingPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null)
  const [partialInvoice, setPartialInvoice] = useState<Invoice | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')

  // FAB listener
  const openCreate = useCallback(() => { reset(); setCreateOpen(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('fab:create-invoice', openCreate)
    return () => window.removeEventListener('fab:create-invoice', openCreate)
  }, [openCreate])

  const { clinic } = useClinic()
  const { data: invoices, isLoading } = useInvoices(statusFilter || undefined)
  const { data: patientsResult } = usePatients()
  const patients = patientsResult?.data
  const createMutation = useCreateInvoice()
  const updateMutation = useUpdateInvoice()

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors, isSubmitting } } = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      line_items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
      discount_amount: 0,
      tax_amount: 0,
    },
  })

  const partialForm = useForm<PartialForm>({ resolver: zodResolver(partialSchema) })

  const { fields, append, remove } = useFieldArray({ control, name: 'line_items' })
  const watchItems = watch('line_items')
  const watchDiscount = watch('discount_amount') ?? 0
  const watchTax = watch('tax_amount') ?? 0

  const subtotal = watchItems?.reduce((s, i) => s + (Number(i.quantity) * Number(i.unit_price)), 0) ?? 0
  const total = subtotal - Number(watchDiscount) + Number(watchTax)

  async function onSubmit(data: InvoiceFormData) {
    const items = data.line_items.map(i => ({
      ...i,
      total: Number(i.quantity) * Number(i.unit_price),
    }))
    await createMutation.mutateAsync({
      patient_id: data.patient_id,
      consultation_id: null,
      line_items: items,
      subtotal,
      tax_amount: Number(data.tax_amount ?? 0),
      discount_amount: Number(data.discount_amount ?? 0),
      total_amount: total,
      amount_paid: 0,
      currency: 'XOF',
      status: 'draft',
      payment_method: (data.payment_method as PaymentMethod) ?? null,
      due_date: data.due_date ?? null,
      paid_at: null,
      notes: data.notes ?? null,
    })
    setCreateOpen(false)
    reset()
  }

  async function markPaid(inv: Invoice) {
    await updateMutation.mutateAsync({
      id: inv.id,
      status: 'paid',
      amount_paid: Number(inv.total_amount),
      paid_at: new Date().toISOString(),
    })
  }

  async function onPartialPayment(data: PartialForm) {
    if (!partialInvoice) return
    const newPaid = Number(partialInvoice.amount_paid) + data.amount
    const remaining = Number(partialInvoice.total_amount) - newPaid
    const newStatus: InvoiceStatus = remaining <= 0 ? 'paid' : 'partial'
    await updateMutation.mutateAsync({
      id: partialInvoice.id,
      status: newStatus,
      amount_paid: Math.min(newPaid, Number(partialInvoice.total_amount)),
      paid_at: newStatus === 'paid' ? new Date().toISOString() : null,
      payment_method: data.payment_method as PaymentMethod,
    })
    setPartialInvoice(null)
    partialForm.reset()
  }

  const totalRevenue = invoices?.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total_amount), 0) ?? 0
  const totalPending = invoices?.filter(i => ['draft', 'sent', 'partial'].includes(i.status)).reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0) ?? 0

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Facturation" description="Gérez les factures et paiements" />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          {[
            { label: 'Encaissé', value: formatCurrency(totalRevenue), color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'En attente', value: formatCurrency(totalPending), color: 'text-amber-700', bg: 'bg-amber-50' },
            { label: 'Factures', value: invoices?.length ?? 0, color: 'text-blue-700', bg: 'bg-blue-50' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-xl p-3 md:p-4', s.bg)}>
              <p className="text-[10px] md:text-xs font-medium text-gray-500">{s.label}</p>
              <p className={cn('text-lg md:text-xl font-bold mt-0.5', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 md:w-40">
              <SelectValue placeholder="Tous" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              {Object.entries(statusLabel).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="ml-auto shrink-0" onClick={() => { reset(); setCreateOpen(true) }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nouvelle facture</span>
          </Button>
        </div>

        {/* Invoice list */}
        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="divide-y md:hidden">
                {Array.from({ length: 4 }).map((_, i) => <InvoiceRowSkeleton key={i} />)}
              </div>
            )}
            {!isLoading && (!invoices || invoices.length === 0) && (
              <EmptyState
                icon={Receipt}
                title="Aucune facture"
                description={statusFilter ? 'Aucune facture avec ce statut.' : 'Créez votre première facture.'}
                action={!statusFilter ? { label: 'Nouvelle facture', onClick: openCreate } : undefined}
              />
            )}

            {/* Mobile card list */}
            <div className="divide-y md:hidden">
              {invoices?.map(inv => {
                const patientName = (inv as { patient?: { full_name?: string } }).patient?.full_name ?? '—'
                const unpaid = inv.status !== 'paid' && inv.status !== 'cancelled'
                return (
                  <div key={inv.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-blue-600">{inv.invoice_number}</span>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusVariant[inv.status])}>
                        {statusLabel[inv.status]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="font-medium truncate mr-2">{patientName}</p>
                      <p className="shrink-0 font-bold">{formatCurrency(Number(inv.total_amount))}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{formatDate(inv.created_at)}</span>
                      {Number(inv.amount_paid) > 0 && (
                        <span className="text-emerald-600">Payé: {formatCurrency(Number(inv.amount_paid))}</span>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="flex-1 h-9 text-xs"
                        onClick={() => setReceiptInvoice(inv)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> Voir
                      </Button>
                      {unpaid && (
                        <>
                          <Button size="sm" variant="outline" className="flex-1 h-9 text-xs text-amber-600 hover:bg-amber-50"
                            onClick={() => { setPartialInvoice(inv); partialForm.reset() }}>
                            Partiel
                          </Button>
                          <Button size="sm" className="flex-1 h-9 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => markPaid(inv)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Payée
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° Facture</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Payé</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices?.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs text-blue-600">{inv.invoice_number}</TableCell>
                      <TableCell className="font-medium">
                        {(inv as { patient?: { full_name?: string } }).patient?.full_name ?? '—'}
                      </TableCell>
                      <TableCell className="font-semibold">{formatCurrency(Number(inv.total_amount))}</TableCell>
                      <TableCell>{formatCurrency(Number(inv.amount_paid))}</TableCell>
                      <TableCell>
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusVariant[inv.status])}>
                          {statusLabel[inv.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">{formatDate(inv.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                            onClick={() => setReceiptInvoice(inv)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                            <>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs text-amber-600 hover:bg-amber-50"
                                onClick={() => { setPartialInvoice(inv); partialForm.reset() }}>
                                Paiement partiel
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs text-emerald-600 hover:bg-emerald-50"
                                onClick={() => markPaid(inv)}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Payée
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create Invoice Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Nouvelle facture</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Patient *</Label>
                <Select onValueChange={v => setValue('patient_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    {patients?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.patient_id && <p className="text-xs text-red-500">{errors.patient_id.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Mode de paiement</Label>
                <Select onValueChange={v => setValue('payment_method', v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Espèces</SelectItem>
                    <SelectItem value="card">Carte bancaire</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="insurance">Assurance</SelectItem>
                    <SelectItem value="other">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Articles</Label>
                <Button type="button" size="sm" variant="outline"
                  onClick={() => append({ description: '', quantity: 1, unit_price: 0, total: 0 })}>
                  <Plus className="h-3 w-3" /> Ajouter
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {fields.map((field, idx) => (
                  <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Input placeholder="Description" {...register(`line_items.${idx}.description`)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <Input type="number" placeholder="Qté"
                        {...register(`line_items.${idx}.quantity`, { valueAsNumber: true })} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-3">
                      <Input type="number" placeholder="Prix unit."
                        {...register(`line_items.${idx}.unit_price`, { valueAsNumber: true })} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1 text-sm text-right text-gray-500">
                      {formatCurrency((watchItems?.[idx]?.quantity ?? 1) * (watchItems?.[idx]?.unit_price ?? 0))}
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => remove(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="rounded-lg border p-3 space-y-1.5 text-sm bg-gray-50">
              <div className="flex justify-between">
                <span className="text-gray-500">Sous-total</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Remise</span>
                <Input type="number" {...register('discount_amount', { valueAsNumber: true })} className="h-7 w-28 text-sm text-right" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Taxes</span>
                <Input type="number" {...register('tax_amount', { valueAsNumber: true })} className="h-7 w-28 text-sm text-right" />
              </div>
              <div className="flex justify-between border-t pt-1.5 font-bold text-base">
                <span>Total</span>
                <span className="text-blue-700">{formatCurrency(total)}</span>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Créer la facture
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt dialog */}
      {receiptInvoice && (
        <Dialog open onOpenChange={() => setReceiptInvoice(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" /> Reçu — {receiptInvoice.invoice_number}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Clinique</span>
                <span className="font-medium text-gray-900">{clinic?.name}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Patient</span>
                <span className="font-medium text-gray-900">
                  {(receiptInvoice as { patient?: { full_name?: string } }).patient?.full_name ?? '—'}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Date</span>
                <span>{formatDate(receiptInvoice.created_at)}</span>
              </div>
              <hr />
              {(receiptInvoice.line_items as Array<{ description: string; quantity: number; unit_price: number; total: number }>).map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span>{item.description} × {item.quantity}</span>
                  <span className="font-medium">{formatCurrency(item.quantity * item.unit_price)}</span>
                </div>
              ))}
              <hr />
              {Number(receiptInvoice.discount_amount) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Remise</span>
                  <span>- {formatCurrency(Number(receiptInvoice.discount_amount))}</span>
                </div>
              )}
              {Number(receiptInvoice.tax_amount) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Taxes</span>
                  <span>{formatCurrency(Number(receiptInvoice.tax_amount))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold border-t pt-2">
                <span>Total</span>
                <span className="text-blue-700">{formatCurrency(Number(receiptInvoice.total_amount))}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Payé</span>
                <span className="text-emerald-600 font-medium">{formatCurrency(Number(receiptInvoice.amount_paid))}</span>
              </div>
              {Number(receiptInvoice.total_amount) - Number(receiptInvoice.amount_paid) > 0 && (
                <div className="flex justify-between text-red-600 font-medium">
                  <span>Reste à payer</span>
                  <span>{formatCurrency(Number(receiptInvoice.total_amount) - Number(receiptInvoice.amount_paid))}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>Statut</span>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusVariant[receiptInvoice.status])}>
                  {statusLabel[receiptInvoice.status]}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiptInvoice(null)}>Fermer</Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
              {clinic && (
                <Button onClick={() => openInvoicePDF(receiptInvoice, clinic)}>
                  <Download className="h-4 w-4" /> PDF
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Partial payment dialog */}
      {partialInvoice && (
        <Dialog open onOpenChange={() => setPartialInvoice(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Paiement partiel — {partialInvoice.invoice_number}</DialogTitle>
            </DialogHeader>
            <form onSubmit={partialForm.handleSubmit(onPartialPayment)} className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-semibold">{formatCurrency(Number(partialInvoice.total_amount))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Déjà payé</span>
                  <span className="text-emerald-600">{formatCurrency(Number(partialInvoice.amount_paid))}</span>
                </div>
                <div className="flex justify-between font-medium border-t pt-1">
                  <span>Reste</span>
                  <span className="text-red-600">
                    {formatCurrency(Number(partialInvoice.total_amount) - Number(partialInvoice.amount_paid))}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Montant reçu *</Label>
                <Input
                  type="number"
                  placeholder="0"
                  max={Number(partialInvoice.total_amount) - Number(partialInvoice.amount_paid)}
                  {...partialForm.register('amount', { valueAsNumber: true })}
                />
                {partialForm.formState.errors.amount && (
                  <p className="text-xs text-red-500">{partialForm.formState.errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Mode de paiement *</Label>
                <Select onValueChange={v => partialForm.setValue('payment_method', v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Espèces</SelectItem>
                    <SelectItem value="card">Carte bancaire</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="insurance">Assurance</SelectItem>
                    <SelectItem value="other">Autre</SelectItem>
                  </SelectContent>
                </Select>
                {partialForm.formState.errors.payment_method && (
                  <p className="text-xs text-red-500">{partialForm.formState.errors.payment_method.message}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPartialInvoice(null)}>Annuler</Button>
                <Button type="submit" disabled={partialForm.formState.isSubmitting || updateMutation.isPending}>
                  {(partialForm.formState.isSubmitting || updateMutation.isPending) && <Loader2 className="animate-spin" />}
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
