import { readFileSync } from 'fs'
import { join } from 'path'
import { localeToHtmlLang } from '../locale/lang'

const SRC = join(__dirname, '..', '..')

// ── Locale → <html lang> mapping (pure, French-first) ──────────────
describe('localeToHtmlLang', () => {
  it('maps the French locale to Senegal French (fr → fr-SN)', () => {
    expect(localeToHtmlLang('fr')).toBe('fr-SN')
  })
  it('maps the English locale to English (en → en)', () => {
    expect(localeToHtmlLang('en')).toBe('en')
  })
  it('falls back to French (fr-SN) for an unknown / absent locale — never English', () => {
    expect(localeToHtmlLang('de')).toBe('fr-SN')
    expect(localeToHtmlLang('')).toBe('fr-SN')
    expect(localeToHtmlLang(undefined)).toBe('fr-SN')
    expect(localeToHtmlLang(null)).toBe('fr-SN')
  })
  it('only ever emits fr-SN or en (never a bare "fr" that some dictionaries miss)', () => {
    for (const l of ['fr', 'en', 'de', '', undefined, null]) {
      expect(['fr-SN', 'en']).toContain(localeToHtmlLang(l as string | null | undefined))
    }
  })
})

// ── Root document language (the actual fix — form controls inherit it) ─
describe('root <html lang> is locale-driven (French-first)', () => {
  const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')

  it('the root layout derives <html lang> from the locale via localeToHtmlLang', () => {
    expect(layout).toMatch(/import\s*\{\s*localeToHtmlLang\s*\}\s*from\s*'@\/lib\/locale\/lang'/)
    expect(layout).toMatch(/lang=\{localeToHtmlLang\(locale\)\}/)
    // Must NOT emit the raw locale ("fr"/"en") — that skips the region tag.
    expect(layout).not.toMatch(/<html\s+lang=\{locale\}/)
  })

  it('the global error boundary declares French (fr-SN), never English', () => {
    const globalError = readFileSync(join(SRC, 'app', 'global-error.tsx'), 'utf8')
    expect(globalError).toMatch(/<html\s+lang="fr-SN">/)
    expect(globalError).not.toMatch(/lang="en"/)
  })
})

// ── Form primitives inherit + forward lang; spellcheck stays enabled ─
describe('shared form controls do not break language inheritance', () => {
  const files = {
    textarea: readFileSync(join(SRC, 'components', 'ui', 'textarea.tsx'), 'utf8'),
    input: readFileSync(join(SRC, 'components', 'ui', 'input.tsx'), 'utf8'),
  }

  it('Textarea/Input forward all props (so a caller-supplied lang passes through)', () => {
    for (const src of Object.values(files)) expect(src).toMatch(/\{\.\.\.props\}/)
  })

  it('Textarea/Input never hardcode a language or disable spellcheck (inheritance from <html> must win)', () => {
    for (const src of Object.values(files)) {
      expect(src).not.toMatch(/lang=/)                       // no hardcoded language override
      expect(src).not.toMatch(/spell[Cc]heck=\{?false\}?/)  // never disabled
    }
  })
})
