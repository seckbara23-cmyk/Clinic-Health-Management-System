'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, CalendarDays, Receipt,
  Settings, LogOut, Stethoscope, ShieldCheck,
  Building2, ChevronRight, ClipboardList, Pill, FlaskConical, BarChart2, Inbox, X, CreditCard, TestTube, Package, PackageSearch, BookMarked, ScanLine, Activity, ShieldAlert, IdCard, Radiation, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isNavVisible } from '@/lib/tenant'
import { useClinic } from '@/context/ClinicContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useSidebar } from '@/context/SidebarContext'
import { signOut } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import type { Role } from '@/types/database'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'

interface NavItem {
  href: string
  labelKey: string
  icon: React.ElementType
  /** Enterprise Authorization permission gating this item (Phase 40). */
  perm?: string
  /** Legacy role gate — retained as documentation/fallback when `perm` is absent. */
  roles?: Role[]
}

// Each main-nav item now carries a `perm` from the Enterprise Authorization
// registry; visibility resolves through `can(perm)`. The default matrix
// (lib/authz/matrix.ts) is calibrated to reproduce the previous role gates
// exactly, so this is a zero-regression switch. `roles` is kept for reference.
const navItems: NavItem[] = [
  { href: '/dashboard',     labelKey: 'dashboard',     icon: LayoutDashboard, perm: 'dashboard.view' },
  { href: '/patients',      labelKey: 'patients',      icon: Users, perm: 'patients.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist', 'cashier'] },
  { href: '/queue',         labelKey: 'queue',         icon: ClipboardList, perm: 'queue.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  { href: '/appointments',  labelKey: 'appointments',  icon: CalendarDays, perm: 'appointments.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  { href: '/consultations', labelKey: 'consultations', icon: Stethoscope, perm: 'consultations.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
  { href: '/prescriptions', labelKey: 'prescriptions', icon: Pill, perm: 'prescriptions.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
  { href: '/lab-orders',    labelKey: 'labOrders',     icon: FlaskConical, perm: 'laboratory.view',
    roles: ['super_admin', 'admin', 'doctor', 'nurse', 'lab_technician'] },
  { href: '/lab-catalog',   labelKey: 'labCatalog',    icon: TestTube, perm: 'laboratory.catalog',
    roles: ['super_admin', 'admin'] },
  { href: '/radiology',     labelKey: 'radiology',     icon: Radiation, perm: 'radiology.view',
    roles: ['super_admin', 'admin', 'doctor'] },
  { href: '/pharmacy',          labelKey: 'pharmacy',          icon: Pill, perm: 'pharmacy.view',
    roles: ['super_admin', 'admin', 'pharmacist'] },
  { href: '/pharmacy/inventory', labelKey: 'pharmacyInventory', icon: Package, perm: 'pharmacy.inventory',
    roles: ['super_admin', 'admin', 'pharmacist'] },
  { href: '/pharmacy/reports',   labelKey: 'pharmacyReports',   icon: PackageSearch, perm: 'pharmacy.reports',
    roles: ['super_admin', 'admin', 'pharmacist'] },
  { href: '/pharmacy/catalog',   labelKey: 'pharmacyCatalog',   icon: BookMarked, perm: 'pharmacy.catalog',
    roles: ['super_admin', 'admin', 'pharmacist', 'doctor', 'nurse'] },
  { href: '/pharmacy/scan',      labelKey: 'pharmacyScan',      icon: ScanLine, perm: 'pharmacy.scan',
    roles: ['super_admin', 'admin', 'pharmacist'] },
  { href: '/billing',       labelKey: 'billing',       icon: Receipt, perm: 'billing.view',
    roles: ['super_admin', 'admin', 'receptionist', 'cashier', 'doctor'] },
  { href: '/analytics',     labelKey: 'analytics',     icon: BarChart2, perm: 'reports.view',
    roles: ['super_admin', 'admin'] },
  { href: '/settings',      labelKey: 'settings',      icon: Settings, perm: 'settings.view' },
]

const adminItems: NavItem[] = [
  { href: '/admin/activity',         labelKey: 'adminActivity',  icon: Activity, roles: ['super_admin'] },
  { href: '/admin/reliability',      labelKey: 'adminReliability', icon: ShieldAlert, roles: ['super_admin'] },
  { href: '/admin/clinics',          labelKey: 'adminClinics',   icon: Building2 },
  { href: '/admin/clinic-requests',  labelKey: 'adminRequests',  icon: Inbox, roles: ['super_admin'] },
  { href: '/admin/users',            labelKey: 'adminUsers',     icon: ShieldCheck },
  { href: '/admin/authorization',    labelKey: 'adminAuthorization', icon: Lock, roles: ['super_admin', 'admin'] },
  { href: '/workforce',              labelKey: 'workforce',      icon: IdCard, roles: ['super_admin', 'admin'] },
  { href: '/admin/billing',          labelKey: 'adminBilling',   icon: CreditCard, roles: ['super_admin'] },
]

function SidebarInner() {
  const pathname = usePathname()
  const { clinic, profile } = useClinic()
  const { can } = usePermissions()
  const role = profile?.role as Role | undefined
  const isSuperAdmin = role === 'super_admin'
  const isAdminOrSuper = role === 'super_admin' || role === 'admin'
  const t = useTranslations('nav')

  // Permission-driven visibility (Phase 40): a module hides itself when the
  // principal lacks its `perm`. Falls back to the legacy role gate if an item
  // has no permission mapping.
  const visibleNav = navItems.filter(item =>
    item.perm ? can(item.perm) : isNavVisible(role, item.roles),
  )

  return (
    <>
      {/* Logo / Clinic name */}
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white font-bold text-sm">
          {clinic?.name?.[0] ?? 'C'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{clinic?.name ?? 'CHMS'}</p>
          <p className="truncate text-xs text-gray-500">{clinic?.location ?? ''}</p>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
        {visibleNav.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(labelKey)}
              {active && <ChevronRight className="ml-auto h-3 w-3" />}
            </Link>
          )
        })}

        {/* Admin section */}
        {isAdminOrSuper && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('adminSection')}</p>
            </div>
            {adminItems
              .filter(item => {
                if (item.roles) return isNavVisible(role, item.roles)
                return isSuperAdmin || item.href !== '/admin/clinics'
              })
              .map(({ href, labelKey, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-purple-50 text-purple-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {t(labelKey)}
                  </Link>
                )
              })}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t p-3 space-y-1">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700">
            {profile?.full_name?.[0] ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{profile?.full_name}</p>
            <p className="truncate text-xs text-gray-500 capitalize">{profile?.role}</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-2 pb-1">
          <LocaleSwitcher />
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" className="w-full justify-start text-red-600 hover:bg-red-50 hover:text-red-700">
            <LogOut className="h-4 w-4" />
            {t('signOut')}
          </Button>
        </form>
      </div>

      {/* Senegal flag accent strip */}
      <div aria-hidden="true" className="flex h-1">
        <div className="flex-1 bg-[#009E60]" />
        <div className="flex-1 bg-[#FDEF42]" />
        <div className="flex-1 bg-[#E31B23]" />
      </div>
    </>
  )
}

export function Sidebar() {
  const { mobileOpen, closeMobile } = useSidebar()
  const t = useTranslations('nav')

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 md:hidden',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* Sidebar — fixed on mobile (slide-in), static in flex layout on desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r bg-white shadow-xl transition-transform duration-300 ease-in-out',
          'md:static md:z-auto md:shadow-none md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Close button — mobile only */}
        <button
          className="absolute right-2 top-2 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 md:hidden"
          onClick={closeMobile}
          aria-label={t('closeMenu')}
        >
          <X className="h-5 w-5" />
        </button>

        <SidebarInner />
      </aside>
    </>
  )
}
