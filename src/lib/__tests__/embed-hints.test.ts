import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// ── PostgREST embed-hint guard (engineering standard) ─────────────
// Migration 037 (user_preferences: PK (user_id, clinic_id)) made PostgREST infer
// a second, junction relationship between user_profiles and clinics. Any
// UN-HINTED embed of clinics then fails with PGRST201, which caused the P0
// universal login lockout. This test enforces the permanent rule:
//
//   EVERY clinics embed MUST pin the direct FK (clinics!user_profiles_clinic_id_fkey).
//
// A hinted embed reads `clinics!<fk>(…)`, so the literal substring `clinics(`
// only ever appears in an UN-HINTED embed. `.from('clinics')` does not contain
// `clinics(`. We fail the build if any source file contains the un-hinted marker.

const SRC = join(__dirname, '..', '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry) && entry !== 'database.types.ts') {
      out.push(full)
    }
  }
  return out
}

describe('PostgREST clinics embeds are FK-hinted (no PGRST201 lockout)', () => {
  const files = walk(SRC)

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no source file contains an un-hinted `clinics(` embed', () => {
    const offenders = files
      .filter(f => /clinics\(/.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it('the four critical user_profiles→clinics call sites use the direct FK hint', () => {
    const HINT = 'clinics!user_profiles_clinic_id_fkey'
    const mustHint = [
      join('app', '(dashboard)', 'layout.tsx'),
      join('context', 'ClinicContext.tsx'),
      join('app', 'api', 'auth', 'change-password', 'route.ts'),
      join('app', '(dashboard)', 'admin', 'users', 'page.tsx'),
    ]
    for (const rel of mustHint) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src.includes(HINT)).toBe(true)
    }
  })
})
