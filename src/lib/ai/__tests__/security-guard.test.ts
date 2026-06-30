import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// Static security guard: the AI module must never reach data outside the user's
// RLS session. That means NO import of the service-role client anywhere, and
// only the orchestrator (context.ts) may import the RLS server client; tools and
// providers stay client-agnostic (the client is injected).

const AI_ROOT = join(__dirname, '..')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...tsFiles(full))
    } else if (name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('AI security guard (static)', () => {
  const files = tsFiles(AI_ROOT)

  it('finds the AI source files', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('NEVER imports the service-role client or references it', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/supabase\/service/)
      expect(src).not.toMatch(/createServiceClient/)
      expect(src).not.toMatch(/SERVICE_ROLE/)
    }
  })

  it('only context.ts imports the RLS server client', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (/@\/lib\/supabase\/server/.test(src)) {
        expect(f.endsWith('context.ts')).toBe(true)
      }
    }
  })

  it('makes no raw external network calls in the core (deterministic provider)', () => {
    const provider = readFileSync(join(AI_ROOT, 'providers', 'deterministic.ts'), 'utf8')
    expect(provider).not.toMatch(/fetch\(/)
    expect(provider).not.toMatch(/https?:\/\//)
  })
})
