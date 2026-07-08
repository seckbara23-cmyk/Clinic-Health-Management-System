# CHMS — Pilot Demo Script (Phase 41)

A runnable ~20-minute demo story for a Senegalese clinic. Each step names the **role**, the **screen**, and the **action**, so a facilitator can drive it live. Log in/out per role, or use two browsers side by side. All content is French-first.

**Scenario:** _Mme Awa Diop arrives at Clinique Keur Santé (Dakar) with a cough and needs a chest X-ray._

---

## 0. Setup (Admin, 2 min)
- Log in as **admin@pilot**.
- Confirm the clinic name/logo in the sidebar (tenant is server-seeded — no generic shell).
- Toggle language FR ⇄ EN to show French-first UI; leave it on **Français**.
- (Once) create the pilot staff accounts via **Administration → Users → temp password**; show the revealed temporary password and that the user will be forced to change it.

## 1. Reception — registration & appointment (Receptionist, 3 min)
- Log in as **recept@pilot**. Note the sidebar shows only reception modules (no consultations, no finance).
- **Patients → Nouveau patient:** register _Awa Diop_ (phone `+221…`, CNI, insurance number).
- **Rendez-vous → Nouveau:** book a consultation for today with the doctor.
- **File d'attente:** check her in → she appears as waiting.

## 2. Nurse — vitals (Nurse, 2 min)
- Log in as **nurse@pilot**.
- Open the queued patient → **Start consultation** → record vitals (temp, BP, SpO₂) in the Vitals form.
- Point out: the nurse can record vitals and read medical history, but the **Sign** action and finance are absent.

## 3. Doctor — consultation, prescription, lab, imaging (Doctor, 5 min)
- Log in as **doctor@pilot**, open the same consultation.
- Fill chief complaint / exam / assessment; show the **specialty copilot** panel (read-only reminders — never a diagnosis).
- **Quick actions:**
  - **Ordonnance** → add a medication; show the live **safety alerts** (allergy/duplicate/stock).
  - **Analyses** → order a lab test.
  - **Imagerie** (new in Phase 41) → modality **Radiographie**, exam "Radio thoracique", priority Routine, indication "toux persistante" → **Demander l'imagerie**. This creates the order that feeds the radiology worklist.
  - **Facture** → generate a consultation invoice.
- **Sign** the consultation.

## 4. Lab — sample & result (Lab technician, 2 min)
- Log in as **labtech@pilot** → **Laboratoire**.
- Open the order → **collect sample** → print the sample label (note: the code is human-readable; the bar graphic is decorative).
- Enter the result value + flag → mark complete. (Doctor later reviews it from the chart.)

## 5. Radiology / Radiora — the headline flow (Radiologist, 4 min)
- Log in as **radiologist@pilot** (doctor + specialty `radiology`) → **Radiologie**.
- The **worklist** shows Awa's chest X-ray order (this is what step 3's "Imagerie" created).
- Open it → **dictate in French** (voice or type) → **Structure into sections** (deterministic; it never invents findings) → review/edit.
- **Sign** the report (confirm dialog). Show that a signed report is **immutable** — further changes require an **amend** that creates a new version.
- Switch back to the **doctor** / patient chart: the signed report now appears under the consultation.
- Prove isolation: as a **non-radiology doctor**, the Sign button is unavailable.

## 6. Pharmacy — dispensing (Pharmacist, 2 min)
- Log in as **pharm@pilot** → **Pharmacie**.
- Awa's active prescription is in the dispensing queue → **scan/verify** (FEFO batch) → **dispense**.
- **Print receipt** — show that only the receipt prints, not the whole app (scoped print, fixed in Phase 41).

## 7. Billing — payment & receipt (Cashier, 2 min)
- Log in as **cashier@pilot** → **Facturation**.
- Open Awa's invoice → **record payment** (cash / mobile money) → **print receipt** (scoped) and **download PDF**.
- Show a name with an apostrophe prints cleanly (HTML-escaping fix).
- Point out the cashier cannot open a consultation or see clinical notes.

## 8. Admin & platform (Admin / Super admin, 2 min)
- As **admin@pilot**: open **Workforce** → an employee profile → add a **credential** with an expiry; show the reminder. Open **Administration → Authorization** (`/admin/authorization`) — the read-only matrix proving who can do what, incl. field-level masking and AI inheritance.
- As **super_admin**: open **Platform Activity** and **Reliability** — aggregate metrics only, **no patient content**, no other clinic's data.

---

## Talking points to land
- **French-first**: entire UI, documents, and dictation default to French (`fr-SN`), spellcheck included.
- **Least privilege, enforced twice**: the UI hides what you can't do (`can()`), and the database refuses it anyway (RLS). A UI bug can never leak data.
- **Safe AI**: copilots are deterministic, read-only, and inherit your permissions — a cashier's AI sees nothing clinical; a lab tech's AI sees only lab data.
- **Radiology is assistive**: Radiora structures the radiologist's own dictation and never interprets images or auto-signs — the radiologist stays fully responsible.
- **Auditable**: sensitive access, exports, prints, signatures and financial approvals are recorded.
