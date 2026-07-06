# Phase 15.0B — "Temporary Support Access" — Future Design (NOT implemented)

**Status:** Design only. No code, no migration, no UI. Documents a future,
opt-in, time-limited, audited, revocable support-access workflow so that the
Reliability Center's principle — *super_admin sees operational failures, not
clinical data* — can be **deliberately and temporarily** relaxed for a single
clinic **only with that clinic's consent**, when a bug genuinely cannot be
diagnosed from sanitized telemetry alone.

## Why this is separate from 15.0B

15.0B ships operational monitoring with a hard wall: super_admin never reads
clinical rows; every reliability event is PII-sanitized; the 027 medical-data
lockout is untouched. That wall is correct as the default. But some incidents
(e.g. "saving a consultation fails only for clinic X") may require a support
engineer to reproduce against real (still access-controlled) context. That must
never be a silent super_admin capability — it must be **granted by the clinic,
scoped, expiring, and fully audited**.

## Principles (non-negotiable for the future build)

1. **Consent-gated.** Access is *granted by a clinic ADMIN*, never self-granted
   by super_admin. Default deny.
2. **Time-limited.** Every grant carries a hard expiry (e.g. ≤ 24h). Expiry is
   enforced in RLS via `now() < expires_at`, not just in the UI.
3. **Scoped.** A grant names what it covers (e.g. `scope = 'reliability_debug'`
   or a specific module) — never blanket clinical access. The narrowest scope
   that lets the engineer reproduce the bug.
4. **Revocable.** The clinic admin can revoke instantly; revocation takes effect
   at the RLS layer immediately (a `revoked_at` column short-circuits the policy).
5. **Audited.** Grant, every access under it, and revocation all write to
   `admin_audit_log` (019) with actor, clinic, scope, and timestamp. The clinic
   sees its own support-access history.
6. **Visible to the tenant.** While a grant is active, the clinic sees a
   persistent banner ("Support access active until HH:MM — revoke").

## Proposed data model (future migration, additive)

```sql
CREATE TABLE public.support_access_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- surrogate PK
  clinic_id     UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  granted_by    UUID NOT NULL REFERENCES public.user_profiles(id),  -- clinic admin
  scope         TEXT NOT NULL DEFAULT 'reliability_debug',
  reason        TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Surrogate PK + single clinic FK (no composite-FK PK) — same anti-junction rule
as every other table in this project.

## Proposed access predicate (future)

A support engineer's effective read of a clinic's data under a grant would be
gated by a helper such as:

```sql
CREATE FUNCTION public.has_active_support_access(p_clinic UUID, p_scope TEXT)
RETURNS BOOLEAN ... AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_access_grants g
    WHERE g.clinic_id = p_clinic
      AND g.scope = p_scope
      AND g.revoked_at IS NULL
      AND now() < g.expires_at
      AND public.is_super_admin()          -- only super_admin can USE a grant
  );
$$;
```

Crucially: even with a grant, access would be added as an **additive, scoped**
predicate to *specific* debug surfaces — it would **not** re-open the blanket
027 lockout, and it would never widen a normal tenant user's access.

## Workflow

```
Clinic admin: Settings → Support → "Grant temporary support access"
   → choose scope + duration (≤24h) + reason
   → confirm → writes support_access_grants + admin_audit_log('support.grant')
Super_admin/support: sees the active grant; every access writes
   admin_audit_log('support.access'); UI shows "acting under grant #… , expires …"
Clinic admin (any time): "Revoke" → sets revoked_at → access ends immediately
System: at expires_at the predicate stops matching — access ends automatically.
```

## Explicitly out of scope for 15.0B

- No support-access table, function, UI, or clinical read path is implemented now.
- The Reliability Center (15.0B) works entirely on sanitized aggregates and never
  needs this. This doc exists so the eventual, consent-based escalation is
  designed correctly rather than improvised.
