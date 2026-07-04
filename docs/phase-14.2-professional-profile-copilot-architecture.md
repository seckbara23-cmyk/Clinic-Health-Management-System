# Phase 14.2 — Professional Profile & Clinical Copilot Foundation
## Architecture Design Document — **Revision 2 (review-approved)**

**Status:** Approved architecture (implementation not started) · **Author:** Architecture · **Date:** 2026-07-04
**Scope:** Architecture only. No code, no migrations, no UI changes, no deployment.
**Builds on:** Phase 14.0 (`docs/phase-14-specialty-workspace-architecture.md`) and the **shipped** Phase 14.1 foundations (`src/lib/workspace/{types,resolve}.ts`, `src/lib/{specialties,widgets,actions,templates}/*`, `resolveWorkspace`, migration `037_user_preferences.sql`).

> **Revision 2 changelog (all approved at review):** added a **Profession layer/registry** before specialties (§1); **Capability Levels** inside packs (§6); expanded **Professional Credentials** (§3); **Team‑Based Care** (§12); a fourth **Care Pathway Registry** (§8); the updated **master composition diagram** (§10.1); the six open questions are now **ratified decisions** (§23); and a **Future Scalability** conclusion (§21). Everything from Revision 1 is preserved: Specialty ≠ Copilot Pack, registry‑driven design, marketplace vision, the multi‑pack merge, the governance model, the Professional Profile concept, zero‑regression, 14.1 compatibility, PGRST201 prevention, and the roadmap (extended, not replaced).

---

## 0. Executive summary

Phase 14.1 shipped the *skeleton* (pure `resolveWorkspace()`, four capability registries, a `general_practice` baseline that reproduces today). Phase 14.2 designs the *substance*:

1. A **Healthcare‑Professional model** rooted first in a **Profession** (Doctor, Nurse, Midwife, Pharmacist, Laboratory Technologist, Radiographer, Receptionist, Cashier, Administrator — §1), then, for professions that practice specialties, a **Clinical Profile** (one primary + unlimited secondary + unlimited sub‑specialties — §4), and **Professional Credentials** metadata (§3).
2. **Clinical Copilot Packs** — the installable capability bundle (§7). Doctors enable *packs*, not random features; a pack's **manifest** contributes widgets, quick actions, templates, timeline events, reports, print forms, documentation helpers, operational AI, permissions, dependencies — and now **Capability Levels** (§6) — all via registries, never hardcoded.
3. **Four registries** — Professional, Specialty, Copilot Pack, and the new **Care Pathway** (§8) — feeding one pure composition engine, plus the shared widget/action/template/AI‑tool registries.
4. **Team‑Based Care** (§12) — multidisciplinary Team Workspaces that *compose* individual capabilities around a patient/pathway without any RLS escalation.
5. A **marketplace‑ready plugin model** (§16) — packs and pathways install like versioned plugins.

**Evolution of 14.1 (unchanged from Rev 1):** `SpecialtyDefinition` → **`CopilotPackManifest`**; `general_practice` → the always‑on `core.general_practice` pack; single‑specialty resolution → **deterministic multi‑pack merge**. With only the core pack enabled, output is byte‑identical to 14.1/today (golden‑test guaranteed).

**Non‑negotiables:** additive DB only; multi‑tenancy, RLS, permissions, audit, privacy preserved; **no `service_role` in client**; no tenant leakage; deterministic operational‑only AI (no diagnosis/treatment); and the hard codebase rule from the P0: **no two‑FK composite‑PK junction tables, surrogate PKs on join tables, FK‑hinted PostgREST embeds** (§17.6 / §19).

---

## 1. Professional Registry (the Profession layer) ★NEW

Identity now begins with **Profession** — the broadest classifier — before any specialty. This is a registry, exactly like specialties and packs: future professions plug in with one line, no core change.

```ts
type ProfessionId =
  | 'doctor' | 'nurse' | 'midwife' | 'pharmacist'
  | 'lab_technologist' | 'radiographer'
  | 'receptionist' | 'cashier' | 'administrator'

interface ProfessionDefinition {
  id: ProfessionId
  labelKey: string
  /** Maps to the platform RBAC Role (RLS/permissions unchanged). */
  role: Role
  /** Only specialty-practising professions use the specialty hierarchy (§4/§5). */
  usesSpecialties: boolean
  /** Baseline packs auto-available to the profession (e.g. pharmacist → pharmacy.core). */
  basePacks: PackId[]
  /** Which credential kinds are relevant (§3) — drives the profile form + reminders. */
  credentialKinds: CredentialKind[]
}
```

**Supported professions (initial catalog).** `usesSpecialties = true` only where clinically meaningful:

| Profession | role | usesSpecialties | Typical base packs |
|---|---|---|---|
| Doctor | doctor | ✅ | `core.general_practice` |
| Nurse | nurse | ✅ (nursing specialties) | `nursing.core` |
| Midwife | nurse¹ | ✅ (`midwifery`, women's health) | `midwifery.core` |
| Pharmacist | pharmacist | ❌ | `pharmacy.core` |
| Laboratory Technologist | lab_technician | ❌ | `laboratory.core` |
| Radiographer | (radiology role²) | ❌ | `radiology.core` |
| Receptionist | receptionist | ❌ | `reception.core` |
| Cashier | cashier | ❌ | `billing.core` |
| Administrator | admin | ❌ | `admin.core` |

> ¹ Midwife maps to the `nurse` RBAC role for now (no new RLS role) — profession is a *presentation/identity* layer over the existing role; permissions never change. ² Radiographer may reuse an existing clinical/lab role until a dedicated role is warranted. **Professions never invent RBAC roles or RLS policies** — they select an existing `Role`.

`PROFESSIONS: ProfessionDefinition[]` becomes the fifth code registry (Professional Registry). The onboarding wizard's first question is *profession*; specialty questions appear only when `usesSpecialties`.

---

## 2. Professional Profile model (identity)

Per `(user, clinic)` — the same person may have different profession/credentials/packs at different clinics. Layers additively on `user_profiles` (auth identity) — never replaces it.

```ts
interface ProfessionalProfile {
  userId: string
  clinicId: string
  profession: ProfessionId               // §1 — the root classifier
  // Identity
  displayName: string                    // mirrors user_profiles.full_name (source of truth)
  photoUrl?: string | null
  signatureDocId?: string | null         // → clinical_documents (§17.4)
  professionalTitle?: string | null
  department?: string | null
  position?: string | null
  yearsExperience?: number | null
  languages: string[]
  // Credentials (§3), clinical profile (§4), capability levels (§6)
  credentials: Credential[]
  clinical?: ClinicalProfile             // present only when profession.usesSpecialties
  packLevels?: Record<PackId, LevelId>   // §6
  onboardingCompleted: boolean
}
```

---

## 3. Professional Credentials (expanded) ★

Rich, **metadata‑only** credentialing. **No external verification is designed** (per the ratified decision, §23) — values are self‑declared and optionally clinic‑admin attested; the platform never contacts a licensing body.

```ts
type CredentialKind =
  | 'medical_license' | 'board_certification' | 'specialty_certification'
  | 'fellowship' | 'professional_membership' | 'cme' | 'hospital_privilege' | 'diploma'

interface Credential {
  kind: CredentialKind
  authority?: string | null      // e.g. "Ordre des Médecins du Sénégal"
  identifier?: string | null     // license/registration/certificate number
  title?: string | null          // e.g. "Fellow, West African College of Surgeons"
  specialty?: SpecialtyId | null // for specialty/board certifications
  issuedAt?: string | null
  expiresAt?: string | null      // drives expiry reminders (operational AI, §15)
  attestedBy?: string | null     // clinic admin who attested (not external proof)
  attestedAt?: string | null
  cmeCredits?: number | null     // for kind 'cme'
}
```

- **Credential expiry reminders** are *operational AI* (§15): a deterministic tool surfaces "license expires in N days", "CME below target", "board cert lapsing" — reminders only, never blocking, never verifying externally.
- **Digital signature** = a `clinical_documents` reference used by reports/prescriptions/certificates/print forms (§7/§17.4). Metadata‑only: we store the image + who/when, not cryptographic identity attestation (a future track).
- **Hospital privileges** are recorded as credentials for the profile/reporting; they inform *workspace shaping* via capability levels (§6) but do **not** grant data access — RBAC/RLS remain the sole authority.

---

## 4. Clinical Profile model (multi‑specialty)

Used only when `profession.usesSpecialties`. One primary, unlimited secondary, unlimited sub‑specialties — no artificial limit.

```ts
interface ClinicalProfile {
  primarySpecialty: SpecialtyId
  secondarySpecialties: SpecialtyId[]
  subSpecialties: SubSpecialtyId[]
  enabledPacks: PackId[]           // doctor's choice ∩ clinic-licensed (§7/§11)
  preferredNoteStyle: NoteStyle
}
```

Worked examples (unchanged, still resolve cleanly): *Gynéco‑Obstétrique* + Fertility/Ultrasound/High‑Risk → OB packs; *Médecine Générale* + Diabétologie/Nutrition/Cardiologie → core + endocrinology/nutrition/cardiology packs, **merged** (§10).

---

## 5. Specialty hierarchy (taxonomy)

Controlled vocabulary, two levels `Specialty → SubSpecialty`, shipped as a code registry (`specialties/taxonomy.ts`), i18n, **Senegal/West‑Africa first with international mapping later** (§23). Specialty (*what you practice*) stays decoupled from Pack (*what the workspace can do*); their relationship is many‑to‑many resolved in code, never a DB junction (§17.6).

---

## 6. Capability Levels ★NEW

Each pack may declare **capability levels** representing **professional capability and workflow complexity — NOT permissions**. A level tailors the *experience*; it never grants or removes data access, which remains the exclusive domain of RBAC + RLS.

```ts
// Declared by a pack; two independent ladders illustrated.
interface CapabilityLevel { id: LevelId; labelKey: string; rank: number }

// obstetrics.core:       Basic → Advanced → Expert           (rank 1..3)
// obstetrics.ultrasound: Observer → Operator → Reviewer → Trainer (rank 1..4)
```

The professional's level per pack lives in `professionalProfile.packLevels`. A clinic may **cap** the maximum level (governance, §11) — e.g. "Ultrasound: Operator max unless credentialed".

**How a level influences the workspace (without touching permissions):**

| Surface | Effect of level |
|---|---|
| **Workspace** | selects widget *presets/density* — Expert sees advanced panels (e.g. detailed BP‑trend/ECG interpretation view); Basic sees a simplified set |
| **Templates** | selects the template *variant* — Basic ANC = essential fields; Advanced/Expert = full high‑risk fields |
| **Quick Actions** | surfaces more complex action *variants* — an Ultrasound *Operator* sees "start exam"; an *Observer* sees "view exam" (same RLS; different workflow entry) |
| **AI Briefings** | adjusts *which operational signals* and verbosity surface — a *Reviewer/Trainer* sees "N studies awaiting review"; *Basic* sees a concise brief |
| **Documentation** | selects doc‑helper depth — Basic = guided prompts; Expert = terse structured scaffolds |

**Invariant:** raising a level never bypasses a safety check or grants unauthorized data; lowering a level never hides a mandatory (clinic‑locked) item or a safety‑critical warning. Levels shape complexity, not authorization. The resolver passes `level` into widget/template/action/AI selection as a *variant selector* only.

---

## 7. Clinical Copilot Pack architecture

The unit of capability and of marketplace distribution: *code* (manifest + components), *installed/enabled* as data (§11/§17).

```ts
interface CopilotPackManifest {
  id: PackId                     // 'obstetrics.core', 'cardiology.ecg', …
  labelKey: string
  version: string                // semver — marketplace/versioning (§16)
  publisher: 'chms' | string
  category: 'clinical' | 'diagnostic' | 'support'
  professions: ProfessionId[]    // §1 — who the pack serves
  specialties: SpecialtyId[]     // targeting/discovery
  roles: Role[]                  // RBAC gate (never replaces RLS)
  dependsOn: PackId[]            // e.g. obstetrics.ultrasound → obstetrics.core
  capabilityLevels?: CapabilityLevel[]   // §6 — optional ladder
  // Capabilities — ALL via registries, never inline in pages:
  widgets: WidgetRef[]           //   (level-aware)
  quickActions: QuickActionRef[] //   (level-aware)
  consultationTemplates: TemplateRef[] // (note-style + level variants)
  timelineEventTypes: string[]   // clinical_entries 'kind' values (§17.3)
  reports: ReportRef[]; printForms: PrintFormRef[]; documentationHelpers: DocHelperRef[]
  aiTools: string[]              // deterministic operational AITool ids (§15)
  pathways?: CarePathwayId[]     // §8 — pathways this pack participates in
  permissions: PackPermission[]  // capability gates ON TOP of RLS (never replacing)
  requiresModules: ModuleId[]
  schemaVersion: number          // capability negotiation → dormant if unsupported
}
```

Lifecycle: `published (catalog) → installed (clinic) → enabled (doctor) → active (resolved)`. `core.general_practice` is always installed & enabled (baseline, unremovable). Reconciliation with 14.1: `SpecialtyDefinition → CopilotPackManifest`; `SPECIALTIES → PACKS`; same one‑line plug‑in model.

---

## 8. Care Pathway Registry ★NEW (fourth registry)

Multiple Copilot Packs may contribute to a single longitudinal **patient‑care workflow**. A **Care Pathway** is the registry object that orchestrates them — patient‑scoped, cross‑pack, cross‑professional — while remaining fully registry‑driven (owns nothing; *references* pack capabilities).

```ts
interface CarePathwayManifest {
  id: CarePathwayId              // 'pregnancy', 'diabetes', …
  labelKey: string
  version: string
  contributingPacks: PackId[]    // which packs supply this pathway's capabilities
  professions: ProfessionId[]    // the care-team composition (§12)
  stages: PathwayStage[]         // ordered longitudinal stages
  aiTools: string[]              // pathway-level operational signals (e.g. "ANC due")
  schemaVersion: number
}
interface PathwayStage {
  id: string; labelKey: string
  templates: TemplateRef[]       // stage documentation (from contributing packs)
  timelineEventTypes: string[]   // clinical_entries kinds marking this stage
  quickActions: QuickActionRef[] // stage entry actions
  expectedNext?: string[]        // for operational "next step due" reminders
}
```

Examples (from the brief):

| Pathway | Stages / contributing packs |
|---|---|
| **Pregnancy** | ANC → Ultrasound → Laboratory → Delivery → Postpartum (`obstetrics.core`, `obstetrics.ultrasound`, `laboratory.core`, `pharmacy.core`) |
| **Vaccination** | schedule → administer → follow‑up (`pediatrics.core`) |
| **Diabetes** | Consultation → HbA1c (lab) → Nutrition → Pharmacy → Retinopathy → Foot Exam (`endocrinology.diabetes`, `laboratory.core`, `nutrition.core`, `pharmacy.core`, `ophthalmology.*`) |

**Registry‑driven guarantees.** `PATHWAYS: CarePathwayManifest[]` — one‑line plug‑in. An integrity test asserts every `contributingPacks`/`templates`/`quickActions`/`aiTools` reference resolves and stages are ordered. A pathway is **available** only when its `contributingPacks` are clinic‑installed; it **activates** for a patient as a *pathway instance* (§17.5). Pathways drive: a pathway **timeline lane** on the patient workspace, **stage quick actions**, and **operational AI reminders** ("ANC visit due", "postpartum follow‑up due") — all operational, never diagnostic.

---

## 9. Registry architecture

Four **primary** registries feed the engine, plus the four **shared capability** registries already in the repo:

| Registry | Kind | File (proposed) | Plug‑in unit |
|---|---|---|---|
| **Professional** | primary | `professions/index.ts` (`PROFESSIONS`) | profession |
| **Specialty** | primary | `specialties/taxonomy.ts` | specialty/sub |
| **Copilot Pack** | primary | `packs/index.ts` (`PACKS`) | pack manifest |
| **Care Pathway** | primary | `pathways/index.ts` (`PATHWAYS`) | pathway manifest |
| Widget | shared | `widgets/registry.ts` (14.1) | widget def |
| Action | shared | `actions/registry.ts` (14.1) | action def |
| Template | shared | `templates/registry.ts` (14.1) | template |
| AI tool | shared | `src/lib/ai/tools/*` (`ALL_TOOLS`) | operational tool |

Registry‑integrity tests (the existing pattern) extend to: unique ids per registry; every ref resolves; `dependsOn`/`contributingPacks` acyclic & resolvable; every pack `role`/`profession` is valid.

---

## 10. Workspace composition engine

The 14.1 pure `resolveWorkspace` generalizes to consume profession, capability levels, packs, and pathways — still pure/deterministic/unit‑tested.

### 10.1 Master composition diagram (updated) ★

```
Healthcare Professional
   ↓  Profession                (§1 — root classifier → RBAC role)
   ↓  Primary Specialty         (§4/§5 — if profession.usesSpecialties)
   ↓  Secondary Specialties
   ↓  Sub-specialties
   ↓  Capability Levels         (§6 — per-pack variant selector, NOT permissions)
   ↓  Installed Copilot Packs   (clinic-licensed ∩ doctor-enabled)
   ↓  Care Pathways             (§8 — cross-pack longitudinal workflows)
   ↓  Clinic Governance         (§11 — default-deny; install/mandatory/lock/level-cap)
   ↓  User Preferences          (§13 — order/hide/favorites/note-style, within locks)
   ↓  resolveWorkspace()        (pure MULTI-PACK + PATHWAY MERGE)
   ↓  Workspace Specification
   ↓  Workspace Renderer
```

### 10.2 Merge algorithm (deterministic; extends 14.1)

```
role     = PROFESSIONS[profile.profession].role
packs    = (profile.enabledPacks ∪ profession.basePacks)
             ∩ clinicInstalledPacks ∩ role-permitted ∩ modules-satisfied
packs   += transitive dependsOn closure (cycle-detected → drop + log)
pathways = PATHWAYS available for the patient/context whose contributingPacks ⊆ packs
order    = packs sorted by (isPrimarySpecialty desc, category, priority, id)
for each capability kind (widgets, actions, templates, timelineTypes, reports, aiTools):
    items = flatMap(packs ∪ activePathways, .<kind>)
    items = selectVariantByLevel(items, profile.packLevels)   // §6 (experience only)
    items = dedupeById(items, firstWins-by-order)             // primary-specialty wins
    items = applyClinicMandatory(items)                        // force-in locked/mandatory
    items = applyUserPrefs(items)                              // order/hide within allowed
template = pick(templates, byNoteStyle=prefs.noteStyle, byLevel) ?? primaryPackDefault
→ WorkspaceSpec { profession, packs, pathways, dashboardWidgets, quickActions,
                  consultationTemplate, timelineEventTypes, reports, aiBriefingTools, navigation }
```

**Backward compatibility (unchanged):** profession=doctor, only `core.general_practice`, no pathways, default level → the exact 14.1 `WorkspaceSpec`. The golden test in `workspace.test.ts` still holds; everything else is additive.

---

## 11. Governance model (three tiers, default‑deny) ★ratified

Authority is explicit and **default‑deny** (ratified, §23): a clinic sees nothing new until an admin explicitly enables it.

| Tier | Owner | Decides | Stored in |
|---|---|---|---|
| **Catalog** | Platform (code) | which professions/specialties/packs/pathways exist | the four registries |
| **Clinic install** | Clinic admin | **licensed** packs & pathways, available specialties, **mandatory** widgets/templates/workflows, **locked** preferences, **capability‑level caps** | `clinic_settings` sections `professions`/`specialties`/`packs`/`pathways`/`governance` |
| **Professional enable** | The professional | which *licensed* packs to enable, level ≤ clinic cap, personalization within locks | `professional_profiles` + `user_preferences` |

Resolution rule (extends 14.1): a capability reaches a workspace only if in a **clinic‑licensed** pack the **professional enabled**, at a level **≤ clinic cap**, permitted for the **role**, with its **module** on. Mandatory items are force‑included; locked preferences ignore overrides. **A professional can never enable a pack the clinic hasn't licensed** (default‑deny).

---

## 12. Team‑Based Care ★NEW

CHMS supports both the **individual workspace** (personal, profession/specialty/pack‑composed — the default home) and **Team Workspaces** for multidisciplinary care around a patient or care‑pathway episode.

**Model.** A **Care Team** is a set of `(user, role_in_team)` assignments to a **care‑pathway instance** for one patient (e.g. a Pregnancy episode: obstetrician → midwife → nurse → laboratory → pharmacy). Assignments are data (`care_team_members`, §17.5).

**Coexistence & composition.**
- The **Team Workspace** is a *patient/pathway‑scoped lens* that composes the union of the involved professions' relevant capabilities (from their packs) around that pathway instance — one shared timeline lane, shared stage actions, and cross‑role operational reminders ("lab results ready for OB review", "midwife handoff pending").
- The **individual workspace** is unchanged; a professional enters a team workspace *per patient/pathway* and returns to their personal home.

**Security (critical — no escalation).** A Team Workspace is a **composition/lens, not a permission grant**. Every professional still sees only the data their **role + clinic RLS** already permit — the team view simply aggregates *what each viewer is already entitled to* around the pathway. Team membership creates operational context and audit trail, **never** RLS bypass. Handoffs/assignments are timeline + operational‑AI events, audited.

**Examples (from the brief):**
- **Pregnancy:** Obstetrician → Midwife → Nurse → Laboratory → Pharmacy (Pregnancy pathway).
- **Cancer:** Oncology → Laboratory → Radiology → Pharmacy → Billing (an Oncology pathway).

---

## 13. Personalization model

Within governance (persisted in `user_preferences`, migration 037, per `(user, clinic)`): widget order/visibility (drag‑and‑drop, minus locked), favorite quick actions, preferred consultation template / **note style** (SOAP · narrative · structured · **voice dictation**), language, notifications. Multi‑clinic doctors keep separate personalization per clinic. **Voice dictation** is a **global capability enabled per Copilot Pack** (ratified, §23) — the platform provides the capability; each pack opts its templates into voice‑first, and the professional selects it as a note style where offered.

---

## 14. Role & profession support beyond doctors

The Professional Registry (§1) makes every profession first‑class. Existing modules become **first‑party packs**: Smart Pharmacy → `pharmacy.core`, Lab Intelligence → `laboratory.core`, Dashboard AI → widgets — already registry‑shaped, they slot in without rewrites. Each profession's onboarding, credentials, and (where applicable) specialties/packs follow the same engine.

---

## 15. AI integration

Reuse the deterministic provider + tool registry. Professional profile, packs, levels, and **pathways** determine **operational** signals only — executive brief, reminders (incl. **credential/CME expiry**, §3), documentation assistance, timeline summaries, pathway "next‑step due" nudges. Packs/pathways list existing/new `AITool` ids; capability level tunes verbosity (§6). **Never diagnose, prescribe, or recommend treatment.** Confidence + sources preserved; gated by `useClinicConfig().ai()` (Phase 13). The no‑diagnosis‑wording tests extend to every pack/pathway template and tool.

---

## 16. Future marketplace architecture

Packs and pathways behave like versioned plugins (semver, `publisher`, `dependsOn`). **First‑party packs first; third‑party only after the pack APIs and governance mature** (ratified, §23). Manifests are **declarative** (no arbitrary code in the core render path); a future third‑party model adds review + signing + sandboxing before any external publisher. Clinics *install* from the catalog; professionals *enable* what's licensed.

---

## 17. Database strategy (additive only)

Additive, tolerant (degrade to defaults pre‑migration — Phase‑13 pattern), reference‑data in code, per‑`(user, clinic)` scoping, and — from the P0 — **surrogate PKs, JSONB over junctions, FK‑hinted embeds**.

**17.1 `professional_profiles`** — surrogate `id` PK + `UNIQUE(user_id, clinic_id)` (NOT a composite‑FK PK). Columns: `profession TEXT` (queryable), identity, `primary_specialty TEXT`, and JSONB for unbounded lists (`secondary_specialties`, `sub_specialties`, `credentials`, `pack_levels`, `enabled_packs`). RLS: own row read/write within clinic; clinic admin reads clinic rows.

**17.2 Pack/pathway enablement** — clinic **install** in `clinic_settings` (`packs`/`pathways`/`governance` sections); professional **enable** in `professional_profiles` JSONB. No `user_packs` junction (avoids the composite‑FK footgun).

**17.3 Clinical data** — reuse the generic `clinical_entries` (`kind + JSONB`, Phase 14.0); packs/pathways declare which `kind`s. New capability ⇒ new `kind` ⇒ no migration. Hot domains promote to typed tables on evidence.

**17.4 Media / signatures / reports** — reuse `clinical_documents` + Storage (Phase 14.0); signed URLs minted **server‑side** (no client `service_role`). Signatures live here.

**17.5 Care pathway instances & teams** ★ — `care_pathway_instances` (surrogate `id`; `patient_id`, `clinic_id`, `pathway_id`, `status`, `current_stage`, `data JSONB`) and `care_team_members` (surrogate `id`; `instance_id`, `user_id`, `role_in_team`, `assigned_at`). **Both surrogate PKs — never composite‑FK** (§17.6). RLS clinic‑scoped; team membership does not widen row access (§12). Stage clinical data reuses `clinical_entries`.

**17.6 PostgREST safety rules (mandatory).** (1) No composite PK of two FKs — use surrogate `id` + `UNIQUE`. (2) Every cross‑table embed carries an explicit `!fk` hint (guarded by `embed-hints.test.ts`). (3) JSONB arrays over child/junction tables for unbounded non‑relational lists.

**17.7 Migration inventory (all additive)**

| Id | Adds | Notes |
|---|---|---|
| N‑A | `professional_profiles` (surrogate PK, `profession`, JSONB arrays incl. credentials/pack_levels) + RLS | per (user, clinic) |
| N‑B | `clinical_entries` (if not already applied) | generic kind+JSONB |
| N‑C | `clinical_documents` + Storage (if not already applied) | signatures/media |
| N‑D | `care_pathway_instances` + `care_team_members` (surrogate PKs) + RLS | team‑based care |
| (data) | `clinic_settings` sections `professions`/`specialties`/`packs`/`pathways`/`governance` | no migration |

---

## 18. Migration strategy

Each table `IF NOT EXISTS`, nullable, guarded; nothing existing altered; tolerant hooks so pre‑migration the app is byte‑identical. **Capability negotiation:** a pack/pathway whose `schemaVersion`/`requiresModules` the environment lacks stays *dormant*, not broken. Sequencing: N‑A (profiles) → onboarding captures profession/specialties → packs enable → clinical `kind`s activate → N‑D (pathways/teams). Governed by clinic install flags throughout (default‑deny).

---

## 19. Risks & mitigation

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **PGRST201 junction recurrence** (the P0) | Critical | §17.6: surrogate PKs, JSONB over junctions, FK‑hinted embeds; `embed-hints.test.ts` fails the build |
| 2 | Multi‑pack/pathway merge non‑determinism | Med | one pure `resolveWorkspace` with explicit order/dedupe; golden + property tests; primary‑wins |
| 3 | Over‑engineering (professions × specialties × packs × pathways × teams) | High | ship `core.general_practice` (== today) first; one reference pack + one pathway prove the model; YAGNI on unused layers |
| 4 | Clinical scope‑creep into diagnosis/treatment | Critical | packs/pathways are operational scaffolds; AI deterministic/operational; no‑diagnosis tests on every pack/pathway; clinical sign‑off before install |
| 5 | **Capability level mistaken for permission** | Critical | levels are variant selectors ONLY; a test asserts level never changes RLS/authorization; permissions stay role+RLS |
| 6 | **Team workspace RLS escalation** | Critical | team view is a lens over each viewer's own RLS‑permitted rows; membership never widens access; audited |
| 7 | Governance precedence confusion (3 tiers + levels + pathways) | Med | one tested rule: catalog ⊇ install ⊇ enable, level ≤ cap, locks/mandatory forced |
| 8 | Dashboard perf (many packs/pathways/widgets) | Med | `dataDeps` + shared react‑query keys; lazy‑load; default widget cap; pack "compact" presets |
| 9 | Credential/PII exposure across tenants | Critical | `professional_profiles` RLS per (user, clinic); admin reads own‑clinic only; signatures via signed URLs; no client `service_role` |
| 10 | Dependency/pathway cycles | Med | `dependsOn`/`contributingPacks` closure + cycle detection; integrity test |
| 11 | Marketplace trust (future third‑party) | High | first‑party only; declarative manifests; review + signing before external publishing |
| 12 | West‑Africa localization/regulatory variance | High | taxonomy + labels i18n, WA‑first; packs/pathways enabled per clinic; credential authorities configurable; audit on profile/pack/pathway changes |

---

## 20. Incremental implementation roadmap

Each step additive, independently shippable, zero‑regression, behind clinic flags (default‑deny).

| Step | Deliverable | Visible change |
|---|---|---|
| **14.2.0** | *This document* — approval gate | none |
| **14.2.1** | Professional Registry (`PROFESSIONS`) + `professional_profiles` migration (N‑A) + tolerant hooks + DB types; **no UI** | none |
| **14.2.2** | `SpecialtyDefinition → CopilotPackManifest`; `general_practice → core.general_practice`; generalize `resolveWorkspace` to multi‑pack merge **+ capability‑level variant selection**; golden test green | none (core pack == today) |
| **14.2.3** | Specialty taxonomy registry + **onboarding wizard** (profession → specialties → credentials → level → note style) | first‑run wizard |
| **14.2.4** | Governance in the Administration Hub (default‑deny): license/mandatory/lock packs, level caps + **“My Workspace”** enablement | admins license; professionals enable |
| **14.2.5** | `<Workspace>` renderer + widget dashboard consuming the merged spec | spec‑driven dashboard, defaults identical |
| **14.2.6** | **Reference pack: Pediatrics Core** (vaccination + growth + capability levels + operational AI) — proves the plugin model | pediatrics workspace for opted‑in clinics |
| **14.2.7** | **Care Pathway Registry** (`PATHWAYS`) + `care_pathway_instances`/`care_team_members` (N‑D) + Pregnancy pathway + **Team Workspace** | team‑based care for opted‑in clinics |
| **14.2.8** | Obstetrics/Cardiology/ORL packs; `clinical_documents` + signatures/reports; Radiology pack | per‑specialty workspaces + media |
| **later** | Marketplace lifecycle (versioning, dependency UX, third‑party trust) | pack/pathway catalog UI |

---

## 21. Future scalability ★NEW

The architecture scales across the deployment spectrum **without redesign**, because scale is *data + configuration + plugins*, never a change to the composition engine:

```
Single private clinic → Multi-site clinic → Regional hospital → National hospital network → West-African platform
```

- **Single clinic:** one tenant; professionals get profession/specialty/pack workspaces; RLS isolates the clinic. (Today's model.)
- **Multi‑site clinic:** an additive **organization** layer (future `clinics.organization_id`) groups clinics; packs/pathways can be **licensed at org or clinic level** via `clinic_settings`. No engine change — governance simply reads an org‑level default first, clinic override second. Multi‑clinic professionals already have per‑`(user, clinic)` profiles.
- **Regional/national hospital:** departments map to **professions + specialties + capability levels**; complex episodes map to **care pathways + team workspaces**; the generic `clinical_entries` + JSONB avoids per‑specialty schema explosion; **surrogate PKs + FK‑hinted embeds** keep PostgREST safe as relationship count grows. RLS tenant isolation holds unchanged at any node count.
- **National network:** the **marketplace** lets a network standardize its pack/pathway catalog and levels; audit + credentials scale as metadata; performance scales via widget `dataDeps` dedup, lazy‑load, and pagination already in place.
- **West‑African platform:** taxonomy and labels are **i18n and WA‑first with international mapping later**; credential authorities and specialties are per‑market configuration; packs/pathways are enabled per clinic/org — a new country is new *data and packs*, not new *architecture*.

**Why no redesign is required:** composition is a *pure, registry‑driven function*; capabilities are *plugins*; tenancy/RLS are *orthogonal and additive*; and every growth axis (more sites, more specialties, more staff, more countries) is expressed as **registry entries + config + additive tables** — the exact extension seams this document defines.

---

## 22. Reconciliation with Phase 14.0 / 14.1

14.0 proposed the framework + generic clinical stores; 14.1 shipped the pure engine + registries + `general_practice` + `user_preferences`. **14.2 (Rev 2)** adds the **Profession layer**, **Professional Profile + Credentials**, **Capability Levels**, **Copilot Packs**, the **Care Pathway registry**, and **Team‑Based Care** — all *reusing* the four shipped registries, `resolveWorkspace`, `clinic_settings` (governance), `user_preferences` (personalization), and `clinical_entries`/`clinical_documents` (data). Backward compatibility is guaranteed by `core.general_practice`.

---

## 23. Ratified decisions (were open questions)

| Topic | **Decision** |
|---|---|
| **Pack enablement** | Clinic **licenses** packs; professional **enables** licensed packs. |
| **Credential verification** | Store **metadata only**; **no external verification**. |
| **Governance** | **Default‑deny** — clinics must explicitly enable packs/pathways. |
| **Voice dictation** | **Global capability**, **enabled per Copilot Pack**. |
| **Marketplace** | **First‑party packs first**; third‑party only **after APIs & governance mature**. |
| **Specialty taxonomy** | **Controlled registry**, **Senegal / West‑Africa first**, international mapping later. |

> **This is the official Phase 14.2 architecture specification. Architecture only — no code, migrations, UI, or deployment. Implementation begins after approval, starting at 14.2.1.**
