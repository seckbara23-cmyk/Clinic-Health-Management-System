'use client'

import { ClinicProvider } from '@/context/ClinicContext'
import { TenantGate } from './TenantGate'
import type { Clinic, UserProfile } from '@/types/database'

// Client boundary for the dashboard: seeds the tenant context with the
// server-fetched profile + clinic (so there is no null flash on hard refresh),
// then gates the subtree with TenantGate (loading / explicit error / ready).
export function TenantBoundary({
  initialProfile,
  initialClinic,
  children,
}: {
  initialProfile: UserProfile | null
  initialClinic: Clinic | null
  children: React.ReactNode
}) {
  return (
    <ClinicProvider initialProfile={initialProfile} initialClinic={initialClinic}>
      <TenantGate>{children}</TenantGate>
    </ClinicProvider>
  )
}
