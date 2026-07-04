import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// ── Enterprise security gate (Phase 13) ───────────────────────────
// The service-role Supabase client bypasses RLS and must NEVER be reachable
// from client-rendered code. It is only allowed in server API routes and two
// server-only libs. This test walks the whole src tree and fails the build if
// anything else imports it — a hard, permanent guard against a tenant leak.

const SRC = join(__dirname, '..', '..') // src/

// Server-only locations permitted to use the service role.
const ALLOWED = [
  join('app', 'api'),               // route handlers (server)
  join('lib', 'supabase', 'service.ts'),
  join('lib', 'audit.ts'),          // server-side audit writer
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function isAllowed(file: string): boolean {
  const rel = file.slice(SRC.length + 1)
  return ALLOWED.some(a => rel.startsWith(a) || rel === a)
}

describe('no service_role in client code', () => {
  const files = walk(SRC)

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('only server routes / server libs reference the service-role client', () => {
    const offenders = files.filter(f => {
      if (isAllowed(f)) return false
      const src = readFileSync(f, 'utf8')
      return /createServiceClient|SUPABASE_SERVICE_ROLE|service_role/.test(src)
    }).map(f => f.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it("client Supabase clients don't smuggle the service key", () => {
    const clientLib = readFileSync(join(SRC, 'lib', 'supabase', 'client.ts'), 'utf8')
    expect(clientLib).not.toMatch(/SERVICE_ROLE/)
  })
})
