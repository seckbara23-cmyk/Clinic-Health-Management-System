'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, CalendarDays, Receipt,
  Settings, LogOut, Stethoscope, ShieldCheck,
  Building2, ChevronRight, ClipboardList, Pill, FlaskConical, BarChart2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useClinic } from '@/context/ClinicContext'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import type { Role } from '@/types/database'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  roles?: Role[]
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  {
    href: '/queue', label: 'Salle d\'attente', icon: ClipboardList,
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'],
  },
  {
    href: '/appointments', label: 'Rendez-vous', icon: CalendarDays,
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'],
  },
  {
    href: '/consultations', label: 'Consultations', icon: Stethoscope,
    roles: ['super_admin', 'admin', 'doctor', 'nurse'],
  },
  {
    href: '/prescriptions', label: 'Ordonnances', icon: Pill,
    roles: ['super_admin', 'admin', 'doctor', 'nurse'],
  },
  {
    href: '/lab-requests', label: 'Analyses', icon: FlaskConical,
    roles: ['super_admin', 'admin', 'doctor', 'nurse'],
  },
  {
    href: '/billing', label: 'Facturation', icon: Receipt,
    roles: ['super_admin', 'admin', 'receptionist', 'cashier', 'doctor'],
  },
  {
    href: '/analytics', label: 'Analytique', icon: BarChart2,
    roles: ['super_admin', 'admin'],
  },
  { href: '/settings', label: 'Paramètres', icon: Settings },
]

const adminItems: NavItem[] = [
  { href: '/admin/clinics', label: 'Cliniques', icon: Building2 },
  { href: '/admin/users', label: 'Utilisateurs', icon: ShieldCheck },
]

export function Sidebar() {
  const pathname = usePathname()
  const { clinic, profile } = useClinic()
  const role = profile?.role as Role | undefined
  const isSuperAdmin = role === 'super_admin'
  const isAdminOrSuper = role === 'super_admin' || role === 'admin'

  const visibleNav = navItems.filter(item => {
    if (!item.roles) return true
    return role ? item.roles.includes(role) : false
  })

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-white">
      {/* Logo / Clinic name */}
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm">
          {clinic?.name?.[0] ?? 'C'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{clinic?.name ?? 'CHMS'}</p>
          <p className="truncate text-xs text-gray-500">{clinic?.location ?? ''}</p>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {visibleNav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {active && <ChevronRight className="ml-auto h-3 w-3" />}
            </Link>
          )
        })}

        {/* Admin section — super_admin and admin */}
        {isAdminOrSuper && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Administration</p>
            </div>
            {adminItems
              .filter(item => isSuperAdmin || item.href !== '/admin/clinics')
              .map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-purple-50 text-purple-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                )
              })}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t p-3 space-y-1">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
            {profile?.full_name?.[0] ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{profile?.full_name}</p>
            <p className="truncate text-xs text-gray-500 capitalize">{profile?.role}</p>
          </div>
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" className="w-full justify-start text-red-600 hover:bg-red-50 hover:text-red-700">
            <LogOut className="h-4 w-4" />
            Déconnexion
          </Button>
        </form>
      </div>
    </aside>
  )
}
