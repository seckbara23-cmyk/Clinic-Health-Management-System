'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Wrench, Users, CheckCircle2, ChevronRight,
  Plus, Trash2, Loader2, Mail, ArrowRight, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClinic } from '@/context/ClinicContext'
import { useClinicServices, useCreateClinicService, useDeleteClinicService } from '@/hooks/useClinicServices'
import { formatCurrency, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Role } from '@/types/database'

// ── Step metadata ────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Profil',   icon: Building2, title: 'Profil de votre clinique',    desc: 'Complétez les informations de base de votre établissement.' },
  { id: 2, label: 'Services', icon: Wrench,    title: 'Services et tarifs',           desc: 'Listez vos prestations avec leurs prix pour faciliter la facturation.' },
  { id: 3, label: 'Équipe',   icon: Users,     title: 'Invitez votre équipe',         desc: 'Ajoutez médecins, infirmiers et réceptionnistes à votre espace.' },
  { id: 4, label: 'Terminer', icon: CheckCircle2, title: 'Votre clinique est prête !', desc: 'Tout est en place. Vous pouvez commencer à utiliser CHMS.' },
]

const SUGGESTED_SERVICES = [
  { name: 'Consultation générale',     price: 5000,  duration_min: 20, category: 'Consultation' },
  { name: 'Consultation spécialisée',  price: 10000, duration_min: 30, category: 'Consultation' },
  { name: 'Prise de tension',          price: 1000,  duration_min: 5,  category: 'Soins' },
  { name: 'Pansement simple',          price: 2000,  duration_min: 15, category: 'Soins' },
  { name: 'Injection / Perfusion',     price: 3000,  duration_min: 30, category: 'Soins' },
  { name: 'Certificat médical',        price: 5000,  duration_min: 10, category: 'Administratif' },
  { name: 'Suture',                    price: 8000,  duration_min: 20, category: 'Urgences' },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur', doctor: 'Médecin',
  receptionist: 'Réceptionniste', nurse: 'Infirmier(e)', cashier: 'Caissier(e)',
}

export default function OnboardingPage() {
  const router = useRouter()
  const { clinic, profile, refetch } = useClinic()
  const supabase = createClient()

  // Persist step in DB; fall back to local state for optimistic UI
  const [step, setStep] = useState<number>(clinic?.onboarding_step ?? 1)

  useEffect(() => {
    if (clinic?.onboarding_step) setStep(clinic.onboarding_step)
  }, [clinic?.onboarding_step])

  // Only admins can see onboarding
  if (profile && profile.role !== 'admin' && profile.role !== 'super_admin') {
    router.replace('/dashboard')
    return null
  }

  // Already completed
  if (clinic?.onboarding_completed_at) {
    router.replace('/dashboard')
    return null
  }

  async function goToStep(next: number) {
    if (!clinic) return
    setStep(next)
    await supabase
      .from('clinics')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ onboarding_step: next } as any)
      .eq('id', clinic.id)
    refetch()
  }

  async function completeOnboarding() {
    if (!clinic) return
    await supabase
      .from('clinics')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 4 } as any)
      .eq('id', clinic.id)
    refetch()
    toast.success('Configuration terminée. Bienvenue !')
    router.push('/dashboard')
  }

  const currentStep = STEPS[step - 1] ?? STEPS[0]
  const StepIcon = currentStep.icon

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Configuration initiale" description="Quelques étapes pour démarrer" />

      <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24">
        {/* Progress header */}
        <div className="max-w-2xl mx-auto mb-8">
          {/* Step pills */}
          <div className="flex items-center gap-2 mb-6">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const done = step > s.id
              const active = step === s.id
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    onClick={() => step > s.id && goToStep(s.id)}
                    disabled={step <= s.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      done   ? 'bg-teal-700 text-white cursor-pointer hover:bg-teal-800' :
                      active ? 'bg-teal-100 text-teal-800 ring-1 ring-teal-400' :
                               'bg-gray-100 text-gray-400 cursor-not-allowed'
                    )}
                  >
                    {done
                      ? <CheckCircle2 className="h-3.5 w-3.5" />
                      : <Icon className="h-3.5 w-3.5" />
                    }
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('h-px w-4 md:w-8', step > s.id ? 'bg-teal-400' : 'bg-gray-200')} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Step title */}
          <div className="flex items-center gap-3 mb-2">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl shrink-0',
              step === 4 ? 'bg-emerald-100' : 'bg-teal-100'
            )}>
              <StepIcon className={cn('h-5 w-5', step === 4 ? 'text-emerald-700' : 'text-teal-700')} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{currentStep.title}</h2>
              <p className="text-sm text-gray-500">{currentStep.desc}</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 mt-4">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-500"
              style={{ width: `${(step / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="max-w-2xl mx-auto">
          {step === 1 && <StepProfile clinic={clinic} supabase={supabase} refetch={refetch} onNext={() => goToStep(2)} />}
          {step === 2 && <StepServices onNext={() => goToStep(3)} />}
          {step === 3 && <StepTeam clinic={clinic} profile={profile} supabase={supabase} onNext={() => goToStep(4)} />}
          {step === 4 && <StepFinish onComplete={completeOnboarding} onGoToPatients={() => { void completeOnboarding() }} />}
        </div>
      </div>

      {/* Sticky skip */}
      {step < 4 && (
        <div className="shrink-0 border-t bg-white px-4 py-3 flex justify-center">
          <button
            onClick={completeOnboarding}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Passer la configuration et aller au tableau de bord
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step 1: Clinic profile ──────────────────────────────────────
function StepProfile({
  clinic, supabase, refetch, onNext,
}: {
  clinic: ReturnType<typeof useClinic>['clinic']
  supabase: ReturnType<typeof createClient>
  refetch: () => void
  onNext: () => void
}) {
  const [name,     setName]     = useState(clinic?.name     ?? '')
  const [location, setLocation] = useState(clinic?.location ?? '')
  const [phone,    setPhone]    = useState(clinic?.phone    ?? '')
  const [email,    setEmail]    = useState(clinic?.email    ?? '')
  const [saving,   setSaving]   = useState(false)

  async function save() {
    if (!clinic || !name.trim() || !location.trim()) {
      toast.error('Nom et localisation sont requis')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('clinics')
      .update({ name: name.trim(), location: location.trim(), phone: phone || null, email: email || null })
      .eq('id', clinic.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    refetch()
    toast.success('Profil mis à jour')
    onNext()
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1.5">
          <Label>Nom de la clinique *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Clinique Sainte Marie" />
        </div>
        <div className="space-y-1.5">
          <Label>Ville / Localisation *</Label>
          <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Dakar, Plateau" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Téléphone</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+221 77 000 00 00" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@clinique.sn" />
          </div>
        </div>
        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          Enregistrer et continuer
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Step 2: Services & pricing ──────────────────────────────────
function StepServices({ onNext }: { onNext: () => void }) {
  const { data: services } = useClinicServices()
  const createService = useCreateClinicService()
  const deleteService = useDeleteClinicService()

  const [name,        setName]        = useState('')
  const [price,       setPrice]       = useState('')
  const [duration,    setDuration]    = useState('')
  const [category,    setCategory]    = useState('')
  const [showForm,    setShowForm]    = useState(false)
  const [adding,      setAdding]      = useState<string | null>(null)

  async function addCustom() {
    if (!name.trim()) { toast.error('Nom du service requis'); return }
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) { toast.error('Prix invalide'); return }
    await createService.mutateAsync({
      name: name.trim(),
      price: p,
      duration_min: duration ? parseInt(duration) : null,
      category: category || null,
    })
    setName(''); setPrice(''); setDuration(''); setCategory(''); setShowForm(false)
    toast.success('Service ajouté')
  }

  async function addSuggestion(s: typeof SUGGESTED_SERVICES[0]) {
    setAdding(s.name)
    await createService.mutateAsync(s)
    setAdding(null)
  }

  const existingNames = new Set(services?.map(s => s.name) ?? [])

  return (
    <div className="space-y-4">
      {/* Existing services */}
      {services && services.length > 0 && (
        <Card>
          <CardContent className="p-0 divide-y">
            {services.map(svc => (
              <div key={svc.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{svc.name}</p>
                  <p className="text-xs text-gray-400">
                    {formatCurrency(svc.price, svc.currency)}
                    {svc.duration_min ? ` · ${svc.duration_min} min` : ''}
                    {svc.category ? ` · ${svc.category}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => deleteService.mutate(svc.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Suggestions */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Services suggérés</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_SERVICES.filter(s => !existingNames.has(s.name)).map(s => (
            <button
              key={s.name}
              onClick={() => addSuggestion(s)}
              disabled={adding === s.name || createService.isPending}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-teal-400 hover:text-teal-700 transition-colors disabled:opacity-50"
            >
              {adding === s.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {s.name} — {formatCurrency(s.price, 'XOF')}
            </button>
          ))}
        </div>
      </div>

      {/* Custom service form */}
      {showForm ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Nouveau service</p>
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-gray-400" /></button>
            </div>
            <div className="space-y-1.5">
              <Label>Nom *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Échographie abdominale" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Prix (XOF) *</Label>
                <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="5000" />
              </div>
              <div className="space-y-1.5">
                <Label>Durée (min)</Label>
                <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="30" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Catégorie</Label>
              <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Consultation, Soins, Urgences…" />
            </div>
            <Button className="w-full" onClick={addCustom} disabled={createService.isPending}>
              {createService.isPending && <Loader2 className="animate-spin" />}
              Ajouter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-teal-300 hover:text-teal-600 transition-colors"
        >
          <Plus className="h-4 w-4" /> Ajouter un service personnalisé
        </button>
      )}

      <Button
        className="w-full"
        onClick={onNext}
        variant={services && services.length > 0 ? 'default' : 'outline'}
      >
        {services && services.length > 0 ? (
          <><ChevronRight className="h-4 w-4" /> Continuer</>
        ) : (
          'Passer cette étape'
        )}
      </Button>
    </div>
  )
}

// ── Step 3: Invite team ─────────────────────────────────────────
function StepTeam({
  clinic, profile, supabase, onNext,
}: {
  clinic: ReturnType<typeof useClinic>['clinic']
  profile: ReturnType<typeof useClinic>['profile']
  supabase: ReturnType<typeof createClient>
  onNext: () => void
}) {
  const [email, setEmail] = useState('')
  const [role,  setRole]  = useState<Role>('doctor')
  const [inviting, setInviting] = useState(false)
  const [sent, setSent] = useState<{ email: string; role: string }[]>([])

  async function sendInvite() {
    if (!email.trim() || !clinic) return
    const emailTrimmed = email.trim().toLowerCase()
    setInviting(true)
    const { error } = await supabase
      .from('clinic_invitations')
      .insert({ email: emailTrimmed, role, clinic_id: clinic.id, invited_by: profile?.id ?? null })
    setInviting(false)
    if (error) { toast.error(error.message); return }
    setSent(prev => [...prev, { email: emailTrimmed, role }])
    setEmail('')
    toast.success(`Invitation envoyée à ${emailTrimmed}`)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Email du collaborateur</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="medecin@clinique.sn"
              onKeyDown={e => { if (e.key === 'Enter') sendInvite() }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rôle</Label>
            <Select value={role} onValueChange={v => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            onClick={sendInvite}
            disabled={inviting || !email.trim()}
          >
            {inviting ? <Loader2 className="animate-spin" /> : <Mail className="h-4 w-4" />}
            Envoyer l&apos;invitation
          </Button>
        </CardContent>
      </Card>

      {/* Sent invitations */}
      {sent.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Invitations envoyées</p>
            <div className="space-y-2">
              {sent.map((inv, i) => (
                <div key={i} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-sm text-gray-700">{inv.email}</span>
                  <span className="ml-auto text-xs text-gray-400">{ROLE_LABELS[inv.role] ?? inv.role}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        className="w-full"
        onClick={onNext}
        variant={sent.length > 0 ? 'default' : 'outline'}
      >
        {sent.length > 0 ? (
          <><ChevronRight className="h-4 w-4" /> Continuer</>
        ) : (
          'Passer cette étape'
        )}
      </Button>
    </div>
  )
}

// ── Step 4: Finish ──────────────────────────────────────────────
function StepFinish({
  onComplete, onGoToPatients,
}: {
  onComplete: () => void
  onGoToPatients: () => void
}) {
  const [completing, setCompleting] = useState(false)

  return (
    <Card>
      <CardContent className="p-8 text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">Votre clinique est prête !</h3>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
            Profil, services et équipe configurés. Vous pouvez maintenant commencer à enregistrer des patients et gérer vos consultations.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="w-full"
            onClick={() => { setCompleting(true); void onGoToPatients() }}
            disabled={completing}
          >
            {completing ? <Loader2 className="animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Créer le premier patient
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { setCompleting(true); void onComplete() }}
            disabled={completing}
          >
            Aller au tableau de bord
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
