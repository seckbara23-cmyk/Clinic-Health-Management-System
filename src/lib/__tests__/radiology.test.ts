import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ORDER_STATUSES, REPORT_STATUSES, MODALITIES,
} from '../radiology/types'
import {
  canTransitionOrder, allowedOrderTransitions, filterWorklist, worklistKpis, isOrderStatus,
} from '../radiology/worklist'
import {
  canEditReport, canSignReport, canAmendReport, canTransitionReport, isSigned, isDeliverable,
  snapshotReport, nextVersion, isReportStatus,
} from '../radiology/report'
import {
  structureDictation, structurePreservesSource, droppedTokens, tokenize, STRUCTURING_IS_DRAFT,
} from '../radiology/structuring'
import { RADIOLOGY_TEMPLATES, getRadiologyTemplate, templatesForModality, templateForExam } from '../radiology/templates'
import { buildReportExport } from '../radiology/export'
import type { RadiologyOrder, RadiologyReport } from '../radiology/types'

const order = (o: Partial<RadiologyOrder>): RadiologyOrder => ({
  id: 'o', patientId: 'p', modality: 'ct', examType: 'ct_brain', priority: 'routine', status: 'requested',
  requestedAt: '2026-07-01T00:00:00Z', ...o,
})
const report = (r: Partial<RadiologyReport>): RadiologyReport => ({
  id: 'r', orderId: 'o', patientId: 'p', reportStatus: 'draft', version: 1, ...r,
})

// ── Order lifecycle (worklist state machine) ────────────────────────
describe('order lifecycle', () => {
  it('allows only valid forward transitions (and cancel from open states)', () => {
    expect(canTransitionOrder('requested', 'scheduled')).toBe(true)
    expect(canTransitionOrder('scheduled', 'in_progress')).toBe(true)
    expect(canTransitionOrder('pending_review', 'signed')).toBe(true)
    expect(canTransitionOrder('signed', 'delivered')).toBe(true)
    expect(canTransitionOrder('requested', 'cancelled')).toBe(true)
    // Not allowed:
    expect(canTransitionOrder('requested', 'signed')).toBe(false)   // no skipping
    expect(canTransitionOrder('signed', 'draft')).toBe(false)       // no un-signing
    expect(canTransitionOrder('delivered', 'signed')).toBe(false)   // terminal
    expect(canTransitionOrder('cancelled', 'requested')).toBe(false)
    expect(canTransitionOrder('bogus', 'signed')).toBe(false)
  })
  it('exposes the status vocabulary', () => {
    expect(ORDER_STATUSES.length).toBe(9)
    expect(isOrderStatus('pending_review')).toBe(true)
    expect(isOrderStatus('nope')).toBe(false)
    expect(allowedOrderTransitions('signed')).toEqual(['delivered'])
    expect(MODALITIES).toContain('mammography')
  })
})

// ── Worklist filtering + sorting + KPIs ─────────────────────────────
describe('worklist', () => {
  const orders = [
    order({ id: 'a', status: 'requested', priority: 'routine', requestedAt: '2026-07-01T00:00:00Z', modality: 'ct' }),
    order({ id: 'b', status: 'requested', priority: 'stat', requestedAt: '2026-07-03T00:00:00Z', modality: 'mri' }),
    order({ id: 'c', status: 'signed', priority: 'urgent', requestedAt: '2026-07-02T00:00:00Z', modality: 'ct' }),
    order({ id: 'd', status: 'pending_review', priority: 'routine', requestedAt: '2026-06-30T00:00:00Z', modality: 'ct', assignedRadiologistId: 'rad1' }),
  ]
  it('filters (onlyOpen excludes signed) and sorts STAT/urgent first then FIFO', () => {
    const open = filterWorklist(orders, { onlyOpen: true })
    expect(open.map(o => o.id)).toEqual(['b', 'd', 'a'])  // stat, then routine by oldest
    expect(open.find(o => o.id === 'c')).toBeUndefined()  // signed excluded
  })
  it('filters by modality / status / assignment / search', () => {
    expect(filterWorklist(orders, { modality: 'ct' }).map(o => o.id).sort()).toEqual(['a', 'c', 'd'])
    expect(filterWorklist(orders, { status: 'pending_review' }).map(o => o.id)).toEqual(['d'])
    expect(filterWorklist(orders, { assignedRadiologistId: 'rad1' }).map(o => o.id)).toEqual(['d'])
    expect(filterWorklist(orders, { search: 'brain' }).length).toBe(4)  // all ct_brain exam
  })
  it('computes deterministic KPIs', () => {
    const k = worklistKpis(orders)
    expect(k.total).toBe(4)
    expect(k.open).toBe(3)
    expect(k.pendingReview).toBe(1)
    expect(k.signed).toBe(1)
    expect(k.stat).toBe(1)
    expect(k.urgent).toBe(0)          // the urgent order is signed → not open
    expect(k.unassigned).toBe(2)      // a, b open + unassigned
  })
})

// ── Report lifecycle + signature authority + immutability ──────────
describe('report lifecycle', () => {
  it('only draft/review are editable; signed/amended are not', () => {
    expect(canEditReport('draft')).toBe(true)
    expect(canEditReport('review')).toBe(true)
    expect(canEditReport('signed')).toBe(false)
    expect(canEditReport('amended')).toBe(false)
    expect(isSigned('signed')).toBe(true)
    expect(isSigned('amended')).toBe(true)
    expect(isSigned('draft')).toBe(false)
    expect(REPORT_STATUSES.length).toBe(4)
    expect(isReportStatus('review')).toBe(true)
  })
  it('signing is a radiologist/admin action on a draft/review — NEVER automatic', () => {
    expect(canSignReport('doctor', 'radiology', 'draft')).toBe(true)
    expect(canSignReport('doctor', 'radiology', 'review')).toBe(true)
    expect(canSignReport('admin', null, 'draft')).toBe(true)
    expect(canSignReport('super_admin', null, 'review')).toBe(true)
    // Denied:
    expect(canSignReport('doctor', 'cardiology', 'draft')).toBe(false)   // not a radiologist
    expect(canSignReport('nurse', 'radiology', 'draft')).toBe(false)     // wrong role
    expect(canSignReport('doctor', 'radiology', 'signed')).toBe(false)   // already signed
    expect(canSignReport('doctor', 'radiology', null)).toBe(false)
  })
  it('amendment only from signed/amended; report transitions are constrained', () => {
    expect(canAmendReport('signed')).toBe(true)
    expect(canAmendReport('amended')).toBe(true)
    expect(canAmendReport('draft')).toBe(false)
    expect(canTransitionReport('draft', 'signed')).toBe(true)
    expect(canTransitionReport('signed', 'amended')).toBe(true)
    expect(canTransitionReport('signed', 'draft')).toBe(false)   // no un-signing
    expect(nextVersion({ version: 1 })).toBe(2)
  })
  it('a report is deliverable to the chart ONLY once signed with a signature time', () => {
    expect(isDeliverable(report({ reportStatus: 'signed', signedAt: '2026-07-04T00:00:00Z' }))).toBe(true)
    expect(isDeliverable(report({ reportStatus: 'draft' }))).toBe(false)
    expect(isDeliverable(report({ reportStatus: 'signed', signedAt: null }))).toBe(false)  // unsigned-as-final blocked
    expect(isDeliverable(null)).toBe(false)
  })
  it('snapshot copies content verbatim (never derives)', () => {
    const snap = snapshotReport(report({ version: 2, reportStatus: 'signed', findings: 'F', conclusion: 'C', technique: 'T', recommendations: 'R', signedAt: 'X' }))
    expect(snap).toEqual({ version: 2, reportStatus: 'signed', technique: 'T', findings: 'F', conclusion: 'C', recommendations: 'R', radiologistId: null, signedAt: 'X' })
  })
})

// ── Deterministic structuring — CONTENT PRESERVATION (safety core) ──
describe('dictation structuring', () => {
  const raw = [
    'Technique : scanner cérébral sans injection.',
    "Résultats : pas d'anomalie parenchymateuse. Structures médianes en place.",
    'Conclusion : examen sans particularité.',
    'Recommandations : contrôle si persistance des symptômes.',
  ].join('\n')

  it('routes dictated text into the right sections by French headers', () => {
    const st = structureDictation(raw)
    expect(st.technique).toContain('scanner cérébral sans injection')
    expect(st.resultats).toContain('anomalie parenchymateuse')
    expect(st.conclusion).toContain('examen sans particularité')
    expect(st.recommandations).toContain('contrôle si persistance')
  })
  it('INVENTS NOTHING — every output token comes from the source dictation', () => {
    const st = structureDictation(raw)
    expect(structurePreservesSource(raw, st)).toBe(true)
    // Nothing clinical is dropped — only recognised header keywords may be removed.
    const HEADERS = new Set(['technique', 'resultats', 'conclusion', 'recommandations'])
    expect(droppedTokens(raw, st).every(t => HEADERS.has(t))).toBe(true)
  })
  it('with no headers, all dictation is preserved as observations (Résultats)', () => {
    const plain = 'Opacité de la base pulmonaire droite. Pas d épanchement.'
    const st = structureDictation(plain)
    expect(st.resultats).toBe(plain)
    expect(st.technique).toBe('')
    expect(st.conclusion).toBe('')
    expect(structurePreservesSource(plain, st)).toBe(true)
  })
  it('never introduces a token absent from the source (no fabricated finding)', () => {
    const st = structureDictation('Résultats : normal.')
    const src = new Set(tokenize('Résultats : normal.'))
    for (const tok of tokenize([st.technique, st.resultats, st.conclusion, st.recommandations].join(' '))) {
      expect(src.has(tok)).toBe(true)
    }
    expect(st.conclusion).toBe('')  // no conclusion invented
  })
  it('empty input yields empty sections and still preserves source', () => {
    const st = structureDictation('')
    expect(st).toEqual({ technique: '', resultats: '', conclusion: '', recommandations: '' })
    expect(structurePreservesSource('', st)).toBe(true)
    expect(STRUCTURING_IS_DRAFT).toBe(true)  // output is always a draft
  })
})

// ── Templates (scaffolds, not diagnosis generators) ─────────────────
describe('radiology templates', () => {
  it('registers modality/exam scaffolds and resolves them', () => {
    expect(RADIOLOGY_TEMPLATES.length).toBe(7)
    expect(getRadiologyTemplate('ct_brain')!.region).toBe('brain')
    expect(getRadiologyTemplate('nope')).toBeNull()
    expect(templatesForModality('ct').map(t => t.id)).toEqual(['ct_brain', 'ct_chest', 'ct_abdomen'])
    expect(templateForExam('xray_chest')!.modality).toBe('xray')
  })
  it('templates carry NO baked findings/conclusions (scaffold keys only)', () => {
    for (const t of RADIOLOGY_TEMPLATES) {
      expect(Object.keys(t).sort()).toEqual(['examType', 'id', 'labelKey', 'modality', 'region', 'techniqueKey'])
    }
  })
})

// ── Export (printable) — final only when signed, no fabrication ─────
describe('report export', () => {
  const base = {
    clinic: { name: 'Clinique Étoile', location: 'Dakar', phone: '+221338210000' },
    patient: { fullName: 'Awa Sy', patientNumber: 'P-001', dateOfBirth: '1990-01-01', gender: 'female' },
    radiologist: { fullName: 'Dr Diallo', professionalTitle: 'Radiologue' },
    order: { modality: 'ct', examType: 'ct_brain', requestedAt: '2026-07-01' },
    now: new Date('2026-07-04T00:00:00Z'),
  }
  it('marks a signed report final and lays out authored content only', () => {
    const ex = buildReportExport({ ...base, report: report({ reportStatus: 'signed', signedAt: '2026-07-04T00:00:00Z', technique: 'T', findings: 'F', conclusion: 'C' }) })
    expect(ex.final).toBe(true)
    expect(ex.watermarkKey).toBeNull()
    expect(ex.body).toEqual({ technique: 'T', findings: 'F', conclusion: 'C', recommendations: '' })  // empty stays empty
    expect(ex.patient.name).toBe('Awa Sy')
    expect(ex.radiologist.signed).toBe(true)
  })
  it('an unsigned report is NOT final and carries a draft watermark', () => {
    const ex = buildReportExport({ ...base, report: report({ reportStatus: 'draft' }) })
    expect(ex.final).toBe(false)
    expect(ex.watermarkKey).toBe('draft_watermark')
    expect(ex.radiologist.signed).toBe(false)
  })
})

// ── Migration safety ────────────────────────────────────────────────
describe('migration 067 safety', () => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '067_radiology.sql'), 'utf8')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  it('additive, surrogate-PK, clinic-scoped RLS, no auth.users, no composite-FK PK', () => {
    expect((code.match(/id\s+UUID PRIMARY KEY/g) ?? []).length).toBe(3)          // 3 surrogate PKs
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id|PRIMARY KEY \(order_id/)
    expect((code.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length).toBe(3)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('DB-enforces signed-report immutability (trigger + RAISE + amendment path)', () => {
    expect(code).toMatch(/guard_radiology_report_immutability/)
    expect(code).toMatch(/RAISE EXCEPTION 'Signed radiology reports are immutable/)
    expect(code).toMatch(/NEW\.report_status = 'amended' AND NEW\.version > OLD\.version/)
  })
  it('version history is APPEND-ONLY (no update/delete policy on versions)', () => {
    expect(code).toMatch(/radiology_report_versions_insert/)
    expect(code).not.toMatch(/radiology_report_versions_update/)
    expect(code).not.toMatch(/radiology_report_versions_delete/)
  })
})

// ── Security / safety invariants (source scans) ─────────────────────
describe('security & safety invariants', () => {
  const DIR = join(__dirname, '..', 'radiology')
  const libFiles = ['types.ts', 'worklist.ts', 'report.ts', 'structuring.ts', 'templates.ts', 'export.ts']

  it('the radiology engines import NO AI provider and perform NO image interpretation', () => {
    for (const f of libFiles) {
      const src = readFileSync(join(DIR, f), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/ai/)
      expect(src).not.toMatch(/anthropic|openai|createServiceClient|service_role/i)
      const codeOnly = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      expect(codeOnly).not.toMatch(/interpretImage|classifyImage|diagnoseImage|detectFinding|generateFinding|autoSign|autoDiagnos/i)
    }
  })
  it('structuring only SLICES source text (never generates)', () => {
    const src = readFileSync(join(DIR, 'structuring.ts'), 'utf8')
    expect(src).toMatch(/\.slice\(/)                 // routes substrings of the source
    expect(src).not.toMatch(/fetch\(|await /)         // no network, no async generation
  })
  it('the hooks use only the RLS client — no service_role, no auth.users, no clinics embed', () => {
    // Strip comment lines first — the hook DOCUMENTS these prohibitions in comments.
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useRadiology.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE|service_role/)
    expect(src).not.toMatch(/auth\.users/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('no radiology i18n string claims autonomous interpretation / diagnosis / auto-signing', () => {
    const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
    const FORBIDDEN = /autonomous|auto-?diagnos|ai-generated|generates? a diagnosis|image interpretation|interprets? images?|signs? automatically/i
    for (const [k, v] of Object.entries(en.radiology as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v as string)}`).toBe(`${k}:false`)
    }
  })
  it('fr/en radiology namespaces are at parity', () => {
    const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.radiology).sort()).toEqual(Object.keys(en.radiology).sort())
  })
})
