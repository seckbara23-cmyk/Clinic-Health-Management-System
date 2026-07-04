import type { Role } from '@/types/database'

/**
 * Role → module access map for the invite-user permission PREVIEW.
 *
 * UX / documentation only. This mirrors the navigation gates in
 * `components/layout/Sidebar.tsx` (navItems + adminItems) — the visible source
 * of truth for who can reach what. It does NOT define or change RLS, database
 * permissions, or real authorization; editing it only changes what the preview
 * card shows. Keep the `roles` arrays in sync with the sidebar when nav gates
 * change.
 */
export interface PermissionModule {
  /** i18n key: `adminUsers.module_<key>`. */
  key: string
  /** Roles that can reach this module (mirrors the sidebar nav gate). */
  roles: Role[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'patients',         roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist', 'cashier'] },
  { key: 'queue',            roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  { key: 'appointments',     roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
  { key: 'consultations',    roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
  { key: 'prescriptions',    roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
  { key: 'labOrders',        roles: ['super_admin', 'admin', 'doctor', 'nurse', 'lab_technician'] },
  { key: 'pharmacy',         roles: ['super_admin', 'admin', 'pharmacist'] },
  { key: 'pharmacyInventory', roles: ['super_admin', 'admin', 'pharmacist'] },
  { key: 'pharmacyCatalog',  roles: ['super_admin', 'admin', 'pharmacist', 'doctor', 'nurse'] },
  { key: 'pharmacyReports',  roles: ['super_admin', 'admin', 'pharmacist'] },
  { key: 'billing',          roles: ['super_admin', 'admin', 'receptionist', 'cashier', 'doctor'] },
  { key: 'analytics',        roles: ['super_admin', 'admin'] },
  { key: 'users',            roles: ['super_admin', 'admin'] },
  { key: 'clinicSettings',   roles: ['super_admin', 'admin'] },
]

/** Roles a clinic admin can invite (excludes super_admin). */
export const INVITABLE_ROLES: Role[] = [
  'admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician', 'pharmacist',
]

/** Split the module catalog into accessible / restricted for a role. */
export function modulesForRole(role: Role): {
  accessible: PermissionModule[]
  restricted: PermissionModule[]
} {
  const accessible: PermissionModule[] = []
  const restricted: PermissionModule[] = []
  for (const m of PERMISSION_MODULES) {
    if (m.roles.includes(role)) accessible.push(m)
    else restricted.push(m)
  }
  return { accessible, restricted }
}
