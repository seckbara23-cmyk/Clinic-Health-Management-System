# CHMS — Pilot Role Checklist (Phase 41)

What each role **should** and **should NOT** see. This mirrors the Enterprise Authorization default matrix (`src/lib/authz/matrix.ts`) and is enforced in the UI by `can()` and in the database by RLS. The expectations below are also asserted automatically in `src/lib/__tests__/pilot-role-access.test.ts`.

> **Golden rules (STOP conditions):** no technician sees finance · no cashier sees clinical notes · no receptionist sees protected medical notes · no super_admin sees psychiatry notes by default · psychiatry stays inside the care team · radiology signing = radiologist/admin only · AI never exceeds the user's own access.

---

## Test accounts needed

Create one account per role in the pilot clinic (via `/admin/users`, temp-password method), plus one **doctor with primary specialty = `radiology`** to act as the radiologist, and (optionally) one doctor with a non-radiology specialty to prove signing isolation. One `super_admin` already exists at the platform level.

| Account | Role | Notes |
|---------|------|-------|
| recept@pilot | receptionist | front desk |
| nurse@pilot | nurse | vitals/triage |
| doctor@pilot | doctor | general practice |
| radiologist@pilot | doctor + specialty `radiology` | signs radiology reports |
| labtech@pilot | lab_technician | lab worklist |
| pharm@pilot | pharmacist | dispensing |
| cashier@pilot | cashier | payments |
| admin@pilot | admin | clinic admin / HR / finance |
| (platform) | super_admin | platform ops only |

---

## Per-role expectations

### Receptionist
- **Sees:** Dashboard, Patients (create/edit demographics), Queue, Appointments (create/reschedule/cancel), Billing (front-desk view), Settings. Insurance number, National ID.
- **Does NOT see:** Consultations, prescriptions, lab, radiology, pharmacy, finance approval, HR/salary, medical history, psychiatry notes, AI copilots.

### Nurse
- **Sees:** Dashboard, Patients, Queue, Appointments, Consultations (open, record vitals), create prescriptions/orders on assigned patients, Lab (view), pharmacy catalog, Documents, medical history, **psychiatry notes (care team)**, Settings.
- **Does NOT see:** Finance, HR/salary, billing, consultation **sign**, administration, AI copilots (clinician copilot is doctor-scoped).

### Doctor
- **Sees:** Dashboard, Patients, Queue, Appointments, Consultations (create/edit/**sign**), Prescriptions, Lab (view/create), **Radiology (view/order/report)**, pharmacy catalog, Billing (view), Documents (create/print), **AI copilots**, medical history, **psychiatry notes**, Settings.
- **Does NOT see:** Finance, HR/salary, administration, workforce, analytics/executive metrics.
- **Radiology signing:** only if primary specialty = `radiology`.

### Radiologist (doctor + specialty `radiology`)
- Everything a doctor sees, **plus** authority to **sign** radiology reports (`radiology.sign`). A non-radiology doctor cannot sign.

### Lab technician
- **Sees:** Dashboard, Lab worklist (view / result entry / verify), Settings.
- **Does NOT see:** Finance, HR, billing, consultations, prescriptions, pharmacy dispensing, radiology, patients list, AI clinical copilots. **AI data access = laboratory only.**

### Pharmacist
- **Sees:** Dashboard, Pharmacy (dispense / inventory / reports / catalog / scan), Inventory (view), Settings.
- **Does NOT see:** Finance, HR, billing, consultations, radiology, medical history, psychiatry notes, AI clinical copilots.

### Cashier
- **Sees:** Dashboard, Patients (read), Billing (view + record payment), Settings. Insurance number, financial details.
- **Does NOT see:** Consultations, prescriptions, lab, radiology, pharmacy, finance approval, HR/salary, medical history, psychiatry notes, AI. **AI data access = none.**

### Admin (clinic administrator)
- **Sees:** Everything operational within the clinic — patients, queue, appointments, consultations (view/edit), lab, radiology (view), pharmacy, billing, **finance (view + approve)**, inventory, reports, documents, **workforce & HR (incl. salary)**, settings, administration. Part of the **care team → psychiatry notes**. Executive AI metrics.
- **Does NOT see:** other clinics' data (tenant-isolated); AI copilots panel (clinician-scoped).

### Super admin (platform owner)
- **Sees:** Platform Activity, Reliability, Clinics, Clinic Requests, Users, Platform Billing — all **aggregate / lifecycle only**. Operational modules are visible for support but clinical data is RLS-scoped.
- **Does NOT see (by design):** confidential **psychiatry notes** (not a member of any clinic's care team); the clinician **AI copilots** panel (zero-tool for AI). Never sees another clinic's patient records as content.

---

## Quick verification grid

| Capability | super | admin | doctor | nurse | recept | cashier | lab | pharm |
|-----------|:----:|:----:|:-----:|:----:|:-----:|:------:|:--:|:----:|
| Consultations | view | view | ✅ | view | — | — | — | — |
| Prescribe | — | — | ✅ | ✅ | — | — | — | — |
| Finance view | ✅ | ✅ | — | — | — | — | — | — |
| Billing payment | ✅ | ✅ | view | — | view | ✅ | — | — |
| HR / salary | ✅ | ✅ | — | — | — | — | — | — |
| Psychiatry notes | — | ✅ | ✅ | ✅ | — | — | — | — |
| Radiology sign | ✅ | ✅ | radiology only | — | — | — | — | — |
| Dispense | ✅ | ✅ | — | — | — | — | — | ✅ |
| AI domains | exec+clinical+lab+radiology+pharmacy | +confidential | clinical+lab+radiology+confidential | clinical+confidential | — | — | lab | — |

("view" = read-only visibility; "—" = hidden/denied; "✅" = full action.)
