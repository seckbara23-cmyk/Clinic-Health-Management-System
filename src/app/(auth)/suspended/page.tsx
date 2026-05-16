'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Stethoscope, Clock, Mail, Ban, Archive, AlertTriangle, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Reason = 'suspended' | 'archived' | 'inactive' | 'pending' | 'unknown'

const reasonConfig: Record<Reason, {
  icon: React.ElementType
  iconBg: string
  iconColor: string
  title: string
  description: string
  tips: string[]
}> = {
  suspended: {
    icon: ShieldOff,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    title: 'Clinique suspendue',
    description: 'L\'accès à votre clinique a été temporairement suspendu par un administrateur. Vos données sont conservées.',
    tips: [
      'Contactez l\'administrateur CHMS pour connaître la raison',
      'La suspension peut être levée après résolution du problème',
      'Vos données restent intactes',
    ],
  },
  archived: {
    icon: Archive,
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
    title: 'Compte archivé',
    description: 'Ce compte n\'est plus actif. L\'accès à cette clinique a été définitivement désactivé.',
    tips: [
      'Contactez le support si vous pensez que c\'est une erreur',
      'Les données historiques sont conservées à des fins légales',
    ],
  },
  inactive: {
    icon: Ban,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
    title: 'Compte inactif',
    description: 'Votre compte a été désactivé. Contactez votre administrateur de clinique pour réactiver votre accès.',
    tips: [
      'Contactez l\'administrateur de votre clinique',
      'Vérifiez votre boîte mail pour un éventuel avis',
    ],
  },
  pending: {
    icon: Clock,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    title: 'En attente de validation',
    description: 'Votre clinique est en attente d\'approbation par un super administrateur CHMS. Vous serez notifié(e) par email.',
    tips: [
      'La validation prend généralement 24 à 48 heures',
      'Vérifiez votre boîte mail pour toute mise à jour',
      'Contactez le support si vous attendez depuis plus de 48h',
    ],
  },
  unknown: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    title: 'Accès restreint',
    description: 'Votre compte est actuellement inactif ou en attente d\'approbation. Vous serez notifié(e) dès qu\'un administrateur aura validé votre accès.',
    tips: [
      'Contactez votre administrateur CHMS',
      'Vérifiez votre boîte mail pour une confirmation',
      'Revenez vérifier l\'accès dans quelques instants',
    ],
  },
}

function SuspendedContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const raw = searchParams.get('reason') ?? 'unknown'
  const reason: Reason = raw in reasonConfig ? (raw as Reason) : 'unknown'
  const config = reasonConfig[reason]
  const Icon = config.icon

  const tipBg = reason === 'archived' ? 'bg-gray-50 border-gray-200 text-gray-700'
    : reason === 'suspended' ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-800'
  const tipTextColor = reason === 'archived' ? 'text-gray-600'
    : reason === 'suspended' ? 'text-red-700'
    : 'text-amber-700'

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="rounded-xl border bg-white p-8 shadow-sm space-y-4">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${config.iconBg}`}>
        <Icon className={`h-7 w-7 ${config.iconColor}`} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{config.title}</h2>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">{config.description}</p>
      </div>
      <div className={`rounded-lg border p-4 text-sm text-left space-y-1 ${tipBg}`}>
        <p className="font-medium">Que faire ?</p>
        <ul className={`list-disc list-inside space-y-1 ${tipTextColor}`}>
          {config.tips.map(tip => <li key={tip}>{tip}</li>)}
        </ul>
      </div>
      <div className="flex flex-col gap-2 pt-2">
        <Button variant="outline" className="gap-2 w-full" asChild>
          <Link href="mailto:support@chms.sn">
            <Mail className="h-4 w-4" /> Contacter le support
          </Link>
        </Button>
        <Button variant="ghost" className="w-full text-gray-500" onClick={handleSignOut}>
          Se déconnecter
        </Button>
      </div>
    </div>
  )
}

export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-100 p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-700 shadow-lg">
            <Stethoscope className="h-8 w-8 text-white" />
          </div>
          <div aria-hidden="true" className="mx-auto mb-4 flex h-1 w-20 overflow-hidden rounded-full">
            <div className="flex-1 bg-[#009E60]" />
            <div className="flex-1 bg-[#FDEF42]" />
            <div className="flex-1 bg-[#E31B23]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CHMS Sénégal</h1>
        </div>
        <Suspense fallback={
          <div className="rounded-xl border bg-white p-8 shadow-sm flex items-center justify-center">
            <Clock className="h-6 w-6 animate-pulse text-gray-400" />
          </div>
        }>
          <SuspendedContent />
        </Suspense>
      </div>
    </div>
  )
}
