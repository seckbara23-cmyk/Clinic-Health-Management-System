# Phase 14.2 — Professional Profile & Clinical Copilot Foundation
## Architecture Design Document (for review & approval — NOT implementation)

**Status:** Proposed · **Author:** Architecture · **Date:** 2026-07-04
**Scope:** Architecture only. No code, no migrations, no UI changes, no deployment.
**Builds on:** Phase 14.0 architecture (`docs/phase-14-specialty-workspace-architecture.md`) and the **shipped** Phase 14.1 foundations (`src/lib/workspace/{types,resolve}.ts`, `src/lib/{specialties,widgets,actions,templates}/*`, `resolveWorkspace`, migration `037_user_preferences.sql`).

---

## 0. Executive summary

Phase 14.1 delivered the *skeleton*: a pure `resolveWorkspace()` engine, four capability registries, and a single `general_practice` specialty that reproduces today's workspace. Phase 14.2 designs the *substance* on top of it:

1. A **Professional Profile Engine** — the source of truth for who a professional is (identity, credentials) and what they practice (**one primary + unlimited secondary specialties + unlimited sub‑specialties**), scoped per `(user, clinic)`.
2. **Clinical Copilot Packs** — the installable capability bundle. Doctors don't toggle random features; they enable *packs* (Obstetrics Core, Pediatrics Core, Cardiology Core, ORL Core…). A pack's **manifest** contributes widgets, quick actions, templates, timeline events, reports, print forms, documentation helpers, operational AI, permissions and dependencies — all through the existing registries, never hardcoded.
3. A **three‑tier governance + composition pipeline** — *catalog* (what packs exist) → *clinic install* (what a clinic licenses/allows) → *doctor enable* (what the professional turns on) → merged, personalized `WorkspaceSpec`.
4. A **marketplace‑ready plugin model** — packs behave like versioned plugins with dependencies, so future OB/ORL/Cardiology/Radiology/Dentistry packs install without touching core.

**Key evolution of 14.1:** the 14.1 `SpecialtyDefinition` generalizes into a **`CopilotPackManifest`**; `general_practice` becomes the always‑installed `core.general_practice` pack; and `resolveWorkspace` generalizes from *single specialty* to *multi‑pack merge*. This is additive and backward‑compatible: with only the core pack enabled, the output is byte‑identical to 14.1 (and therefore to today).

**Non‑negotiables carried forward:** additive DB only; multi‑tenancy, RLS, permissions, audit, privacy preserved; **no `service_role` in client**; no tenant leakage; deterministic operational‑only AI (no diagnosis/treatment). And one hard, codebase‑specific rule earned from the recent P0: **no join table may have a composite primary key made of two foreign keys, and every cross‑table PostgREST embed must carry an explicit `!fk` hint** (see §10.6 / §12).

---

## 1. Professional Profile model (identity)

A professional's identity is **per `(user, clinic)`** — the same person may be a consultant at one clinic and a visiting specialist at another, with different credentials, department, and enabled packs. It layers on the existing `user_profiles` (auth identity) without replacing it.

```ts
// Illustrative — design, not final code.
interface ProfessionalProfile {
  userId: string
  clinicId: string
  // Identity
  displayName: string                 // from user_profiles.full_name (source of truth)
  photoUrl?: string | null
  signatureUrl?: string | null        // for reports/prescriptions/certificates
  professionalTitle?: string | null   // "Dr.", "Sage-femme", "Pharmacien", …
  credentials: Credential[]           // license/registration numbers (see below)
  department?: string | null
  position?: string | null            // "Chef de service", "Médecin traitant", …
  yearsExperience?: number | null
  languages: string[]                 // ISO codes; drives UI + note language options
  // Clinical profile (§2) — profession-agnostic; empty for non-clinical roles
  clinical?: ClinicalProfile
  // Personalization (§8) lives in user_preferences (migration 037), referenced here
  onboardingCompleted: boolean
}

interface Credential {
  kind: 'medical_license' | 'ordre_registration' | 'diploma' | 'other'
  authority?: string | null           // e.g. "Ordre des Médecins du Sénégal"
  number?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
  verified?: boolean                  // clinic-admin attestation, not self-claimed trust
}
```

**Notes**
- `displayName` mirrors `user_profiles.full_name` (single source of truth); the profile stores only *additive* identity.
- **Signature** is a `clinical_documents` reference (Phase‑14.0 media store), not inline bytes — reused by reports/certificates/print forms (§4).
- Credentials are **structured** (queryable expiry for compliance dashboards) yet stored flexibly (§10).

---

## 2. Clinical Profile model (multi‑specialty)

Supports **exactly one primary**, **unlimited secondary**, **unlimited sub‑specialties**, and the packs derived from them — with *no artificial limit*, per the brief.

```ts
interface ClinicalProfile {
  primarySpecialty: SpecialtyId          // exactly one
  secondarySpecialties: SpecialtyId[]    // unlimited
  subSpecialties: SubSpecialtyId[]       // unlimited (each belongs to a specialty, §3)
  // Enabled packs are DERIVED-with-override, not free-form (§4/§6):
  enabledPacks: PackId[]                 // doctor's choice, ∩ clinic-installed (§7)
  preferredNoteStyle: NoteStyle          // soap | narrative | structured | voice_first
}
```

Worked examples from the brief resolve cleanly:

| Primary | Secondary | Typical packs surfaced |
|---|---|---|
| Gynécologie & Obstétrique | Fertility · Obstetric Ultrasound · High‑Risk Pregnancy | `obstetrics.core`, `obstetrics.ultrasound`, `womens_health.fertility` |
| Médecine Générale | Diabétologie · Nutrition · Cardiologie | `core.general_practice`, `endocrinology.diabetes`, `nutrition.core`, `cardiology.core` |
| Family Medicine | Cardiology · Nutrition · Diabetes | core + `cardiology.core` + `nutrition.core` + `endocrinology.diabetes`, **merged** (§6) |

The clinical profile is **profession‑agnostic**: a midwife's `primarySpecialty` might be `midwifery` with a `womens_health.anc` pack; a lab technician has no clinical profile but still gets a role‑scoped workspace (§9).

---

## 3. Specialty hierarchy (taxonomy)

A **controlled vocabulary**, not free text — so profiles, packs, analytics and West‑Africa localization stay consistent. Two levels: `Specialty → SubSpecialty`. This is *reference data* (rarely changes), shipped as a registry (code) and optionally mirrored to a read‑only table for joins/reporting.

```ts
interface SpecialtyNode {
  id: SpecialtyId                   // 'obgyn', 'cardiology', 'general_practice', …
  labelKey: string                  // i18n (fr/en; extensible per market)
  category: 'primary_care' | 'medical' | 'surgical' | 'diagnostic' | 'support'
  subSpecialties: SubSpecialtyNode[]
}
interface SubSpecialtyNode { id: SubSpecialtyId; labelKey: string; specialty: SpecialtyId }
```

- The 14.1 `SpecialtyId` union is the seed; 14.2 formalizes the tree and adds `SubSpecialtyId`.
- Taxonomy is **decoupled from capability**: a specialty says *what you practice*; a pack says *what the workspace can do* (§4). One specialty may have several packs; one pack may serve several specialties (many‑to‑many by design, resolved in code — never a DB junction, §12).

---

## 4. Clinical Copilot Pack architecture

A **pack** is the unit of capability and the unit of marketplace distribution. It is *code* (a manifest + its widget/template/action/AI components), registered like the AI tool registry. Its *install/enablement* is *data* (§7/§10).

### 4.1 Pack manifest

```ts
interface CopilotPackManifest {
  id: PackId                         // 'obstetrics.core', 'cardiology.ecg', …
  labelKey: string
  version: string                    // semver — marketplace/versioning (§9)
  publisher: 'chms' | string         // first-party vs future third-party
  category: 'clinical' | 'diagnostic' | 'support'
  // Targeting: which specialties/roles this pack is meant for (discovery + guards)
  specialties: SpecialtyId[]
  roles: Role[]                      // usually ['doctor','nurse'] etc.
  dependsOn: PackId[]                // e.g. obstetrics.ultrasound → obstetrics.core
  // Capabilities (ALL via existing registries — never inline in pages):
  widgets: WidgetRef[]               // → widgets/registry.ts
  quickActions: QuickActionRef[]     // → actions/registry.ts
  consultationTemplates: TemplateRef[] // → templates/registry.ts
  timelineEventTypes: string[]       // clinical_entries 'kind' values (§10)
  reports: ReportRef[]               // print/PDF forms (reuse existing print infra)
  printForms: PrintFormRef[]         // e.g. school certificate, ANC card
  documentationHelpers: DocHelperRef[] // structured note scaffolds
  aiTools: string[]                  // operational AITool ids (deterministic, §AI)
  permissions: PackPermission[]      // capability gates layered on RLS (never replacing it)
  requiresModules: ModuleId[]        // clinic must have these enabled
  schemaVersion: number              // capability negotiation (dormant if unsupported)
}
```

### 4.2 Illustrative packs (from the brief)

| Pack | Contributes (examples) |
|---|---|
| `obstetrics.core` | ANC template + timeline, delivery/postpartum templates, "ANC due"/"delivery approaching" AI, women's‑health widgets |
| `obstetrics.ultrasound` | ultrasound report template, image document kind, `depends_on: obstetrics.core` |
| `pediatrics.core` | vaccination + growth + development + nutrition templates/widgets, school‑health certificate print form, "vaccinations due"/"growth review due" AI |
| `cardiology.core` | heart‑failure/hypertension templates, BP‑trend & ECG/echo widgets, "ECG pending"/"echo available"/"follow‑up overdue" AI |
| `orl.core` | audiology, endoscopy, head‑&‑neck, voice clinic, sleep‑medicine templates/reports |

### 4.3 Pack lifecycle

`published (catalog)` → `installed (clinic)` → `enabled (doctor)` → `active (in a resolved workspace)`. Each transition is a governance boundary (§7). A pack can be **deprecated** (still runs, hidden from catalog) or **disabled** (clinic uninstalls → its capabilities vanish from every workspace, data retained).

### 4.4 Relationship to Phase 14.1

- 14.1 `SpecialtyDefinition` → **`CopilotPackManifest`** (a superset: adds version/publisher/dependsOn/reports/printForms/docHelpers/permissions).
- 14.1 `general_practice` specialty → **`core.general_practice`** pack, always installed & enabled, unremovable → guarantees the zero‑regression baseline.
- 14.1's `SPECIALTIES` array → **`PACKS` registry** (same one‑line plug‑in model).

---

## 5. Registry architecture

Everything remains registry‑driven, extending the four registries already in the repo:

| Registry | Today (14.1) | 14.2 addition |
|---|---|---|
| **Pack** | `specialties/index.ts` (`SPECIALTIES`) | becomes `packs/index.ts` (`PACKS: CopilotPackManifest[]`); one line per pack |
| **Widget** | `widgets/registry.ts` | packs reference ids; new specialty widgets registered here |
| **Action** | `actions/registry.ts` | idem |
| **Template** | `templates/registry.ts` | idem (+ report/print‑form registries as siblings) |
| **Specialty taxonomy** | `SpecialtyId` union | `specialties/taxonomy.ts` (`SpecialtyNode[]`) |
| **AI tool** | `src/lib/ai/tools/*` (`ALL_TOOLS`) | packs list existing/new operational tool ids |

**Registry‑integrity tests** (already the pattern in `workspace.test.ts` / `settings.test.ts`) extend to: unique pack ids, every `WidgetRef/ActionRef/TemplateRef/aiTool/ReportRef` resolves, and every `dependsOn` resolves and is acyclic.

---

## 6. Workspace composition engine

The 14.1 `resolveWorkspace(ctx)` generalizes from *one specialty* to *N enabled packs*, staying **pure/deterministic/unit‑tested**.

### 6.1 Extended pipeline

```
ProfessionalProfile ── (identity + clinical profile)
   ↓
Role                ── baseline capabilities (doctor/nurse/…)
   ↓
Primary Specialty   ── ranks primary pack(s) first
   ↓
Secondary Specialties ── contribute additional packs
   ↓
Enabled Copilot Packs ── the actual capability sources (doctor ∩ clinic-installed)
   ↓
Clinic Configuration ── installed packs, mandatory items, locks, modules
   ↓
Personal Preferences ── order, hidden, favorites, note style
   ↓
resolveWorkspace()  ── pure MERGE
   ↓
WorkspaceSpec  →  <Workspace/> renderer (Phase 14.2+ UI, later step)
```

### 6.2 Multi‑pack merge algorithm (deterministic)

```
packs   = enabledPacks ∩ clinicInstalledPacks ∩ role-permitted ∩ modules-satisfied
packs  += transitive dependsOn closure (auto-include deps; detect cycles → drop pack + log)
order   = packs sorted by (isPrimarySpecialty desc, category, manifest priority, id)
for each capability kind (widgets, actions, templates, timelineTypes, reports, aiTools):
    items = flatMap(packs, pack.<kind>)
    items = dedupeById(items, firstWins-by-pack-order)   // primary specialty wins conflicts
    items = applyClinicMandatory(items)                  // force-in locked/mandatory
    items = applyUserPrefs(items)                        // order/hide within allowed set
template = pick(consultationTemplates, byNoteStyle=prefs.noteStyle) ?? primaryPackDefault
→ WorkspaceSpec { packs, dashboardWidgets, quickActions, consultationTemplate,
                  timelineEventTypes, reports, aiBriefingTools, navigation }
```

This directly satisfies *"workspace should merge capabilities intelligently"* for the Family‑Medicine + Cardiology + Nutrition + Diabetes example: four packs' widgets/actions/templates union, dedupe, primary‑first, deduped timeline kinds, and a single merged AI briefing tool set. The single governance rule from 14.1 (**registry ∩ clinic‑allowed, locked forced in, user‑ordered**) is preserved and extended across packs.

### 6.3 Backward compatibility

With only `core.general_practice` enabled, the merge yields exactly the 14.1 `WorkspaceSpec` → the golden test in `workspace.test.ts` still holds. Adding packs is strictly additive.

---

## 7. Governance model (three tiers)

Authority is explicit and layered — clinic governance always bounds personal choice.

| Tier | Owner | Decides | Stored in |
|---|---|---|---|
| **Catalog** | Platform (code) | which packs exist, their manifests/versions | `PACKS` registry (code) |
| **Clinic install** | Clinic admin | installed packs, available specialties, **mandatory** widgets/templates/workflows, **locked** preferences | `clinic_settings` (Phase 12) sections `specialties`/`packs`/`governance` |
| **Doctor enable** | Professional | which *installed* packs to enable, personalization within locks | `professional_profiles` + `user_preferences` (Phase 14.1) |

**Resolution:** a capability reaches a workspace only if it is in an *installed* pack the doctor *enabled*, permitted for the *role*, and its *module* is on. Clinic **mandatory** items are force‑included and non‑hideable; **locked** preferences ignore user overrides. A doctor can never enable a pack the clinic hasn't installed. This is the same intersection‑then‑order rule as 14.1, now spanning three tiers.

---

## 8. Personalization model

Within governance, professionals personalize (persisted in `user_preferences`, migration 037, per `(user, clinic)`):
- Dashboard **widget order + visibility** (drag‑and‑drop), minus clinic‑locked.
- **Favorite quick actions** (float to front of the merged set).
- **Preferred consultation template / note style** (SOAP · narrative · structured · voice dictation) — selects the template variant per pack.
- **Language** (from profile `languages`), **notification preferences**.

Multi‑clinic doctors keep separate personalization per clinic. All of this already has a home in the shipped 14.1 `UserWorkspacePrefs` shape and `user_preferences` table — 14.2 only widens the fields.

---

## 9. Role support beyond doctors

`ProfessionalProfile` is profession‑agnostic. Each role eventually gets a profile + role‑scoped packs:

| Role | Example packs / capabilities |
|---|---|
| Nurse / Midwife | vitals, ANC assistance, vaccination administration, growth measurement |
| Pharmacist | dispensing, stock, FEFO, cycle‑count (existing Smart Pharmacy as a pack) |
| Lab technician | sample tracking, result entry, review queue (existing Lab Intelligence as a pack) |
| Radiology | imaging worklist, report templates (Radiora principles) |
| Reception | registration, appointments, queue |
| Cashier | invoices, payments, insurance |
| Admin | governance, catalog install, oversight |

The **existing modules become first‑party packs** over time — Smart Pharmacy, Lab Intelligence, Dashboard AI are already registry‑shaped and slot in as `pharmacy.core`, `laboratory.core`, etc., without rewrites.

---

## 10. Database strategy (additive only)

**Guiding rules:** additive, tolerant (degrade to defaults when a table is absent — the Phase‑13 pattern), reference‑data in code, per‑`(user, clinic)` scoping, and — *learned from the P0 incident* — **no two‑FK composite‑PK junction tables**, **surrogate PKs on all join tables**, and **FK‑hinted embeds everywhere**.

### 10.1 `professional_profiles`
Per `(user_id, clinic_id)`. **Surrogate `id` PK** + `UNIQUE(user_id, clinic_id)` (NOT a composite‑FK PK — that is exactly what created the PGRST201 junction that caused the P0 lockout). Columns: identity fields (§1), `primary_specialty TEXT`, and **JSONB** for the unbounded arrays (`secondary_specialties`, `sub_specialties`, `credentials`) — no per‑array child tables, no junctions. RLS: user reads/writes own row within clinic; clinic admin reads clinic rows.

### 10.2 Pack enablement (data, not junctions)
- **Clinic install:** stored in `clinic_settings` (Phase 12) section `packs` → `{ installed: PackId[], mandatory: [...], locked: [...] }`. No new table; reuses proven RLS.
- **Doctor enable:** `professional_profiles.enabled_packs JSONB` (or `user_preferences.preferences.enabledPacks`). JSONB arrays, not a `user_packs(user_id, pack_id)` junction — deliberately avoiding the composite‑FK footgun.

### 10.3 Clinical data — reuse `clinical_entries` (Phase 14.0)
The generic `kind + JSONB` store (proposed in the 14.0 doc) remains the plug‑in clinical store; each pack declares which `kind`s it reads/writes (`anc_visit`, `growth`, `vaccination`, `ecg`…), validated by the template's zod schema. **New pack ⇒ new `kind` values ⇒ no migration.** Hot domains promote to typed tables on evidence.

### 10.4 Media / signatures / reports — reuse `clinical_documents` (Phase 14.0)
Signatures, ultrasound/ECG images, generated report PDFs. Storage bucket with RLS mirroring row RLS; signed URLs minted **server‑side** (no client `service_role`).

### 10.5 Specialty taxonomy
Ships as code (`specialties/taxonomy.ts`). Optional read‑only `specialties`/`sub_specialties` reference tables *only if* reporting joins demand it — additive, clinic‑agnostic, RLS `SELECT` to any authenticated user.

### 10.6 PostgREST safety rules (codebase‑specific, mandatory)
1. **Never** give a table a composite PK of two FKs (use surrogate `id` + `UNIQUE`).
2. **Every** cross‑table embed carries an explicit `!fk` hint (guarded by `embed-hints.test.ts`).
3. Prefer **JSONB arrays** over child/junction tables for unbounded, non‑relational lists (secondary specialties, enabled packs) — fewer relationships to disambiguate, no junction inference.

### 10.7 Migration inventory (all additive)

| Id | Adds | Notes |
|---|---|---|
| N‑A | `professional_profiles` (surrogate PK, JSONB arrays) + RLS | per (user, clinic) |
| N‑B | `clinical_entries` (if not already applied from 14.0 roadmap) | generic kind+JSONB |
| N‑C | `clinical_documents` + Storage (if not already applied) | signatures/media |
| (data) | `clinic_settings` sections `specialties`/`packs`/`governance` | no migration |

---

## 11. Migration strategy

- Each table `IF NOT EXISTS`, nullable, guarded; **nothing existing altered**; tolerant hooks so pre‑migration the app is byte‑identical.
- **Capability negotiation:** a pack with `schemaVersion`/`requiresModules` the environment lacks stays *dormant* (not broken) — a pack can merge before its migration lands and light up on enable, exactly like Phases 10A–12.
- Sequencing: N‑A first (profiles) → onboarding can capture specialties → packs enable → clinical `kind`s activate as packs ship. Governed by clinic install flags throughout.

---

## 12. Risks & mitigation

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **PostgREST junction / PGRST201 recurrence** (the P0 we just fixed) | Critical (lockout) | §10.6 rules: surrogate PKs, JSONB arrays over junctions, FK‑hinted embeds; `embed-hints.test.ts` fails the build on any un‑hinted `clinics(`/cross‑table embed |
| 2 | **Multi‑pack merge conflicts / non‑determinism** | Med | Single pure `resolveWorkspace` merge with explicit ordering + dedupe; golden + property tests; primary‑specialty‑wins rule |
| 3 | **Over‑engineering / marketplace scope creep** | High | Ship `core.general_practice` first (== today); one reference pack (Pediatrics) proves the model; packs added on demand |
| 4 | **Clinical scope‑creep into diagnosis/treatment** | Critical | Packs are operational scaffolds; AI stays deterministic/operational; extend no‑diagnosis tests to every pack's templates + tools; clinical sign‑off before a pack is installable |
| 5 | **Governance precedence confusion (3 tiers)** | Med | One tested rule: catalog ⊇ install ⊇ enable, locks/mandatory forced; unit‑tested |
| 6 | **Dashboard perf with many packs → many widgets/queries** | Med | Widgets declare `dataDeps`; shared react‑query keys (proven dedup); lazy‑load; cap default widget count; pack “compact” presets |
| 7 | **Credential/PII exposure across tenants** | Critical | `professional_profiles` RLS scoped to `(user, clinic)`; admin reads only own‑clinic rows; signatures via signed URLs; no `service_role` client |
| 8 | **Dependency hell between packs** | Med | `dependsOn` closure computed + cycle‑detected in the resolver; integrity test forbids cycles/missing deps |
| 9 | **Third‑party marketplace trust (future)** | High | First‑party only initially; manifests are declarative (no arbitrary code exec in core render path); review + signing before any external publisher |
| 10 | **West‑Africa localization / regulatory variance** | High | Taxonomy + labels i18n; packs enabled per clinic/market; credential authorities configurable; audit extends to profile + pack changes |

---

## 13. Incremental implementation roadmap

Each step additive, independently shippable, zero‑regression, and behind clinic flags.

| Step | Deliverable | Visible change |
|---|---|---|
| **14.2.0** | *This document* — approval gate | none |
| **14.2.1** | `professional_profiles` migration (N‑A) + tolerant read/write hooks + DB types; **no UI** | none |
| **14.2.2** | Evolve `SpecialtyDefinition` → `CopilotPackManifest`; `general_practice` → `core.general_practice`; generalize `resolveWorkspace` to multi‑pack merge; **golden test still green** | none (core pack == today) |
| **14.2.3** | Specialty taxonomy registry + **onboarding wizard** (primary/secondary/sub‑specialty, credentials, note style) writing `professional_profiles` | first‑run wizard for doctors |
| **14.2.4** | Governance surface in the Administration Hub (Phase 12): install/mandatory/lock packs + specialties; **“My Workspace”** personal enablement | admins install packs; doctors enable |
| **14.2.5** | `<Workspace>` renderer + widget dashboard consuming the merged spec (Phase‑14.2 UI) | spec‑driven dashboard, defaults identical |
| **14.2.6** | **Reference pack: Pediatrics Core** (vaccination + growth templates/widgets/timeline + operational AI) — proves the plugin model end‑to‑end | pediatrics workspace for opted‑in clinics |
| **14.2.7** | Obstetrics Core, Cardiology Core, ORL Core … one manifest each | per‑specialty workspaces |
| **14.2.8** | `clinical_documents` + signatures/reports + Radiology pack | media/report workflows |
| **later** | Marketplace lifecycle (versioning, dependency install UX, publisher trust) | pack catalog UI |

---

## 14. How this reconciles with Phase 14.0 / 14.1

- **14.0** proposed the framework and the generic `clinical_entries`/`clinical_documents` stores; **14.1** shipped the pure engine + registries + `general_practice` + `user_preferences`.
- **14.2** *supersedes the "one specialty definition" model* with **profiles + multi‑pack merge**, and *formalizes* packs as the marketplace unit. It reuses, not replaces: the four registries, `resolveWorkspace`, `clinic_settings` (governance), `user_preferences` (personalization), `clinical_entries`/`clinical_documents` (data), and the deterministic AI tool registry.
- Backward compatibility is guaranteed by making `core.general_practice` the always‑on baseline whose merged output equals 14.1's golden spec.

---

## 15. Open questions for the review board

1. **Pack enablement storage** — JSONB on `professional_profiles` vs a surrogate‑PK `user_packs` table (both avoid the junction footgun; JSONB is simpler, a table is more queryable for admin dashboards). Recommend JSONB first.
2. **Credential verification** — self‑declared + clinic‑admin attestation now, or integrate with the Ordre des Médecins registry later?
3. **Governance default posture** — packs opt‑in per clinic (locked‑down) vs all first‑party packs available by default (open)? Recommend opt‑in for hospitals, open for small clinics — a per‑clinic setting.
4. **Voice dictation** — in‑scope for 14.2 note styles or a separate track (speech infra + Wolof/French/English considerations)?
5. **Marketplace timeline** — first‑party packs only through 14.2; when (if) do we open third‑party publishing, and under what clinical‑safety review?
6. **Specialty taxonomy source** — adopt an existing standard (e.g. a curated subset aligned to local practice) vs a CHMS‑maintained list for Senegal/West Africa?

> **This phase delivers architecture only. No code, migrations, UI, or deployment. Implementation begins only after this document is reviewed and approved — starting at 14.2.1.**
