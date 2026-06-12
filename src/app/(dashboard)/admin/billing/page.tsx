'use client'

import { CreditCard, Loader2, AlertCircle, ShieldCheck } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { useClinic } from '@/context/ClinicContext'
import { usePlatformBillingSummary } from '@/hooks/useCompliance'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

// Super-admin billing oversight is AGGREGATE-ONLY. Per the compliance model,
// super_admin must never see patient names, invoice rows, or any clinic PII —
// this page shows per-clinic totals from get_platform_billing_summary() and
// nothing more.
export default function AdminBillingPage() {
  const t = useTranslations('adminBilling')
  const { formatCurrency } = useFormatters()
  const { profile } = useClinic()

  const { data: rows, isLoading } = usePlatformBillingSummary(profile?.role === 'super_admin')

  const totalInvoiced  = rows?.reduce((s, r) => s + Number(r.total_invoiced), 0) ?? 0
  const totalCollected = rows?.reduce((s, r) => s + Number(r.total_collected), 0) ?? 0
  const totalInvoices  = rows?.reduce((s, r) => s + Number(r.invoice_count), 0) ?? 0
  const totalPending   = rows?.reduce((s, r) => s + Number(r.pending_count), 0) ?? 0

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('statInvoices'),  value: totalInvoices,                  color: 'text-blue-700',    bg: 'bg-blue-50' },
            { label: t('statInvoiced'),  value: formatCurrency(totalInvoiced),  color: 'text-violet-700',  bg: 'bg-violet-50' },
            { label: t('statRevenue'),   value: formatCurrency(totalCollected), color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: t('statPending'),   value: totalPending,                   color: 'text-amber-700',   bg: 'bg-amber-50' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-xl p-3 md:p-4', s.bg)}>
              <p className="text-[10px] md:text-xs font-medium text-gray-500">{s.label}</p>
              <p className={cn('text-lg md:text-2xl font-bold mt-0.5', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Privacy notice */}
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{t('aggregateNotice')}</span>
        </div>

        {/* Pilot notice */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>{t('pilotNotice')}</span>
        </div>

        {/* Per-clinic aggregate table */}
        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            )}
            {!isLoading && (!rows || rows.length === 0) && (
              <EmptyState icon={CreditCard} title={t('emptyTitle')} description={t('emptyDesc')} />
            )}
            {!isLoading && rows && rows.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colClinic')}</TableHead>
                      <TableHead className="text-right">{t('colInvoiceCount')}</TableHead>
                      <TableHead className="text-right">{t('colInvoiced')}</TableHead>
                      <TableHead className="text-right">{t('colCollected')}</TableHead>
                      <TableHead className="text-right">{t('colPending')}</TableHead>
                      <TableHead className="text-right">{t('colOnline')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.clinic_id}>
                        <TableCell className="font-medium whitespace-nowrap">{r.clinic_name}</TableCell>
                        <TableCell className="text-right">{Number(r.invoice_count)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{formatCurrency(Number(r.total_invoiced))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-emerald-700">{formatCurrency(Number(r.total_collected))}</TableCell>
                        <TableCell className="text-right">{Number(r.pending_count)}</TableCell>
                        <TableCell className="text-right">{Number(r.online_count)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
