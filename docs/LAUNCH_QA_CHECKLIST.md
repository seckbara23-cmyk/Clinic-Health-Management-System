# Launch QA Checklist — CHMS Sénégal

Run this checklist against the production environment immediately before and after go-live. Each item should be tested by a human; do not skip sections.

Mark each item **Pass / Fail / N/A** with the tester's initials and date.

---

## Pre-launch gate

Before testing the app, confirm:

- [ ] All Supabase migrations (001 through 022) have been applied in the production project.
- [ ] `.env.local` / Vercel environment variables are set (see `.env.example`).
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set (rate limiting active).
- [ ] `NEXT_PUBLIC_PAYMENTS_ENABLED=false` (unless payments are explicitly approved for launch).
- [ ] A pre-launch database snapshot has been taken.
- [ ] Vercel deployment is on the correct git branch/commit.

---

## 1. Super Admin Flow

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 1.1 | Log in with super_admin email and password. | | |
| 1.2 | Dashboard loads without error. | | |
| 1.3 | `/admin/clinics` page lists pending, active, and archived clinics. | | |
| 1.4 | Can approve a pending clinic (status changes to active). | | |
| 1.5 | Can reject a pending clinic (dialog shows, rejection reason required). | | |
| 1.6 | Can archive an active clinic (confirm dialog required). | | |
| 1.7 | Archived clinic no longer appears in the active list. | | |
| 1.8 | Can view a clinic's details and user list. | | |
| 1.9 | Cannot see patient records, billing, or consultations of any specific clinic. | | |
| 1.10 | Analytics page shows "Accès réservé aux administrateurs" if accessed as non-admin. | | |
| 1.11 | Log out — session terminates, redirect to login. | | |

---

## 2. Clinic Request and Approval Flow

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 2.1 | Unauthenticated user visits `/register` (or clinic request form). | | |
| 2.2 | Submit a new clinic registration request with valid data. | | |
| 2.3 | Confirmation message shown; no clinic-level access granted yet. | | |
| 2.4 | Super admin sees the new request in the pending list. | | |
| 2.5 | Super admin approves the clinic. | | |
| 2.6 | Clinic admin receives the first-login invitation email. | | |
| 2.7 | First-login link works; user is forced to change password. | | |
| 2.8 | After password change, user lands on the clinic dashboard. | | |

---

## 3. Clinic Admin — First Login and Setup

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 3.1 | First-login password change is enforced on first access. | | |
| 3.2 | Weak password is rejected (length, complexity). | | |
| 3.3 | Strong password is accepted; user is redirected to dashboard. | | |
| 3.4 | Clinic profile page shows correct clinic name. | | |
| 3.5 | Admin can invite a staff member (doctor, nurse, receptionist). | | |
| 3.6 | Invitation email is received by the invited address. | | |
| 3.7 | Invited user can complete registration via the email link. | | |

---

## 4. Patient Management

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 4.1 | Can create a new patient (all required fields). | | |
| 4.2 | Patient appears in the patient list immediately. | | |
| 4.3 | Can search patients by name. | | |
| 4.4 | Can view patient details page. | | |
| 4.5 | Can edit patient information. | | |
| 4.6 | Delete patient shows a confirmation dialog with cascade counts. | | |
| 4.7 | Confirming deletion removes patient and all related records. | | |
| 4.8 | Cannot see patients from another clinic (cross-tenant isolation). | | |

---

## 5. Appointment Lifecycle

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 5.1 | Can create an appointment for a patient. | | |
| 5.2 | Appointment appears in the appointments table. | | |
| 5.3 | Can change appointment status to `confirmed`. | | |
| 5.4 | Can mark appointment as `completed`. | | |
| 5.5 | Cancel appointment shows a confirmation dialog (no `confirm()` popup). | | |
| 5.6 | Cancelled appointment shows correct status. | | |
| 5.7 | Cannot create appointments for another clinic's patients. | | |

---

## 6. Consultation Lifecycle

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 6.1 | Can create a new consultation from the consultations page. | | |
| 6.2 | Creating a consultation redirects to the consultation detail page. | | |
| 6.3 | Can add/edit chief complaint, symptoms, diagnosis, treatment plan. | | |
| 6.4 | Can record vital signs (BP, HR, temperature, weight, height, SpO₂). | | |
| 6.5 | Vital signs display correctly in the consultation list. | | |
| 6.6 | Can add prescriptions from the consultation detail page. | | |
| 6.7 | Can add lab requests from the consultation detail page. | | |
| 6.8 | Consultation list shows only this clinic's consultations. | | |

---

## 7. Billing and Payment Flow

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 7.1 | Invoice is created automatically with a consultation (if configured). | | |
| 7.2 | Can create a manual invoice for a patient. | | |
| 7.3 | Invoice appears in the billing list with status `pending`. | | |
| 7.4 | Marking an invoice as paid calls the RPC (no direct row update). | | |
| 7.5 | Invoice status changes to `paid` after full payment. | | |
| 7.6 | Partial payment records the amount and keeps status `partial`. | | |
| 7.7 | Overpayment is rejected (amount exceeds remaining balance). | | |
| 7.8 | Payment audit row is appended correctly. | | |
| 7.9 | `NEXT_PUBLIC_PAYMENTS_ENABLED=false` hides Wave/Orange Money buttons. | | |

---

## 8. Analytics

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 8.1 | Analytics page loads for admin role. | | |
| 8.2 | KPI cards show non-zero values if data exists. | | |
| 8.3 | Revenue chart renders (12-month bar chart). | | |
| 8.4 | Appointments chart renders. | | |
| 8.5 | Patients trend line renders. | | |
| 8.6 | Status breakdown pie charts render. | | |
| 8.7 | "Accès réservé aux administrateurs" shown for non-admin roles. | | |
| 8.8 | No data from other clinics visible in analytics. | | |

---

## 9. Mobile and Cross-Browser Testing

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 9.1 | Login page usable on a 375px-wide screen (iPhone SE). | | |
| 9.2 | Patient list scrolls horizontally on mobile (table overflow). | | |
| 9.3 | Appointments table scrolls correctly on mobile. | | |
| 9.4 | Consultations table scrolls correctly on mobile. | | |
| 9.5 | Action buttons remain tappable on mobile (not clipped). | | |
| 9.6 | Dialogs are usable on mobile (not cut off). | | |
| 9.7 | Test in Chrome, Firefox, and Safari (or Mobile Safari). | | |

---

## 10. Session and Security

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 10.1 | Unauthenticated request to a protected route redirects to login. | | |
| 10.2 | Logging out invalidates the session (cannot navigate back with browser back). | | |
| 10.3 | JWT is not stored in `localStorage` (Supabase uses `sessionStorage` / cookies). | | |
| 10.4 | Service-role key is not visible in browser network requests. | | |
| 10.5 | No `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_` variable. | | |
| 10.6 | Attempting to read another clinic's patient by ID returns empty (RLS enforced). | | |
| 10.7 | Rate limiting blocks excessive requests to `/api/clinic-requests`. | | |

---

## 11. Error States

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 11.1 | Simulate network failure — error states show (not blank pages). | | |
| 11.2 | Error states include a retry button. | | |
| 11.3 | Buttons are disabled while mutations are in flight. | | |
| 11.4 | Failed mutations show a toast error message (not silent failure). | | |

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Technical lead | | | |
| Product owner | | | |
| QA tester | | | |
