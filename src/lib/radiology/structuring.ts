// ── Radiology dictation structuring — pure engine (Phase 39) ──────
//
// DETERMINISTIC structuring of radiologist-dictated French text into report
// sections (Technique / Résultats / Conclusion / Recommandations). This is NOT an
// LLM and does NOT interpret images:
//   • It only ever SLICES substrings out of the source dictation and routes them
//     to sections by recognizing French section headers at the start of a line.
//   • It NEVER generates new text, so — by construction — it cannot invent a
//     finding or add an observation absent from the source. `structurePreserves
//     Source()` proves this at the token level (output tokens ⊆ source tokens).
//   • It preserves the radiologist's exact wording (and therefore any uncertainty).
//   • Its output is ALWAYS a DRAFT; the radiologist must review, edit and sign.

export interface StructuredReport {
  technique: string
  resultats: string
  conclusion: string
  recommandations: string
}

type Section = keyof StructuredReport

// Length-preserving lowercasing + de-accenting (1:1 char map) so a marker matched
// on the normalized line maps to the SAME index in the original line — letting us
// strip only the header keyword while keeping the body text verbatim.
const ACCENTS: Record<string, string> = {
  à: 'a', â: 'a', ä: 'a', á: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e',
  î: 'i', ï: 'i', í: 'i', ô: 'o', ö: 'o', ó: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ç: 'c',
}
function normalizeLen(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) out += ACCENTS[ch] ?? ch
  return out
}

// Section headers recognized ONLY at the start of a line (never mid-sentence).
const MARKERS: { section: Section; re: RegExp }[] = [
  { section: 'technique', re: /^\s*technique\s*[:.\-–]?\s*/ },
  { section: 'resultats', re: /^\s*(resultats?|observations?|description)\s*[:.\-–]?\s*/ },
  { section: 'conclusion', re: /^\s*(conclusion|impression|synthese|au total)\s*[:.\-–]?\s*/ },
  { section: 'recommandations', re: /^\s*(recommandations?|conduite a tenir|\bcat\b)\s*[:.\-–]?\s*/ },
]

/** Structure dictated text into report sections WITHOUT inventing content.
 *  Leading text (before any header) is treated as observations (Résultats). */
export function structureDictation(raw: string | null | undefined): StructuredReport {
  const out: Record<Section, string[]> = { technique: [], resultats: [], conclusion: [], recommandations: [] }
  const text = raw ?? ''
  let current: Section = 'resultats'
  for (const line of text.split(/\r?\n/)) {
    const norm = normalizeLen(line)
    let matched: { section: Section; re: RegExp } | null = null
    for (const m of MARKERS) { if (m.re.test(norm)) { matched = m; break } }
    if (matched) {
      current = matched.section
      const mm = norm.match(matched.re)!
      const rest = line.slice(mm[0].length) // original remainder, verbatim
      if (rest.trim()) out[current].push(rest)
    } else {
      out[current].push(line)
    }
  }
  return {
    technique: out.technique.join('\n').trim(),
    resultats: out.resultats.join('\n').trim(),
    conclusion: out.conclusion.join('\n').trim(),
    recommandations: out.recommandations.join('\n').trim(),
  }
}

/** Word tokens (lowercased, de-accented) — used to prove content preservation. */
export function tokenize(s: string | null | undefined): string[] {
  return normalizeLen(s ?? '').split(/[^a-z0-9]+/).filter(Boolean)
}

/** TRUE iff every token in the structured output also appears in the source — i.e.
 *  the structuring invented NOTHING. This is the core safety guarantee and is
 *  guarded in tests. */
export function structurePreservesSource(raw: string | null | undefined, structured: StructuredReport): boolean {
  const source = new Set(tokenize(raw))
  const output = tokenize([structured.technique, structured.resultats, structured.conclusion, structured.recommandations].join('\n'))
  return output.every(tok => source.has(tok))
}

/** The set of source tokens dropped by structuring — must only ever be section
 *  header keywords (never clinical content). Used by tests. */
export function droppedTokens(raw: string | null | undefined, structured: StructuredReport): string[] {
  const output = new Set(tokenize([structured.technique, structured.resultats, structured.conclusion, structured.recommandations].join('\n')))
  return tokenize(raw).filter(tok => !output.has(tok))
}

/** Structuring output is ALWAYS a draft; the radiologist must confirm. */
export const STRUCTURING_IS_DRAFT = true as const
