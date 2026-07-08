'use client'

// ── <Can> — declarative permission gate (Phase 40) ───────────────
//
// Renders children only when the current principal holds the required
// permission(s). Use for button/section visibility:
//
//   <Can perm="billing.refund"><RefundButton /></Can>
//   <Can anyOf={['finance.view','reports.export']}>…</Can>
//
// Optional `fallback` renders when denied (e.g. a masked placeholder).

import { usePermissions } from '@/hooks/usePermissions'

export function Can({
  perm,
  anyOf,
  allOf,
  fallback = null,
  children,
}: {
  perm?: string
  anyOf?: string[]
  allOf?: string[]
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const { can, canAny, canAll } = usePermissions()

  let allowed = true
  if (perm) allowed = allowed && can(perm)
  if (anyOf && anyOf.length) allowed = allowed && canAny(anyOf)
  if (allOf && allOf.length) allowed = allowed && canAll(allOf)

  return <>{allowed ? children : fallback}</>
}

/** Hook form for imperative checks inside a component. */
export function useCan() {
  const { can, canAny, canAll } = usePermissions()
  return { can, canAny, canAll }
}
