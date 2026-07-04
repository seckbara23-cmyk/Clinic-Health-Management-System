# Phase 14 — Specialty Workspace Framework
## Architecture Design Document (for review & approval — NOT implementation)

**Status:** Proposed · **Author:** Architecture · **Date:** 2026-07-04
**Scope:** Architecture only. No code, schema, or deployment in this phase.

---

## 0. Executive summary

CHMS today is a single, well-factored EMR: shared Patients, Timeline, AI engine,
Laboratory, Pharmacy, Billing, Appointments, multi-tenant RLS and Audit. Phase 14
turns it into a **Specialty-Driven Healthcare Operating System** *without forking
the product*. The shared modules stay single implementations. **Only the
workspace composition changes** per role + specialty + clinic + person.

The mechanism is a **Workspace Personalization Engine**: a pure composition
pipeline that resolves *what a user sees* from four layers, plus an **extensible
registry** (a direct sibling of the existing `settings/registry.ts`) that lets a
new specialty plug in as **one definition file + a one-line registration**, with
**no page, resolver, or core rewrite**.

Guiding constraints, inherited and non-negotiable:
- No duplicated modules. Patients/Lab/Pharmacy/Billing/Appointments remain shared.
- Additive database only (the discipline used across migrations 024–036).
- Multi-tenancy, RLS, permissions, audit preserved. **No `service_role` in client.**
- AI stays deterministic + operational only. **No diagnosis, no treatment advice.**
- Zero regression: an un-configured clinic behaves exactly like CHMS does today.

---

## 1. Complete architecture

### 1.1 The four composition layers

```
Layer 1  IDENTITY        role (doctor/nurse/pharmacist/lab_tech/receptionist/cashier/admin)
Layer 2  SPECIALTY       primary specialty + sub-specialty (pediatrics, OB/GYN, cardiology…)
Layer 3  CLINIC CONFIG   enabled modules, hospital-vs-clinic, protocols, branding, allowed specialties
Layer 4  PERSONAL PREFS  dashboard widgets & order, quick actions, note style, language, favorites
```

Each layer **narrows or personalizes** the layer above. Precedence and authority
are explicit (§1.3) so hospital governance (Layer 3) can constrain personal
choice (Layer 4).

### 1.2 The pipeline

```
Login / session
   │  (role, userId, clinicId)
   ▼
Identity  ─────────────►  role baseline capabilities
   │
   ▼
Specialty Registry ─────►  SpecialtyDefinition (widgets, actions, templates, timeline types, AI tools)
   │
   ▼
Clinic Config (clinic_settings) ─►  enabled modules, allowed specialties, hospital mode, locks
   │
   ▼
Personal Preferences (user_preferences) ─►  widget order/visibility, favorite actions, note style
   │
   ▼
resolveWorkspace()  ── pure function ──►  WorkspaceSpec
   │
   ▼
<Workspace spec={…}/>  ── generic renderer ──►  Personalized dashboard / consultation / actions
```

The architecture deliberately mirrors the **proven Settings Hub pattern**
(Phase 12): *static capability definitions in a registry* + *stored
selection/config data* + *a generic renderer*. It reuses the **tolerant-consumer
pattern** (Phase 13 `useClinicConfig`) so unset config always falls back to a
safe default.

### 1.3 Authority & precedence rules

| Concern | Owned by | Can be overridden by | Rule |
|---|---|---|---|
| Which specialties exist (capability) | **Registry (code)** | nobody | Static, version-controlled |
| Which specialties/modules are enabled | **Clinic (Layer 3)** | — | Governance / licensing |
| Locked (mandatory) widgets/actions | **Clinic (Layer 3)** | user cannot remove | Compliance |
| Widget order & optional visibility | **User (Layer 4)** | within clinic-allowed set | Personalization |
| Note style, language, favorites | **User (Layer 4)** | — | Personal |

**Resolution = intersection then ordering:** the effective widget/action set is
`registry(specialty) ∩ clinic.enabled`, with clinic-locked items forced in, then
ordered/toggled by user prefs. This single rule is the whole governance model and
is unit-testable.

### 1.4 Zero-regression default

Every user without a configured specialty resolves to the `general_practice`
definition, whose WorkspaceSpec reproduces **today's** dashboard, quick actions
and consultation editor exactly. The framework can therefore ship "empty" (only
general practice) with no visible change, and specialties light up incrementally.

---

## 2. Registry design

A specialty is a self-contained definition — the same shape philosophy as
`SettingsSection` and the AI `AITool`. Nothing about a specialty is hardcoded in
a page; pages read the registry.

### 2.1 Core types (illustrative — design, not final code)

```ts
// src/lib/specialties/types.ts
export type SpecialtyId =
  | 'general_practice' | 'internal_medicine' | 'family_medicine'
  | 'pediatrics' | 'obgyn' | 'emergency' | 'general_surgery' | 'orthopedics'
  | 'cardiology' | 'dermatology' | 'ent' | 'ophthalmology' | 'psychiatry'
  | 'neurology' | 'oncology' | 'urology' | 'nephrology' | 'radiology'
  | 'dentistry' | 'physiotherapy' | 'nutrition' | 'mental_health'

export interface SpecialtyDefinition {
  id: SpecialtyId
  category: 'primary_care' | 'medical' | 'surgical' | 'diagnostic' | 'support'
  labelKey: string
  icon: string                          // resolved to a lucide icon in the renderer
  roles: Role[]                         // usually ['doctor','nurse','admin']
  requiresModules: ModuleId[]           // e.g. ['growth','vaccination'] — see §3.4
  defaultWidgets: WidgetRef[]           // ids + default order + clinic-lockable flag
  quickActions: QuickActionRef[]        // ids into the action registry
  consultationTemplates: TemplateRef[]  // ids into the template registry
  timelineEventTypes: TimelineTypeId[]  // which clinical-entry kinds show on the timeline
  aiTools: string[]                     // AITool ids feeding this specialty's briefing
  navigation?: NavExtra[]               // optional extra nav entries (all still RLS-gated)
  schemaVersion: number                 // capability negotiation (§6.3)
}
```

### 2.2 Four sibling registries (separation of concerns)

| Registry | File(s) | Contributes | Analogy in codebase |
|---|---|---|---|
| **Specialty** | `src/lib/specialties/<id>.ts` + `index.ts` | the definition above | `settings/registry.ts` |
| **Widget** | `src/lib/widgets/registry.ts` | `{ id, labelKey, component, size, roles, dataDeps }` | AI tool registry |
| **Quick-Action** | `src/lib/actions/registry.ts` | `{ id, labelKey, icon, kind: 'navigate'|'dialog'|'template', target }` | existing QuickActions props |
| **Template** | `src/lib/templates/registry.ts` | consultation/assessment/procedure/report templates (§7) | Settings field groups |

Widgets and actions are **shared, generic components** registered once; a
specialty *references* them by id. Specialty-specific widgets (e.g. a growth
chart) are also registered here but only referenced by relevant specialties — the
code still lives in one place, owned by the platform, not the specialty.

### 2.3 Registration = one line

```ts
// src/lib/specialties/index.ts
export const SPECIALTIES: SpecialtyDefinition[] = [
  generalPractice,   // default / baseline
  pediatrics,        // ← adding a specialty is appending here
  obgyn,
  // …future specialties plug in with no other change
]
export const getSpecialty = (id?: string) =>
  SPECIALTIES.find(s => s.id === id) ?? generalPractice   // safe fallback
```

Exactly like `ALL_TOOLS` and `SETTINGS_SECTIONS`. A **registry-integrity test**
(unique ids; every `WidgetRef`/`QuickActionRef`/`TemplateRef`/`aiTool` resolves)
guards the contract — mirroring the existing settings/lab registry tests.

---

## 3. Database strategy

**Principle: additive-only, tolerant, JSONB-first for the long tail, promote hot
domains to typed tables.** Nothing existing is altered. Every new table follows
the established RLS shape (`clinic_id = get_clinic_id()` + `get_user_role()`), and
consuming hooks degrade gracefully when a table is absent (Phase 13 pattern), so
each migration can ship independently with no coupling.

### 3.1 `user_preferences` (personalization store)

Mirrors `clinic_settings` but keyed to the **user within a clinic** (a doctor at
two clinics has two preference rows).

```
user_preferences (
  user_id     uuid,  clinic_id uuid,
  preferences jsonb,          -- widget order, favorite actions, note style, language, onboarding flags
  primary key (user_id, clinic_id)
)
RLS:  SELECT/INSERT/UPDATE where user_id = auth.uid() AND clinic_id = get_clinic_id()
```

### 3.2 `user_profiles` additive columns (queryable identity)

`primary_specialty text`, `sub_specialty text`, `department text` — nullable,
additive. Queryable (e.g. "cardiologists in this clinic") without unpacking JSONB.
Everything else personal lives in `user_preferences.preferences` JSONB.

### 3.3 `clinical_entries` — the generic, plug-in clinical store ★

The core of "add a specialty without a migration." A single, kind-discriminated,
JSONB-payload table. Growth points, ANC visits, vaccinations, ECG readings,
extended vitals — all are `clinical_entries` rows.

```
clinical_entries (
  id uuid, clinic_id uuid, patient_id uuid, consultation_id uuid null,
  kind text,          -- 'growth' | 'anc_visit' | 'vaccination' | 'ecg' | 'wound_photo_ref' | …
  data jsonb,         -- validated against the specialty template's zod schema at write time
  recorded_by uuid, recorded_at timestamptz, deleted_at timestamptz null
)
RLS: clinic-scoped read for clinical roles; write by roles the template permits.
indexes: (clinic_id, patient_id, kind, recorded_at desc)
```

- **New specialty → new `kind` values → no migration.** The template registry
  supplies a **zod schema** per kind, so JSONB is validated on write (constraints
  without DDL) and typed on read.
- The patient timeline (`mergePatientTimeline`) gains one more source: entries of
  the enabled `timelineEventTypes` become timeline events (icons/labels from the
  template registry). Fully additive to the existing discriminated union.

### 3.4 Promotion path (hot domains → typed tables)

When a domain needs heavy querying, reporting, cross-patient analytics, or DB
constraints (e.g. **vaccination schedules**, **growth percentile lookups**), it
graduates from `clinical_entries` to a dedicated typed table — *additively*, with
a backfill view. The registry declares `storage: 'generic' | 'typed'` per kind, so
the read path is unchanged. Start generic, promote on evidence. This avoids both
premature table sprawl and JSONB-forever.

### 3.5 `clinical_documents` + Storage (media)

Wound photos, ECG/echo images, ultrasound, radiology (Radiora) references:

```
clinical_documents (id, clinic_id, patient_id, kind, storage_path, metadata jsonb, uploaded_by, created_at, deleted_at)
```

Files in a Supabase **Storage** bucket under a clinic-scoped path with Storage RLS
mirroring row RLS. No service_role — signed URLs minted server-side in an API
route (the established server pattern). Radiology reuses this + Radiora principles.

### 3.6 Clinic-level configuration (no new table)

Reuse `clinic_settings` (Phase 12): new sections `specialties` (allowed/enabled
list, hospital-vs-clinic mode), `modules` (enabled optional modules), `protocols`.
Consumed via `useClinicConfig` with safe fallbacks. **Zero migration** — data only.

### 3.7 Migration inventory (all additive)

| Id | Adds | Depends on |
|---|---|---|
| M-A | `user_preferences` + `user_profiles` specialty columns | — |
| M-B | `clinical_entries` + RLS + indexes | — |
| M-C | `clinical_documents` + Storage bucket + Storage RLS | — |
| (data) | `clinic_settings` sections: specialties / modules / protocols | Phase 12 (036) |

Each guarded `IF NOT EXISTS`; each shippable alone; nothing consumes a table
until its feature pack lands.

---

## 4. Workspace engine

A **pure, deterministic, unit-tested** resolver — the same character as
`lab-workflow.ts`, `settings/logic.ts`, `patient-intel.ts`.

```ts
// src/lib/workspace/resolve.ts  (pure)
export interface WorkspaceContext {
  role: Role
  specialty: SpecialtyId
  clinic: { enabledModules: ModuleId[]; allowedSpecialties: SpecialtyId[]; locks: LockSet; hospitalMode: boolean }
  prefs: { widgetOrder: string[]; hiddenWidgets: string[]; favoriteActions: string[]; noteStyle: NoteStyle }
}

export interface WorkspaceSpec {
  dashboardWidgets: ResolvedWidget[]     // ordered, visible, role+module-permitted
  quickActions: ResolvedAction[]
  consultationTemplate: ResolvedTemplate
  timelineEventTypes: TimelineTypeId[]
  aiBriefingTools: string[]
  navigation: NavExtra[]
}

export function resolveWorkspace(ctx: WorkspaceContext): WorkspaceSpec
```

Resolution algorithm (all pure, no I/O):
1. **Baseline** from `role` (a doctor sees clinical widgets; a cashier sees
   financial ones — reusing the role capability idea from `patient-intel` /
   `lab-workflow`).
2. **Overlay** `getSpecialty(specialty).defaultWidgets/quickActions/templates/…`.
3. **Filter** by `clinic.enabledModules` and `requiresModules`; drop anything the
   clinic disabled; **force-include** clinic-locked items.
4. **Personalize**: apply `prefs.widgetOrder` / `hiddenWidgets` / `favoriteActions`
   within the allowed set; pick the template variant matching `noteStyle`.
5. Return the ordered `WorkspaceSpec`.

**Renderer:** `<Workspace spec/>` maps `widget.id → WIDGET_REGISTRY component`,
`action.id → handler`, `template → the existing consultation section editor`. The
dashboard, consultation, and quick-action bars become **thin shells** that render
the spec — satisfying "no hardcoding inside pages." Existing pages are refactored
to this shell *without behavior change* for general practice (verified by tests).

---

## 5. Personalization engine

### 5.1 First-run onboarding wizard (doctors)

Triggered when `user_preferences.onboarding_completed` is falsy. Collects, per the
brief: primary specialty, sub-specialty, department, languages, consultation style
(SOAP / narrative / structured / voice-first), modules used, favorite widgets,
favorite quick actions. Writes `user_profiles.primary_specialty/…` + a
`user_preferences` row. Skippable → general practice.

### 5.2 "My Workspace" preferences surface

A **personal preferences registry** analogous to the settings registry, surfaced
as a section in the Administration Hub (Phase 12) under the user's own scope.
Dashboard widget **drag-and-drop ordering** persists an id array in
`user_preferences`. Governance: the editable set is `clinic-allowed ∖ locked`.

### 5.3 Multi-clinic & fallbacks

Preferences are `(user_id, clinic_id)`-scoped. Missing prefs → specialty defaults;
missing specialty → general practice. Everything degrades to today's UX.

---

## 6. Plugin framework

### 6.1 The contract

To add a specialty, a contributor delivers **only**:
1. `src/lib/specialties/<id>.ts` exporting a `SpecialtyDefinition`.
2. Its **templates** (registry entries + zod schemas).
3. Any **new widgets** (registry entries + components) not already shared.
4. Any **new quick actions** (registry entries + handlers).
5. Optional **AI tools** (following the `AITool` contract).
6. One line in `SPECIALTIES` (and, if new, the widget/action/template arrays).

**No** change to the dashboard, resolver, timeline, pages, or other specialties.

### 6.2 Isolation & safety

- Specialty files import only shared registries + types; they cannot reach into
  core rendering or another specialty. Core resolves purely by id lookup.
- Unknown ids never crash: `getSpecialty`/widget/action lookups fall back safely
  (the tolerant pattern), so a partially-shipped pack degrades, not breaks.

### 6.3 Capability negotiation

Each definition declares `requiresModules` and `schemaVersion`. The resolver skips
capabilities the clinic hasn't enabled or whose backing table/`kind` isn't present
yet (checked via tolerant hooks). A specialty can therefore be merged before its
DB migration is applied and simply stay dormant until enabled — matching the
"tables land, features light up later" model from Phases 10A–12.

### 6.4 Test harness

Registry-integrity + resolver tests are the plugin gate: unique ids, every
reference resolves, precedence rules hold, `general_practice` reproduces current
behavior, and each specialty's templates/AI-tools pass the **no-diagnosis-wording**
scan (extending the existing guard tests).

---

## 7. Specialty templates

Every specialty provides typed templates that **compose existing capabilities** —
they do not fork the consultation model.

```ts
export interface ConsultationTemplate {
  id: string; specialty: SpecialtyId; noteStyle: NoteStyle
  sections: TemplateSection[]           // ordered
}
export interface TemplateSection {
  id: string; labelKey: string
  fields: TemplateField[]               // each maps to a target (below)
}
export interface TemplateField {
  key: string; type: FieldType; labelKey: string
  target:                               // where the value lives — NO new columns
    | { store: 'consultation'; column: 'chief_complaint'|'symptoms'|'diagnosis'|'treatment_plan'|'notes' }
    | { store: 'clinical_entry'; kind: string }     // structured → clinical_entries.data (zod-validated)
  required?: boolean
}
```

- **Core narrative** fields map to the **existing consultation columns** (no
  schema change — the same mapping the Phase 9 workspace already uses).
- **Structured** fields (growth measurement, ANC parameters, vaccination record)
  write to `clinical_entries` under the template's `kind`, validated by the
  template's zod schema.
- Template kinds requested in the brief (illustrative):
  - **OB/GYN:** ANC Visit, Delivery, Postpartum, Ultrasound (report + document).
  - **Pediatrics:** Well-Child, Sick Visit, Vaccination, Growth Assessment.
  - **Dermatology:** Skin Lesion, Procedure, Follow-up (+ wound photo document).
- **Assessment / Procedure / Report** templates share the same shape; the Report
  template drives print/PDF (reusing the existing print + `openLabResultPDF`
  infrastructure).

---

## 8. Quick actions & dashboard widgets

- **Quick actions** are resolved from the specialty (general → New Consultation /
  Prescription / Lab / Invoice; OB → ANC Visit / Ultrasound / Delivery /
  Admission; Pediatrics → Vaccination / Growth Assessment / Nutrition Review /
  School Certificate). Each is a registry entry whose `kind` is `navigate`,
  `dialog`, or `template` — reusing the existing in-workspace dialog pattern
  (Phase 9/10) so nothing new is invented for the common cases.
- **Widgets** are generic, shared, and role/module-gated: Today's Patients,
  Waiting Queue, AI Brief, Lab Results, Radiology, Timeline, Follow-ups, Revenue,
  Appointments, Critical Alerts, plus specialty widgets (Growth Chart, ANC Due,
  BP Trend). Widgets declare `dataDeps` (react-query keys) so the dashboard
  **shares cached queries** (the dedup discipline proven in Phases 9/13) and
  below-the-fold widgets can lazy-load.

---

## 9. AI integration strategy

Reuse the deterministic provider, tool registry, insights API, and the Phase 12
executive-briefing composition. **Specialties add operational read-only tools**,
never clinical judgment.

- New `AITool`s (RLS-scoped, role-gated, cited) per specialty, e.g.
  `get_vaccinations_due`, `get_anc_due`, `get_growth_review_due`,
  `get_ecg_pending`, `get_echo_available`, `get_longest_waiting`,
  `get_pending_imaging`. Each emits `count` + `warnings` + `citation` exactly like
  today's tools; they feed the specialty briefing.
- The specialty briefing is the existing `buildExecutiveBriefing` /
  `InsightsPanel` composition filtered to `spec.aiBriefingTools`. `ALERT_RULES`
  and categories extend additively.
- **Invariants preserved & tested:** no diagnosis, no treatment, operational only,
  confidence badges, sources preserved. The Phase-13 gates apply — AI is gated by
  `useClinicConfig().ai(feature)` and the no-service-role / no-diagnosis tests
  extend to the new tools and templates.
- Radiology follows Radiora principles on top of `clinical_documents`.

---

## 10. Incremental implementation roadmap

Each step is independently shippable, additive, and zero-regression. **No step
ships user-visible change until the one before it is green.**

| Step | Deliverable | Visible change |
|---|---|---|
| **P14.0** | *This document* — architecture & approval gate | none |
| **P14.1** | Types + 4 registries with **only** `general_practice`; pure `resolveWorkspace` + tests; `user_preferences` migration (M-A) + tolerant hooks | none (general default == today) |
| **P14.2** | `<Workspace>` renderer + widget system on the dashboard; drag-and-drop ordering; "My Workspace" prefs surface | dashboard becomes widget-driven; defaults identical |
| **P14.3** | Onboarding wizard + specialty selection; `clinical_entries` (M-B) + generic timeline integration | first-run wizard; timeline gains structured entries |
| **P14.4** | **Reference specialty pack: Pediatrics** (growth widget/template/timeline + `get_vaccinations_due`) — proves the plugin model end-to-end | pediatrics workspace for opted-in clinics |
| **P14.5** | OB/GYN, then Cardiology, Emergency … one registry pack each | per-specialty workspaces |
| **P14.6** | `clinical_documents` (M-C) + Radiology/Radiora + media templates | imaging/photo workflows |

Governance: every specialty pack ships **behind a clinic-settings enable flag**;
a clinic sees nothing new until an admin enables it.

---

## 11. Risks & mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Over-engineering / scope explosion** (22 specialties, 4 layers) | High | High | Ship the framework "empty" (general practice = today) first; add specialties on demand; YAGNI on unused layers; each pack tiny & independently reviewable |
| 2 | **JSONB clinical data lacks constraints/queryability** | Med | Med | Zod schema per `kind` validates on write; **promotion path** to typed tables for hot domains (§3.4); indexed `(patient_id, kind)` |
| 3 | **Clinical scope-creep into diagnosis/treatment** | Med | **Critical** | Templates are operational scaffolds only; extend no-diagnosis tests to templates + AI tools; clinical/legal review of any specialty content before enablement |
| 4 | **RLS / tenant-leak on new tables** | Low | **Critical** | Reuse exact `get_clinic_id()`/`get_user_role()` shape; `user_preferences` scoped by `auth.uid()`; Storage RLS mirrors row RLS; the Phase-13 repo-wide no-service-role guard test covers new files; no service_role in client |
| 5 | **Config precedence confusion (4 layers)** | Med | Med | One pure, deterministic `resolveWorkspace` with the single intersection-then-order rule (§1.3), fully unit-tested |
| 6 | **Dashboard performance (many widgets → many queries)** | Med | Med | Widgets declare `dataDeps`; share react-query keys (dedup, proven); lazy-load below-the-fold; cap default widget count; skeletons via the Phase-13 state components |
| 7 | **Migration risk / half-applied packs** | Low | Med | Additive-only, `IF NOT EXISTS`, tolerant hooks; capability negotiation (§6.3) keeps unmigrated specialties dormant, not broken |
| 8 | **Multi-clinic doctor divergence** | Low | Low | Preferences keyed `(user, clinic)` |
| 9 | **Regulatory variance across Senegal / West Africa** | Med | High | Specialties enabled per clinic; content localized (fr/en already); consent + audit already in place; audit extends to `clinical_entries`/documents; data residency reviewed per market |
| 10 | **Registry drift / broken references** | Med | Med | Registry-integrity tests as the merge gate (unique ids; every ref resolves) |
| 11 | **Refactor of existing pages to the renderer introduces regressions** | Med | High | Refactor behind the `general_practice` spec with golden tests asserting identical output; ship P14.2 with defaults unchanged |

---

## 12. Architecture summary (one paragraph)

A four-layer composition pipeline (**role → specialty → clinic → person**) feeds a
**pure `resolveWorkspace` engine** that emits a `WorkspaceSpec`, rendered by
generic shells. Capabilities live in **four sibling registries** (specialty,
widget, action, template) modeled on the existing Settings/AI registries; a new
specialty is a **definition file + one-line registration**, no core edits.
Clinical data plugs in through a **generic, zod-validated `clinical_entries`
store** (promoting hot domains to typed tables), with **media** in
`clinical_documents` + Storage. Personalization persists in a per-(user, clinic)
`user_preferences` store; clinic governance constrains it. AI stays deterministic
and **operational-only**, adding read-only specialty tools that feed the existing
briefing. Everything is **additive, tenant-scoped, RLS-preserving, tolerant, and
zero-regression** — CHMS becomes specialty-aware without becoming many apps.

---

## 13. Open questions for the review board

1. **`clinical_entries` (generic-first) vs typed-tables-first** — approve the
   hybrid + promotion path, or prefer typed tables per domain from day one?
2. **Onboarding placement** — full-screen wizard on first login vs a dismissible
   setup card + defer to "My Workspace"?
3. **Governance strength** — how much can a clinic *lock* vs a doctor personalize
   (default lock posture)?
4. **Voice-first note style** — in-scope for P14.x or a separate track (needs
   speech infra + Senegal-language considerations)?
5. **Specialty content ownership & clinical sign-off** — who authors/approves each
   specialty's templates for medico-legal safety?
6. **Radiology/Radiora** — integrate as a specialty pack (P14.6) or a parallel
   track?

> **This phase delivers the architecture only. No implementation begins until this
> document is reviewed and approved.**
