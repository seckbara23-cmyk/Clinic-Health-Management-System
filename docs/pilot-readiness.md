# CHMS — Pilot Readiness (Phase 41)

_Last validated: 2026-07-08 · commit at time of writing: see `git log`._

This document is the operational checklist for taking CHMS into a **real pilot clinic in Senegal**. It is the output of the Phase 41 end-to-end validation (workflows, roles, security, French-first UX, print/export, performance) and does **not** introduce new modules.

---

## 1. Pilot goal

Prove that a single Senegalese clinic can run its **daily operations** on CHMS for the full patient journey — reception → consultation → prescription/lab/imaging → pharmacy → billing — with correct role separation, French-first UX, and no data leakage between clinics or between roles.

Success = one week of live use with:
- every role able to complete its core task without a workaround,
- no cross-clinic or cross-role data exposure,
- printed documents (invoice, prescription, receipt, lab result, radiology report, certificate) usable on real paper.

---

## 2. Roles to test

`super_admin` · `admin` · `doctor` · `nurse` · `receptionist` · `cashier` · `lab_technician` · `pharmacist`.

Radiologist = a **doctor whose primary specialty is `radiology`** (there is no separate radiologist role). Accountant / HR / clinic-manager are **not** separate roles today — those responsibilities map to `admin`. See `pilot-role-checklist.md` for the full expectation matrix.

---

## 3. Workflows to test (status from the Phase 41 audit)

| # | Workflow | Status |
|---|----------|--------|
| 1 | Reception → registration → appointment → consultation → prescription → pharmacy dispensing → billing | ✅ Wired end-to-end |
| 2 | Reception → consultation → lab order → sample collection → result entry → doctor review | ✅ Wired end-to-end |
| 3 | Consultation → **radiology order** → Radiora worklist → dictation → structured report → signature → chart | ✅ Fixed in Phase 41 — the "Imaging" quick action now creates the order that populates the worklist |
| 4 | Nurse → vitals → doctor consultation | ⚠️ Works; vitals are captured **inside** a consultation (no standalone triage station) |
| 5 | Cashier → payment → receipt | ✅ Wired end-to-end |
| 6 | Admin → user onboarding (temp password) → forced password change | ✅ Server-enforced via middleware |
| 7 | HR → employee profile → credentials → workforce dashboard | ✅ Wired (staff must first be onboarded via `/admin/users`) |
| 8 | Super Admin → Platform Activity → Reliability | ✅ Aggregate-only, no clinical data |

---

## 4. Known limitations (be honest with the pilot clinic)

- **Radiology ordering is new** — the imaging order was wired in Phase 41; exercise it early in the pilot.
- **No standalone nurse triage/vitals station** — a nurse records vitals within a consultation record, which the doctor then continues. Acceptable, but not a separate triage step.
- **Lab sample "barcode" label is decorative** — `LabSampleLabel` prints a human-readable sample code; the bar graphic is not a scannable symbology. Staff key the sample code manually.
- **List pages are not yet paginated** — lab orders, invoices, prescriptions and appointments load recent-first without a hard page size. Fine at pilot data volumes; add pagination before multi-year scale (see §7).
- **`pdf.ts` documents render in French only** — correct for a Senegal pilot; English-locale users still receive French invoices/prescriptions/lab results.
- **AI copilots are read-only and deterministic** — they never diagnose, prescribe, or write to records, and inherit the user's permissions (a lab tech's AI sees only lab data, etc.).
- **Custom roles & break-glass are architecturally prepared but not enabled** — the default permission matrix applies.
- **All Supabase migrations must be applied by hand** to the production project — the automation points at the wrong project (see §5).

---

## 5. Migration checklist (§9 of the phase)

**Do not apply automatically.** Apply in numeric order against the production project (`qnbta`). Every migration is idempotent (`IF EXISTS` / `IF NOT EXISTS`).

### Classification of the pending set (033 → 068)

| Range | Nature | Production action |
|-------|--------|-------------------|
| 033–036 | Additive: smart pharmacy, dispensing verifications, lab sample tracking, clinic settings | Apply — required for pharmacy/lab/settings features |
| 037 | Additive: `user_preferences` junction. **Dependency note:** created the PostgREST ambiguity that requires explicit FK hints (`clinics!user_profiles_clinic_id_fkey`) already in the code | Apply |
| 038–047 | Additive: professional profiles, specialties, copilot packs + governance, platform activity, reliability, vaccinations, pregnancies, ORL events, document generations | Apply |
| **048** | **P0 fix** — replaces the two `clinic_invitations` policies that read `auth.users` directly with `auth.jwt()->>'email'`. **Must be applied after 002 & 022** (which created those policies). Without it, inviting a user throws `permission denied for table users` | **Apply — required. Order-critical.** |
| 049 | Additive: workforce (employee profiles/credentials/events/training) | Apply |
| 050–066 | Additive: one `<specialty>_events` table per clinical copilot (cardiology → rheumatology) | Apply |
| 067 | Additive: radiology (orders/reports/report_versions + signed-immutability trigger + append-only versions) | Apply — required for Radiora |
| 068 | Additive: authorization (`authz_custom_grants`, append-only `authz_audit`, `authz_break_glass`) | Apply — required for Phase 40 audit surface |

**Safety:** all of 033–068 are additive `CREATE TABLE IF NOT EXISTS` + new RLS policies; none `DROP`/`ALTER` a pre-existing table. The only earlier breaking migration is **027** (compliance RLS) which must have been applied after 026 — verify it is present before relying on soft-delete/audit.

**Invariant (verified & guarded by test):** no migration authored after 048 reads `auth.users` inside a policy (`pilot-role-access.test.ts` enforces this going forward).

### Apply procedure
1. Snapshot / backup the database.
2. Run `list_migrations` (or inspect `supabase_migrations`) to see what is already applied.
3. Apply the missing files **in numeric order**, one at a time.
4. Re-run the app's login + invite flow (048 sanity), a dispense (033/034), a radiology order→sign (067), and open `/admin/authorization` (068).

---

## 6. Smoke-test checklist (run after every deploy)

- [ ] Log in as each of the 8 roles; confirm the sidebar shows only that role's modules (see `pilot-role-checklist.md`).
- [ ] Register a patient (reception) → appears in patient list.
- [ ] Create an appointment → check-in on the queue → **Start consultation**.
- [ ] In the consultation: create a prescription, order a lab test, **order imaging**, generate an invoice.
- [ ] Pharmacy: dispense the prescription → print receipt (only the receipt prints, not the app).
- [ ] Lab: collect sample → enter result → doctor reviews.
- [ ] Radiology (doctor+radiology): open worklist → the order is there → dictate → structure → **sign** → report appears in the patient chart.
- [ ] Billing: record a payment → print receipt (scoped) and download PDF.
- [ ] Admin: create a user with a temp password → that user is force-redirected to change password on next navigation.
- [ ] Confirm a cashier cannot open a consultation; a receptionist cannot see medical notes; a lab tech cannot see finance.
- [ ] Print an invoice/prescription containing an apostrophe in the patient name — layout stays intact (HTML-escape check).

---

## 7. Performance notes

- **Fixed:** the pharmacy landing page's "dispensed today" KPI no longer scans the whole dispensing history — it is bounded to start-of-day.
- **Verified fine:** dashboard analytics (single RPC), radiology worklist (batched staff-name lookup, no N+1), notifications (bounded `.limit(20)`), inventory/catalog detail hooks (only mounted inside single-selection dialogs).
- **Future (not a pilot blocker):** add `.limit()` + range pagination to `useLabOrders`, `useInvoices`, `usePrescriptions`, `useAppointments` (calendar mode). Safe at pilot volumes; revisit before large historical datasets accumulate.

---

## 8. Rollback checklist

CHMS deploys are immutable Vercel builds; rollback is fast and low-risk.

- [ ] **App code:** in Vercel, promote the previous READY production deployment (instant). Or `git revert <sha> && git push` to roll forward a clean revert.
- [ ] **Migrations:** all pending migrations are **additive** — a code rollback does not require a schema rollback (older code simply ignores the new tables). Do **not** drop the new tables to "undo"; leave them.
- [ ] **Feature-level:** AI features are gated by `useClinicConfig().ai(...)` — disable in clinic settings without a deploy if a copilot misbehaves.
- [ ] **Auth incident:** if a permission looks wrong, the DB RLS is still the boundary — a UI mistake cannot grant DB access. Correct the matrix (`src/lib/authz/matrix.ts`) and redeploy.
- [ ] Communicate: note which deployment SHA is live before and after.

---

## 9. Training checklist (per role, ~15 min each)

- [ ] **Reception:** register patient, book appointment, check-in to queue, take front-desk payment.
- [ ] **Nurse:** open a consultation, record vitals, hand off to doctor.
- [ ] **Doctor:** consultation workspace, prescribe (with safety alerts), order lab, **order imaging**, use the specialty copilot (read-only), sign.
- [ ] **Radiologist (doctor+radiology):** worklist, dictation (French voice or type), structure, review, **sign**, amend/version.
- [ ] **Lab technician:** worklist, collect sample, print sample label, enter & verify results.
- [ ] **Pharmacist:** dispensing queue, scan/verify (FEFO), dispense, print receipt, cycle count.
- [ ] **Cashier:** invoices, record full/partial payment, print & PDF receipt.
- [ ] **Admin:** onboard users (temp password), manage settings, workforce dashboard & credentials, read the Authorization matrix at `/admin/authorization`.
- [ ] **Super admin:** platform activity & reliability (aggregate only).
- [ ] Everyone: language toggle (fr/en), forced password change on first login.

---

See also: `pilot-role-checklist.md` (what each role sees / must not see + test accounts) and `pilot-demo-script.md` (a runnable demo story).
