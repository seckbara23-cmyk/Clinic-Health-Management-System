'use client'

import Link from 'next/link'
import { Stethoscope, Clock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SuspendedPage() {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

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

        <div className="rounded-xl border bg-white p-8 shadow-sm space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-7 w-7 text-amber-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Compte en attente</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              Votre compte est actuellement inactif ou en attente d&apos;approbation.
              Vous serez notifié(e) dès qu&apos;un administrateur aura validé votre accès.
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 text-left space-y-1">
            <p className="font-medium">Que faire ?</p>
            <ul className="list-disc list-inside space-y-1 text-amber-700">
              <li>Contactez votre administrateur CHMS</li>
              <li>Vérifiez votre boîte mail pour une confirmation</li>
              <li>Revenez vérifier l&apos;accès dans quelques instants</li>
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
      </div>
    </div>
  )
}
