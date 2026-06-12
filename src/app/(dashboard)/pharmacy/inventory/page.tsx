'use client'

import { useState } from 'react'
import { Plus, Loader2, Package, Pencil, Boxes, History } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  useInventory, useUpsertInventory, useBatches, useReceiveStock, useAdjustStock, useStockMovements,
} from '@/hooks/usePharmacy'
import { useMedications } from '@/hooks/useMedications'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { ClinicMedicationInventory, CatalogMedication, StockMovementType } from '@/types/database'

export default function InventoryPage() {
  const t = useTranslations('pharmacy')
  const { formatCurrency } = useFormatters()
  const { profile } = useClinic()
  const canManage = ['admin', 'pharmacist', 'super_admin'].includes(profile?.role ?? '')

  const [editOpen, setEditOpen] = useState(false)
  const [editLine, setEditLine] = useState<ClinicMedicationInventory | null>(null)
  const [batchTarget, setBatchTarget] = useState<ClinicMedicationInventory | null>(null)
  const [movementsTarget, setMovementsTarget] = useState<ClinicMedicationInventory | null>(null)

  const { data: inventory, isLoading } = useInventory(true)

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('inventoryTitle')} description={t('inventorySubtitle')} />
      <div className="flex-1 p-4 md:p-6 space-y-4">
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={() => { setEditLine(null); setEditOpen(true) }}>
              <Plus className="h-4 w-4" /> {t('addItem')}
            </Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading && <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
            {!isLoading && (!inventory || inventory.length === 0) && (
              <EmptyState icon={Package} title={t('inventoryEmptyTitle')} description={t('inventoryEmptyDesc')} />
            )}
            {!isLoading && inventory && inventory.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colMedication')}</TableHead>
                      <TableHead className="text-right">{t('colStock')}</TableHead>
                      <TableHead className="text-right">{t('colReorder')}</TableHead>
                      <TableHead className="text-right">{t('colSellingPrice')}</TableHead>
                      <TableHead>{t('colSupplier')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead className="text-right">{t('colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map(line => {
                      const low = line.stock_quantity <= line.reorder_level
                      return (
                        <TableRow key={line.id} className={line.is_active ? undefined : 'opacity-60'}>
                          <TableCell className="font-medium">
                            {line.medication?.name ?? '—'}
                            {line.medication?.dosage_form && <span className="ml-2 text-xs text-gray-400">{line.medication.dosage_form}</span>}
                          </TableCell>
                          <TableCell className={cn('text-right font-semibold', low && 'text-red-600')}>{line.stock_quantity}</TableCell>
                          <TableCell className="text-right text-gray-500">{line.reorder_level}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(line.selling_price))}</TableCell>
                          <TableCell className="text-sm text-gray-500">{line.supplier ?? '—'}</TableCell>
                          <TableCell>
                            {line.is_active
                              ? <Badge variant="secondary" className="text-emerald-700">{t('active')}</Badge>
                              : <Badge variant="outline" className="text-gray-500">{t('inactive')}</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title={t('manageBatches')} onClick={() => setBatchTarget(line)}>
                                <Boxes className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title={t('movements')} onClick={() => setMovementsTarget(line)}>
                                <History className="h-3.5 w-3.5" />
                              </Button>
                              {canManage && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditLine(line); setEditOpen(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
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

      {editOpen && <InventoryEditDialog line={editLine} existing={inventory ?? []} onClose={() => setEditOpen(false)} />}
      {batchTarget && <BatchDialog line={batchTarget} canManage={canManage} onClose={() => setBatchTarget(null)} />}
      {movementsTarget && <MovementsDialog line={movementsTarget} onClose={() => setMovementsTarget(null)} />}
    </div>
  )
}

// ─── Inventory add/edit ─────────────────────────────────────────
function InventoryEditDialog({ line, existing, onClose }: { line: ClinicMedicationInventory | null; existing: ClinicMedicationInventory[]; onClose: () => void }) {
  const t = useTranslations('pharmacy')
  const upsert = useUpsertInventory()
  const [medication, setMedication] = useState<{ id: string; name: string } | null>(line?.medication ? { id: line.medication.id, name: line.medication.name } : null)
  const [medQuery, setMedQuery] = useState(line?.medication?.name ?? '')
  const [medOpen, setMedOpen] = useState(false)
  const { data: medResults } = useMedications(medQuery)
  const [reorder, setReorder] = useState(String(line?.reorder_level ?? 0))
  const [selling, setSelling] = useState(String(line?.selling_price ?? 0))
  const [purchase, setPurchase] = useState(String(line?.purchase_price ?? 0))
  const [supplier, setSupplier] = useState(line?.supplier ?? '')
  const [active, setActive] = useState(line?.is_active ?? true)

  const alreadyInInventory = (id: string) => existing.some(l => l.medication_id === id && l.id !== line?.id)

  async function save() {
    if (!line && !medication) return
    await upsert.mutateAsync({
      id: line?.id,
      medication_id: medication?.id ?? line!.medication_id,
      reorder_level: Number(reorder) || 0,
      selling_price: Number(selling) || 0,
      purchase_price: Number(purchase) || 0,
      supplier: supplier || null,
      is_active: active,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{line ? t('editItemTitle') : t('addItemTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!line && (
            <div className="space-y-1.5">
              <Label>{t('labelMedication')}</Label>
              <div className="relative">
                <Input value={medQuery} placeholder={t('searchMedication')} autoComplete="off"
                  onChange={e => { setMedQuery(e.target.value); setMedication(null); setMedOpen(true) }}
                  onFocus={() => setMedOpen(true)} onBlur={() => setTimeout(() => setMedOpen(false), 150)} />
                {medOpen && medQuery.trim().length >= 2 && (medResults?.length ?? 0) > 0 && (
                  <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-white shadow-lg">
                    {medResults!.map((m: CatalogMedication) => {
                      const dup = alreadyInInventory(m.id)
                      return (
                        <button key={m.id} type="button" disabled={dup}
                          className={cn('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm', dup ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50')}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { if (!dup) { setMedication({ id: m.id, name: m.name }); setMedQuery(m.name); setMedOpen(false) } }}>
                          <span className="truncate">{m.name}</span>
                          {dup ? <span className="shrink-0 text-xs text-amber-600">{t('alreadyAdded')}</span>
                               : m.dosage_form && <span className="shrink-0 text-xs text-gray-400">{m.dosage_form}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          {line && <p className="text-sm font-medium">{line.medication?.name}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t('labelSellingPrice')}</Label><Input type="number" min={0} value={selling} onChange={e => setSelling(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t('labelPurchasePrice')}</Label><Input type="number" min={0} value={purchase} onChange={e => setPurchase(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t('labelReorder')}</Label><Input type="number" min={0} value={reorder} onChange={e => setReorder(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t('labelSupplier')}</Label><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" checked={active} onChange={e => setActive(e.target.checked)} />
            {t('labelActive')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={save} disabled={upsert.isPending || (!line && !medication)}>
            {upsert.isPending && <Loader2 className="animate-spin" />}{t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Batches ────────────────────────────────────────────────────
function BatchDialog({ line, canManage, onClose }: { line: ClinicMedicationInventory; canManage: boolean; onClose: () => void }) {
  const t = useTranslations('pharmacy')
  const { formatDate } = useFormatters()
  const { data: batches, isLoading } = useBatches(line.id)
  const receive = useReceiveStock()
  const adjust = useAdjustStock()

  const [batchNo, setBatchNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState('')
  const [purchase, setPurchase] = useState('')
  const [adjustId, setAdjustId] = useState<string | null>(null)
  const [adjType, setAdjType] = useState<Exclude<StockMovementType, 'received' | 'dispensed'>>('adjustment')
  const [adjQty, setAdjQty] = useState('')
  const [adjNotes, setAdjNotes] = useState('')

  async function doReceive() {
    if (!qty || Number(qty) <= 0) return
    await receive.mutateAsync({ inventory_id: line.id, batch_number: batchNo || null, expiry_date: expiry || null, quantity: Number(qty), purchase_price: purchase ? Number(purchase) : null })
    setBatchNo(''); setExpiry(''); setQty(''); setPurchase('')
  }
  async function doAdjust() {
    if (!adjustId || !adjQty) return
    // expired/damaged reduce stock (negative); returned adds; adjustment as entered.
    const signed = adjType === 'returned' ? Math.abs(Number(adjQty)) : adjType === 'adjustment' ? Number(adjQty) : -Math.abs(Number(adjQty))
    await adjust.mutateAsync({ batch_id: adjustId, movement_type: adjType, quantity_change: signed, notes: adjNotes || null })
    setAdjustId(null); setAdjQty(''); setAdjNotes('')
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('batchesTitle', { name: line.medication?.name ?? '' })}</DialogTitle></DialogHeader>

        {canManage && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('receiveStock')}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input placeholder={t('batchNumber')} value={batchNo} onChange={e => setBatchNo(e.target.value)} className="h-8 text-sm" />
              <Input type="date" title={t('expiryDate')} value={expiry} onChange={e => setExpiry(e.target.value)} className="h-8 text-sm" />
              <Input type="number" min={1} placeholder={t('quantity')} value={qty} onChange={e => setQty(e.target.value)} className="h-8 text-sm" />
              <Input type="number" min={0} placeholder={t('purchasePrice')} value={purchase} onChange={e => setPurchase(e.target.value)} className="h-8 text-sm" />
            </div>
            <Button size="sm" onClick={doReceive} disabled={receive.isPending || !qty}>
              {receive.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t('btnReceive')}
            </Button>
          </div>
        )}

        {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /> : (
          <div className="rounded-lg border divide-y">
            {(batches ?? []).length === 0 && <p className="p-3 text-sm text-gray-400">{t('noBatches')}</p>}
            {(batches ?? []).map(b => (
              <div key={b.id} className="p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{b.batch_number || t('noBatchNumber')}</span>
                    {b.expiry_date && <span className="ml-2 text-xs text-gray-500">{t('expiresOn', { date: formatDate(b.expiry_date) })}</span>}
                  </div>
                  <span className="font-semibold">{b.quantity_remaining} / {b.quantity_received}</span>
                </div>
                {canManage && (
                  adjustId === b.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={adjType} onValueChange={v => setAdjType(v as typeof adjType)}>
                        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="adjustment">{t('moveAdjustment')}</SelectItem>
                          <SelectItem value="expired">{t('moveExpired')}</SelectItem>
                          <SelectItem value="damaged">{t('moveDamaged')}</SelectItem>
                          <SelectItem value="returned">{t('moveReturned')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input type="number" placeholder={t('quantity')} value={adjQty} onChange={e => setAdjQty(e.target.value)} className="h-8 w-24 text-xs" />
                      <Input placeholder={t('notes')} value={adjNotes} onChange={e => setAdjNotes(e.target.value)} className="h-8 flex-1 text-xs" />
                      <Button size="sm" className="h-8" onClick={doAdjust} disabled={adjust.isPending || !adjQty}>{t('apply')}</Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdjustId(null)}>{t('cancel')}</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setAdjustId(b.id); setAdjQty(''); setAdjNotes('') }}>{t('adjust')}</Button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Movements ledger ───────────────────────────────────────────
function MovementsDialog({ line, onClose }: { line: ClinicMedicationInventory; onClose: () => void }) {
  const t = useTranslations('pharmacy')
  const { formatDate } = useFormatters()
  const { data: movements, isLoading } = useStockMovements(line.id)
  const typeLabels: Record<string, string> = {
    received: t('moveReceived'), dispensed: t('moveDispensed'), adjustment: t('moveAdjustment'),
    expired: t('moveExpired'), damaged: t('moveDamaged'), returned: t('moveReturned'),
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('movementsTitle', { name: line.medication?.name ?? '' })}</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /> : (
          <div className="divide-y text-sm">
            {(movements ?? []).length === 0 && <p className="py-6 text-center text-gray-400">{t('noMovements')}</p>}
            {(movements ?? []).map(m => (
              <div key={m.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-medium">{typeLabels[m.movement_type] ?? m.movement_type}</span>
                  {m.notes && <span className="ml-2 text-xs text-gray-400">{m.notes}</span>}
                  <span className="block text-xs text-gray-400">{formatDate(m.created_at)}</span>
                </div>
                <span className={cn('font-semibold', m.quantity_change >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                  {m.quantity_change >= 0 ? '+' : ''}{m.quantity_change}
                </span>
              </div>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
