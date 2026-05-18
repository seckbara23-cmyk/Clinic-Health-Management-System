# Backup and Recovery — CHMS Sénégal

> **Medical data warning.** This system stores patient records, consultation notes, prescriptions, and billing data. Loss of this data cannot be undone and may have clinical, legal, and regulatory consequences. Follow this guide carefully before going live and on an ongoing basis.

---

## 1. Supabase Managed Backups

Supabase automatically backs up your PostgreSQL database. The frequency depends on your plan:

| Plan | Backup frequency | Retention | Point-in-time recovery (PITR) |
|------|-----------------|-----------|-------------------------------|
| Free | Daily snapshots | 7 days | No |
| Pro | Daily snapshots | 7 days | Optional add-on (7-day window) |
| Team | Daily snapshots | 14 days | Included (7-day window) |

**Recommendation:** Use the **Pro plan or higher** in production. Enable PITR for a medical system — it lets you restore to any second within the retention window, not just midnight snapshots.

### How to verify backups are enabled

1. Go to [app.supabase.com](https://app.supabase.com) → your project → **Settings → Backups**.
2. Confirm the backup schedule shows recent runs.
3. Enable PITR if your plan supports it.

---

## 2. Manual Database Exports

Run these exports at least weekly and before any major migration. Store the output encrypted and off-site (e.g., Backblaze B2, AWS S3, or a team password manager vault).

### Full database export (Supabase dashboard)

Settings → Backups → **Download** a snapshot.

### Selective export via `pg_dump` (if you have direct DB access)

```bash
# Requires DATABASE_URL from Supabase → Settings → Database → Connection string (URI)
pg_dump "$DATABASE_URL" \
  --no-acl --no-owner \
  --format=custom \
  --file=chms_backup_$(date +%Y%m%d_%H%M%S).dump
```

### Export critical tables to CSV (fallback)

Use the Supabase SQL editor or `psql`:

```sql
-- Run these queries and save each result as a CSV
SELECT * FROM public.patients;
SELECT * FROM public.consultations;
SELECT * FROM public.prescriptions;
SELECT * FROM public.invoices;
SELECT * FROM public.appointments;
SELECT * FROM public.user_profiles;
SELECT * FROM public.clinics;
```

---

## 3. Storage Backups (medical documents)

Supabase Storage buckets are **not included** in database backups. If the application ever stores medical files (PDFs, lab results, images) in Supabase Storage, those must be backed up separately.

### Backup strategy for storage

1. **List all objects** using the Supabase Storage API or dashboard.
2. **Download objects** using the service-role key (Storage is RLS-protected; the anon key cannot list private buckets).
3. Store downloaded files with the same folder structure to an encrypted off-site location.

> Currently the application does not use Supabase Storage for medical documents. Update this section if storage is added.

---

## 4. Restore Testing

A backup that has never been tested is not a real backup. Perform a restore test:

- **Frequency:** Monthly, or before each major deployment
- **Environment:** A separate Supabase project (never restore over production)

### Restore from a Supabase snapshot

1. Create a new Supabase project (same region).
2. Go to the new project → Settings → Backups → **Restore from backup**.
3. Select the snapshot, confirm.
4. After restore, run the smoke-test queries below.

### Restore from a `pg_dump` file

```bash
# Requires DATABASE_URL of the TARGET (test) project
pg_restore \
  --no-acl --no-owner \
  --dbname="$DATABASE_URL" \
  chms_backup_YYYYMMDD_HHMMSS.dump
```

### Post-restore smoke tests

```sql
-- Confirm row counts match source
SELECT COUNT(*) FROM public.patients;
SELECT COUNT(*) FROM public.consultations;
SELECT COUNT(*) FROM public.invoices;

-- Confirm RLS helpers exist
SELECT public.is_super_admin();
SELECT public.get_clinic_id();
SELECT public.get_user_role();

-- Confirm analytics RPC exists
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'get_clinic_analytics';

-- Confirm payment RPC exists
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'record_manual_payment';
```

---

## 5. Retention Policy

| Data type | Minimum retention | Recommendation |
|-----------|------------------|----------------|
| Database snapshots | 7 days (Supabase) | 90 days (download and store off-site) |
| Manual CSV exports | 3 months | 1 year |
| Audit logs (Supabase) | Keep all | Never delete |
| Storage files | N/A currently | Keep all (medical records) |

> **Legal note:** Senegalese medical data regulations (Loi n° 2008-12 sur la protection des données personnelles) require data to be kept for the duration of the care relationship plus several years. Consult a local legal advisor before implementing any purge policy.

---

## 6. Pre-Deployment Backup Checklist

Before every production deployment or migration:

- [ ] Manually trigger or download a Supabase snapshot.
- [ ] Confirm the snapshot timestamp is recent (< 1 hour old).
- [ ] Record the current git commit hash: `git rev-parse HEAD`
- [ ] Note the current Vercel deployment URL as the rollback target.
- [ ] Store the backup file in an off-site location.

---

## 7. Disaster Recovery Targets

| Scenario | Recovery Time Objective (RTO) | Recovery Point Objective (RPO) |
|----------|-------------------------------|-------------------------------|
| Accidental row deletion | < 30 min (PITR restore) | < 5 min (with PITR) |
| Corrupted migration | < 1 hour | Last snapshot (≤ 24h without PITR) |
| Full project loss | < 4 hours | Last off-site export |
| Storage loss | Depends on backup cadence | Last storage export |

---

## 8. Contacts and Escalation

Fill in before going live:

| Role | Name | Contact |
|------|------|---------|
| Database admin | | |
| Application owner | | |
| Supabase support | | [support.supabase.com](https://support.supabase.com) |
| Data protection officer | | |
