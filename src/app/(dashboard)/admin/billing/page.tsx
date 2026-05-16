'use client'

import { useQuery } from '@tanstack/react-query'
import { CreditCard, Loader2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { useClinic } from '@/context/ClinicContext'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

const paymentStatusVariant: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  paid:      'bg-emerald-100 text-emerald-700',
  failed:    'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
  refunded:  'bg-blue-100 text-blue-700',
}
const paymentStatusLabel: Record<string, string> = {
  pending:   'En attente',
  paid:      'Payé',
  failed:    'Échoué',
  cancelled: 'Annulé',
  refunded:  'Remboursé',
}

const invoiceStatusVariant: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  paid:      'bg-emerald-100 text-emerald-700',
  partial:   'bg-amber-100 text-amber-700',
  overdue:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
}
const invoiceStatusLabel: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée',
  partial: 'Partiel', overdue: 'En retard', cancelled: 'Annulée',
}

const providerLabel: Record<string, string> = {
  wave:         'Wave',
  orange_money: 'Orange Money',
  cash:         'Espèces',
  card:         'Carte',
  mobile_money: 'Mobile Money',
  insurance:    'Assurance',
  other:        'Autre',
}

interface AdminInvoice {
  id: string
  invoice_number: string
  total_amount: number
  amount_paid: number
  currency: string
  status: string
  payment_method: string | null
  payment_status: string | null
  payment_provider_reference: string | null
  created_at: string
  paid_at: string | null
  clinic: { name: string } | null
  patient: { full_name: string } | null
}

export default function AdminBillingPage() {
  const { profile } = useClinic()
  const supabase = createClient()

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['admin-invoices'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('invoices')
        .select(`
          id, invoice_number, total_amount, amount_paid, currency,
          status, payment_method, payment_status, payment_provider_reference,
          created_at, paid_at,
          clinic:clinic_id ( name ),
          patient:patient_id ( full_name )
        `)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as AdminInvoice[]
    },
  })

  const totalRevenue = invoices?.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total_amount), 0) ?? 0
  const totalOnline  = invoices?.filter(i => i.payment_method === 'wave' || i.payment_method === 'orange_money').length ?? 0
  const totalPending = invoices?.filter(i => i.payment_status === 'pending').length ?? 0

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Paiements" description="Vue globale des paiements — toutes cliniques" />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Factures totales', value: invoices?.length ?? 0, color: 'text-blue-700', bg: 'bg-blue-50' },
            { label: 'Revenu encaissé', value: formatCurrency(totalRevenue), color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Paiements en ligne', value: totalOnline, color: 'text-violet-700', bg: 'bg-violet-50' },
            { label: 'En attente', value: totalPending, color: 'text-amber-700', bg: 'bg-amber-50' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-xl p-3 md:p-4', s.bg)}>
              <p className="text-[10px] md:text-xs font-medium text-gray-500">{s.label}</p>
              <p className={cn('text-lg md:text-2xl font-bold mt-0.5', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Pilot notice */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Les paiements Wave et Orange Money ne sont pas encore actifs.
            Les colonnes <strong>payment_status</strong> et <strong>provider_ref</strong> seront renseignées après activation.
          </span>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            )}
            {!isLoading && (!invoices || invoices.length === 0) && (
              <EmptyState
                icon={CreditCard}
                title="Aucune facture"
                description="Les factures de toutes les cliniques apparaîtront ici."
              />
            )}
            {!isLoading && invoices && invoices.length > 0 && (
              <>
                {/* Mobile */}
                <div className="divide-y md:hidden">
                  {invoices.map(inv => (
                    <div key={inv.id} className="p-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-blue-600">{inv.invoice_number}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', invoiceStatusVariant[inv.status])}>
                          {invoiceStatusLabel[inv.status] ?? inv.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{inv.clinic?.name ?? '—'}</p>
                          <p className="text-xs text-gray-500">{inv.patient?.full_name ?? '—'}</p>
                        </div>
                        <p className="font-bold">{formatCurrency(Number(inv.total_amount))}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{providerLabel[inv.payment_method ?? ''] ?? inv.payment_method ?? '—'}</span>
                        {inv.payment_status && (
                          <span className={cn('rounded-full px-2 py-0.5 font-medium', paymentStatusVariant[inv.payment_status])}>
                            {paymentStatusLabel[inv.payment_status] ?? inv.payment_status}
                          </span>
                        )}
                      </div>
                      {inv.payment_provider_reference && (
                        <p className="font-mono text-[10px] text-gray-400 truncate">{inv.payment_provider_reference}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>N° Facture</TableHead>
                        <TableHead>Clinique</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Statut facture</TableHead>
                        <TableHead>Statut paiement</TableHead>
                        <TableHead>Réf. fournisseur</TableHead>
                        <TableHead>Créé le</TableHead>
                        <TableHead>Payé le</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map(inv => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs text-blue-600 whitespace-nowrap">{inv.invoice_number}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap">{inv.clinic?.name ?? '—'}</TableCell>
                          <TableCell className="text-sm text-gray-700 whitespace-nowrap">{inv.patient?.full_name ?? '—'}</TableCell>
                          <TableCell className="font-semibold whitespace-nowrap">{formatCurrency(Number(inv.total_amount))}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {providerLabel[inv.payment_method ?? ''] ?? inv.payment_method ?? '—'}
                          </TableCell>
                          <TableCell>
                            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', invoiceStatusVariant[inv.status])}>
                              {invoiceStatusLabel[inv.status] ?? inv.status}
                            </span>
                          </TableCell>
                          <TableCell>
                            {inv.payment_status ? (
                              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', paymentStatusVariant[inv.payment_status])}>
                                {paymentStatusLabel[inv.payment_status] ?? inv.payment_status}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-gray-400 max-w-[160px] truncate">
                            {inv.payment_provider_reference ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500 whitespace-nowrap">{formatDate(inv.created_at)}</TableCell>
                          <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                            {inv.paid_at ? formatDate(inv.paid_at) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
