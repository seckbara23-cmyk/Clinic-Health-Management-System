'use client'

import { Loader2, AlertTriangle, CalendarClock } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLowStock, useNearExpiry } from '@/hooks/usePharmacy'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export default function PharmacyReportsPage() {
  const t = useTranslations('pharmacy')
  const { formatDate } = useFormatters()
  const { data: lowStock, isLoading: lowLoading } = useLowStock()
  const { data: nearExpiry, isLoading: expLoading } = useNearExpiry(90)

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('reportsTitle')} description={t('reportsSubtitle')} />
      <div className="flex-1 p-4 md:p-6 space-y-6">

        {/* Low stock */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> {t('lowStockTitle')}
              {!lowLoading && <span className="text-xs font-normal text-gray-400">({lowStock?.length ?? 0})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lowLoading ? <div className="flex items-center justify-center h-24"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
              : (lowStock?.length ?? 0) === 0 ? <p className="px-4 pb-4 text-sm text-gray-400">{t('lowStockEmpty')}</p>
              : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colMedication')}</TableHead>
                      <TableHead className="text-right">{t('colStock')}</TableHead>
                      <TableHead className="text-right">{t('colReorder')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStock!.map(line => (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.medication?.name ?? '—'}</TableCell>
                        <TableCell className="text-right font-semibold text-red-600">{line.stock_quantity}</TableCell>
                        <TableCell className="text-right text-gray-500">{line.reorder_level}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
          </CardContent>
        </Card>

        {/* Near expiry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-red-600" /> {t('nearExpiryTitle')}
              {!expLoading && <span className="text-xs font-normal text-gray-400">({nearExpiry?.length ?? 0})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {expLoading ? <div className="flex items-center justify-center h-24"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
              : (nearExpiry?.length ?? 0) === 0 ? <p className="px-4 pb-4 text-sm text-gray-400">{t('nearExpiryEmpty')}</p>
              : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colMedication')}</TableHead>
                      <TableHead>{t('colBatch')}</TableHead>
                      <TableHead className="text-right">{t('colRemaining')}</TableHead>
                      <TableHead>{t('colExpiry')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nearExpiry!.map(b => {
                      const expired = b.expiry_date != null && b.expiry_date <= today
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{b.inventory?.medication?.name ?? '—'}</TableCell>
                          <TableCell className="text-sm text-gray-500">{b.batch_number || '—'}</TableCell>
                          <TableCell className="text-right font-semibold">{b.quantity_remaining}</TableCell>
                          <TableCell className={cn('text-sm', expired ? 'text-red-700 font-semibold' : 'text-amber-700')}>
                            {b.expiry_date ? formatDate(b.expiry_date) : '—'}{expired ? ` · ${t('expired')}` : ''}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
