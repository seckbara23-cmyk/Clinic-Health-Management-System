'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, Shield, CheckCircle2, XCircle, Clock, Copy,
  ExternalLink, AlertCircle, Inbox, MapPin, Mail, Phone,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ClinicRequest } from '@/types/database'

type Filter = 'all' | 'pending' | 'approved' | 'rejected'

const statusConfig: Record<string, { label: string; variant: string; dot: string; icon: React.ElementType }> = {
  pending:  { label: 'En attente', variant: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400',   icon: Clock },
  approved: { label: 'Approuvée',  variant: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', icon: CheckCircle2 },
  rejected: { label: 'Rejetée',   variant: 'bg-red-100 text-red-700',         dot: 'bg-red-400',     icon: XCircle },
}

export default function ClinicRequestsPage() {
  const { profile } = useClinic()
  const [filter, setFilter] = useState<Filter>('pending')
  const [rejectTarget, setRejectTarget] = useState<ClinicRequest | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [setupLink, setSetupLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()
  const supabase = createClient()

  const { data: requests, isLoading } = useQuery({
    queryKey: ['clinic-requests'],
    enabled: profile?.role === 'super_admin',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinic_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ClinicRequest[]
    },
  })

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/clinic-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur')
      return json as { ok: boolean; setupLink: string | null }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['clinic-requests'] })
      toast.success('Demande approuvée')
      setSetupLink(data.setupLink)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/admin/clinic-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erreur')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-requests'] })
      toast.success('Demande rejetée')
      setRejectTarget(null)
      setRejectionReason('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function copyLink() {
    if (!setupLink) return
    await navigator.clipboard.writeText(setupLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (profile?.role !== 'super_admin') {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Demandes cliniques" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
          <Shield className="h-12 w-12 opacity-30" />
          <p>Accès réservé aux super administrateurs</p>
        </div>
      </div>
    )
  }

  const filtered = filter === 'all' ? requests : requests?.filter(r => r.status === filter)
  const counts = {
    all:      requests?.length ?? 0,
    pending:  requests?.filter(r => r.status === 'pending').length ?? 0,
    approved: requests?.filter(r => r.status === 'approved').length ?? 0,
    rejected: requests?.filter(r => r.status === 'rejected').length ?? 0,
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Demandes d'inscription" description="Cliniques en attente d'approbation" />

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Filter tabs */}
        <div className="flex gap-2">
          {(['pending', 'all', 'approved', 'rejected'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f
                  ? 'bg-teal-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {f === 'all' ? 'Toutes' : statusConfig[f].label}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                filter === f ? 'bg-white/20 text-white' : 'bg-white text-gray-700'
              )}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {!isLoading && filtered?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Inbox className="h-10 w-10 opacity-30" />
            <p className="text-sm">Aucune demande {filter !== 'all' ? `"${statusConfig[filter]?.label.toLowerCase()}"` : ''}</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered?.map(req => {
            const sc = statusConfig[req.status] ?? statusConfig.pending
            const StatusIcon = sc.icon
            return (
              <Card key={req.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white font-bold text-sm shrink-0">
                      {req.clinic_name[0]}
                    </div>
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', sc.variant)}>
                      <StatusIcon className="h-3 w-3" />
                      {sc.label}
                    </span>
                  </div>

                  {/* Clinic info */}
                  <div>
                    <h3 className="font-semibold text-gray-900">{req.clinic_name}</h3>
                    <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                      <MapPin className="h-3.5 w-3.5" />
                      {req.location}
                    </div>
                  </div>

                  {/* Admin info */}
                  <div className="border-t pt-3 space-y-1">
                    <p className="text-xs font-medium text-gray-500">Responsable</p>
                    <p className="text-sm text-gray-800">{req.admin_full_name}</p>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Mail className="h-3 w-3" />
                      {req.admin_email}
                    </div>
                    {req.phone && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Phone className="h-3 w-3" />
                        {req.phone}
                      </div>
                    )}
                  </div>

                  {/* Message */}
                  {req.message && (
                    <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2 line-clamp-3">
                      {req.message}
                    </p>
                  )}

                  {/* Rejection reason */}
                  {req.status === 'rejected' && req.rejection_reason && (
                    <p className="text-xs text-red-600 bg-red-50 rounded p-2">
                      Motif : {req.rejection_reason}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="border-t pt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {formatDate(req.created_at)}
                    </span>
                    {req.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline" size="sm"
                          className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => { setRejectTarget(req); setRejectionReason('') }}
                        >
                          <XCircle className="h-3 w-3" /> Rejeter
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => approveMutation.mutate(req.id)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <CheckCircle2 className="h-3 w-3" />
                          }
                          Approuver
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeter la demande</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Vous allez rejeter la demande de <strong>{rejectTarget?.clinic_name}</strong>.
            </p>
            <div className="space-y-1.5">
              <Label>Motif du rejet (optionnel)</Label>
              <Input
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Ex: Informations incomplètes, email invalide..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Annuler</Button>
            <Button
              variant="destructive"
              onClick={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectionReason })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending && <Loader2 className="animate-spin" />}
              Confirmer le rejet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Setup link dialog — shown once after approval */}
      <Dialog open={!!setupLink} onOpenChange={(o) => { if (!o) setSetupLink(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Demande approuvée</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-800 font-medium">Clinique et compte admin créés avec succès.</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                Lien de configuration (valide 1h)
              </p>
              <div className="flex gap-2">
                <Input value={setupLink ?? ''} readOnly className="text-xs font-mono bg-gray-50" />
                <Button variant="outline" size="icon" onClick={copyLink} title="Copier">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-amber-700 flex gap-1.5 items-start">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Ce lien ne s&apos;affichera qu&apos;une seule fois. Partagez-le avec l&apos;administrateur de la clinique.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSetupLink(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
