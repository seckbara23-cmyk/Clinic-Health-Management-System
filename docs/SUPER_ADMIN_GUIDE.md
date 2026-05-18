# Super Admin Guide — CHMS Sénégal

This guide is for the platform operator — the person with `super_admin` role who manages clinics across the entire CHMS platform. Clinic-level users (doctors, admins, nurses) do not use this guide.

---

## 1. What Super Admin Can (and Cannot) Do

### Can do
- View all clinic requests (pending, active, archived)
- Approve or reject new clinic registrations
- Archive or reactivate clinics
- Access the Supabase dashboard for database management
- Apply SQL migrations

### Cannot do (by design)
- Read patient records of any specific clinic
- Read consultation notes, prescriptions, or lab requests
- Access billing or invoices of any clinic
- Impersonate a clinic user (no "log in as clinic" feature)

> **Security note:** This scope is intentional. Super admin is a platform operator, not a medical professional. Patient data remains inside clinic RLS boundaries even for super_admin at the application layer. Direct database access (Supabase dashboard) bypasses RLS — use it only for operational reasons and audit the access.

---

## 2. Logging In

1. Navigate to the production URL.
2. Enter the super_admin email and password.
3. On first login, you will be required to change your password. Use a strong password (16+ characters, mix of types).
4. Store the credential in a password manager — never in a shared document.

> The super_admin account should use a dedicated email address (not a personal or shared inbox).

---

## 3. Managing Clinic Requests

### View pending requests

1. Log in as super_admin.
2. Navigate to **Admin → Clinics** (`/admin/clinics`).
3. The default view shows **pending** clinic requests.

Each request shows: clinic name, admin name, email, phone, location, and submission date.

### Approve a clinic

1. Find the clinic in the pending list.
2. Click the **Approve** button (checkmark icon).
3. Confirm in the dialog.

**What happens automatically:**
- Clinic status changes to `active`.
- The clinic admin receives a first-login invitation email.
- The clinic becomes operational (staff can be invited, patients registered).

### Reject a clinic

1. Find the clinic in the pending list.
2. Click the **Reject** button (X icon).
3. Enter a rejection reason (required).
4. Confirm.

**What happens automatically:**
- Clinic status changes to `rejected`.
- The clinic admin receives an email with the rejection reason.
- The clinic cannot be used to log in.

> Rejection is not permanent — if the applicant corrects the issue, they can resubmit. If you need to reverse a rejection, update the status directly in the Supabase database.

---

## 4. Managing Active Clinics

### View active clinics

In `/admin/clinics`, switch to the **Active** tab to see all approved and operational clinics.

### Archive a clinic

Archiving suspends a clinic — users can no longer log in, and the data is preserved.

1. Find the clinic in the active list.
2. Click **Archive** (archive icon).
3. Confirm in the dialog.

Use cases:
- Clinic has stopped operating
- Non-payment (if billing for the platform is introduced)
- Clinic requested removal

### Reactivate a clinic

1. Switch to the **Archived** tab.
2. Find the clinic.
3. Click **Réactiver** (reactivate button).
4. Confirm.

The clinic and all its data are immediately accessible again.

---

## 5. Password Reset for Clinic Users

The application does not have a built-in "reset password for another user" UI. To reset a clinic user's password:

**Option A — User self-service (preferred)**

Direct the user to the login page and have them use "Mot de passe oublié" (Forgot password). This sends a reset email to their registered address.

**Option B — Supabase dashboard**

1. Go to [app.supabase.com](https://app.supabase.com) → your project → **Authentication → Users**.
2. Find the user by email.
3. Click **Send password reset**.

> Never manually set a password in the database. Always use the official Supabase password reset flow.

---

## 6. Suspend / Reactivate a Clinic User

Individual user suspension is not in the current application UI. To suspend a specific user:

1. Go to Supabase → **Authentication → Users**.
2. Find the user by email.
3. Click **Ban user** (sets `banned_until` to far future).

To reactivate: Click **Remove ban**.

Alternatively, an admin within the clinic can remove the user's role or revoke their invitation.

---

## 7. Interpreting Audit Logs

### Application-level audit (invoice payments)

The `invoice_payments` table records every payment event:

```sql
SELECT ip.*, i.patient_id, i.clinic_id
FROM public.invoice_payments ip
JOIN public.invoices i ON i.id = ip.invoice_id
WHERE i.clinic_id = 'target-clinic-id'
ORDER BY ip.paid_at DESC;
```

Fields: `invoice_id`, `amount`, `payment_method`, `paid_at`, `recorded_by` (user_profile id).

### Supabase auth logs

Go to Supabase → **Logs → Auth** to see:
- Login attempts (success/failure)
- Password resets
- Email confirmations
- Token refresh events

Filter by email to investigate a specific user's activity.

### Supabase API logs

Go to Supabase → **Logs → API** to see:
- Every database request, including table scans
- RPC calls (`record_manual_payment`, `get_clinic_analytics`)
- Error responses (403 = RLS denied, 404 = row not found)

### What to look for

| Signal | Possible cause |
|--------|---------------|
| Many 403 errors from one IP | Attempted cross-clinic data access or brute force |
| Spike in `invoice_payments` inserts | Unusual billing activity — check with clinic admin |
| Auth failures for a user | Credential stuffing or forgotten password |
| RPC errors on `record_manual_payment` | Invoice state mismatch — check the invoice directly |

---

## 8. Creating a Clinic Manually (Emergency)

If the clinic registration form is unavailable, you can create a clinic directly in the database:

```sql
-- Step 1: Insert the clinic request (approved)
INSERT INTO public.clinic_requests (
  clinic_name, admin_name, admin_email, admin_phone,
  city, country, status, notes
) VALUES (
  'Clinic Name', 'Admin Full Name', 'admin@example.com', '+221XXXXXXXXX',
  'Dakar', 'SN', 'approved', 'Created manually by super admin'
);

-- Step 2: Create the clinic record
INSERT INTO public.clinics (name, status)
VALUES ('Clinic Name', 'active')
RETURNING id;

-- Step 3: Create the user in Supabase Auth (use the dashboard UI or Admin API)
-- Then insert a user_profile row:
INSERT INTO public.user_profiles (id, clinic_id, full_name, role, email, must_change_password)
VALUES (
  '<auth.users UUID>',
  '<clinic UUID from step 2>',
  'Admin Full Name',
  'admin',
  'admin@example.com',
  true  -- forces password change on first login
);
```

> After inserting, send a password reset email via Supabase Auth dashboard so the user can set their password.

---

## 9. Data Export for a Clinic (on request)

If a clinic requests their data export (e.g., migrating away):

```sql
-- Run in Supabase SQL editor with the clinic's ID
-- Export to CSV using the download button in the editor

SELECT * FROM public.patients         WHERE clinic_id = 'CLINIC_ID';
SELECT * FROM public.consultations    WHERE clinic_id = 'CLINIC_ID';
SELECT * FROM public.prescriptions    WHERE clinic_id = 'CLINIC_ID';
SELECT * FROM public.appointments     WHERE clinic_id = 'CLINIC_ID';
SELECT * FROM public.invoices         WHERE clinic_id = 'CLINIC_ID';
SELECT * FROM public.lab_requests     WHERE clinic_id = 'CLINIC_ID';
```

Deliver the CSVs to the clinic admin via a secure, encrypted channel.

---

## 10. Emergency Contacts

| Situation | Action |
|-----------|--------|
| Database unavailable | Check [status.supabase.com](https://status.supabase.com); contact Supabase support |
| App unavailable | Check [vercel-status.com](https://vercel-status.com); redeploy or roll back |
| Suspected data breach | Immediately rotate `SUPABASE_SERVICE_ROLE_KEY` in Vercel, rotate Supabase anon key, notify affected clinics |
| Super admin account compromised | Log in to Supabase dashboard → Auth → Ban the account, then create a new super admin |
