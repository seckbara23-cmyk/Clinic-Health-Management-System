# Deployment and Rollback Plan — CHMS Sénégal

---

## 1. Deployment Overview

| Layer | Platform | Deploy method |
|-------|----------|--------------|
| Frontend / API routes | Vercel | Git push to `main` (auto-deploy) |
| Database migrations | Supabase SQL editor | Manual — apply in order |
| Environment variables | Vercel dashboard | Set before deploying |

**Rule:** Never deploy code changes that depend on a new migration without applying the migration first.

---

## 2. Migration Order

Migrations must be applied in numeric order. They are idempotent where possible (`CREATE IF NOT EXISTS`, `DROP POLICY IF EXISTS`), but order matters for FK dependencies.

| File | Description |
|------|-------------|
| `001_initial_schema.sql` | Base tables, extensions |
| `002_rls.sql` | Initial RLS policies |
| `003_*` … `018_*` | Feature additions, roles, security functions |
| `019_production_hardening.sql` | Phone/email validation, invoice sequence, pg_advisory lock |
| `020_data_integrity.sql` | `record_manual_payment` RPC, patient deletion safety |
| `021_analytics_rpc.sql` | `get_clinic_analytics` RPC |
| `022_rls_with_check.sql` | WITH CHECK hardening on all UPDATE policies |

To confirm which migrations have been applied, run in the Supabase SQL editor:

```sql
-- If you track migrations manually:
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Check for specific functions:
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

---

## 3. Step-by-Step Deployment Process

### Step 1 — Take a backup

Before every production deployment:

```bash
# Record the current commit
git rev-parse HEAD

# Note the current Vercel deployment URL (Settings → Domains → last deployment)
```

Then take a manual Supabase snapshot (Settings → Backups → Create backup).

### Step 2 — Apply database migrations (if any)

1. Open the Supabase SQL editor for the production project.
2. Paste and run each new migration file in numeric order.
3. Verify with `NOTIFY pgrst, 'reload schema';` if touching RLS or functions.
4. Run smoke-test queries (see `BACKUP_AND_RECOVERY.md` §4).

### Step 3 — Set / verify environment variables in Vercel

Check that all required vars from `.env.example` are set in Vercel → Settings → Environment Variables. Pay special attention to:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (rate limiting)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side APIs)
- Payment keys if `NEXT_PUBLIC_PAYMENTS_ENABLED=true`

### Step 4 — Deploy to Vercel

```bash
git push origin main
```

Vercel triggers a build automatically. Monitor the build in the Vercel dashboard.

Alternatively, use the Vercel CLI:

```bash
vercel --prod
```

### Step 5 — Post-deployment smoke test

After the deployment completes (usually < 2 minutes):

1. Open the production URL in an incognito window.
2. Log in as a super_admin.
3. Confirm the dashboard loads.
4. Log in as a clinic admin.
5. Confirm patients, appointments, consultations pages load.
6. Check the browser console for errors.
7. Run the critical items from `LAUNCH_QA_CHECKLIST.md`.

---

## 4. Rollback Strategy

### 4a — Code rollback (Vercel)

Vercel keeps every deployment. To roll back:

1. Go to Vercel → Deployments.
2. Find the last known-good deployment.
3. Click **Redeploy** → **Promote to Production**.

This is instant and does not touch the database.

### 4b — Database rollback

> **Warning:** Most migrations are additive (new columns, new policies). Rolling them back requires manual SQL. Rollbacks that drop columns or tables may cause data loss.

If a migration caused a problem:

1. Identify the exact migration that was applied.
2. Write a compensating migration (undo the changes manually).
3. Apply the compensating migration in the Supabase SQL editor.
4. Do NOT attempt to drop RLS policies without immediately replacing them — this creates a window where all data is unprotected.

**For a catastrophic failure (unrecoverable state):**

1. Restore from the pre-deployment Supabase snapshot (see `BACKUP_AND_RECOVERY.md` §4).
2. Redeploy the previous Vercel build (step 4a).
3. Notify affected clinic admins of the outage and estimated data loss window.

### 4c — Environment variable rollback

If a broken env var causes failures:

1. Go to Vercel → Settings → Environment Variables.
2. Edit the value to the previous known-good value.
3. Trigger a redeploy: Vercel → Deployments → Redeploy latest.

---

## 5. What to Test After Deployment

Run these checks every time, regardless of what changed:

- [ ] Home/login page loads (HTTP 200).
- [ ] Super admin can log in.
- [ ] Clinic admin can log in.
- [ ] Patient list loads (Supabase RLS + connection OK).
- [ ] Analytics page loads for admin.
- [ ] No JavaScript errors in browser console.
- [ ] No `500` errors in Vercel Function logs.

---

## 6. Feature Flags

| Flag | Default | Notes |
|------|---------|-------|
| `NEXT_PUBLIC_PAYMENTS_ENABLED` | `false` | Set to `true` only after full payment sandbox testing |
| `NEXT_PUBLIC_WAVE_ENABLED` | `false` | Requires Wave API key and webhook secret |
| `NEXT_PUBLIC_ORANGE_MONEY_ENABLED` | `false` | Requires Orange Money credentials and sandbox sign-off |

Do not enable payment flags until:

1. Sandbox end-to-end tests pass (real money movement simulated).
2. Webhook HMAC verification confirmed working.
3. Rate limiting is active in production.

---

## 7. Deployment Frequency Guidance

- **Hotfixes:** Deploy immediately after a backup; skip staging if urgency demands.
- **Feature releases:** Deploy during off-peak hours (e.g., evenings in Senegal, UTC+0).
- **Migrations:** Never apply a migration during peak clinic hours.
- **Freeze windows:** Avoid deployments on Mondays and Fridays (highest clinic activity).

---

## 8. Monitoring After Deployment

| Signal | Where to check |
|--------|---------------|
| Build errors | Vercel → Build Logs |
| Runtime errors | Vercel → Functions → Logs |
| Database errors | Supabase → Logs → API / Postgres |
| App errors | `NEXT_PUBLIC_SENTRY_DSN` (if configured) → Sentry dashboard |
| Rate limit hits | Upstash → Redis → Metrics |
