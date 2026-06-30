import { SKILLS, skillForRole } from '../skills'
import { toolsForRole } from '../tools'
import type { Role } from '@/types/database'

describe('AI skills', () => {
  it('every skill exposes only tools its role is permitted to use', () => {
    for (const s of SKILLS) {
      const allowed = new Set(toolsForRole(s.roles[0]).map((t) => t.id))
      for (const id of s.toolIds) expect(allowed.has(id)).toBe(true)
    }
  })

  it('covers each clinical role with a copilot', () => {
    const roles: Role[] = [
      'receptionist',
      'doctor',
      'nurse',
      'lab_technician',
      'pharmacist',
      'cashier',
      'admin',
    ]
    for (const r of roles) {
      const s = skillForRole(r)
      expect(s).toBeDefined()
      expect(s!.suggestedPrompts.length).toBeGreaterThan(0)
    }
  })

  it('super_admin skill exposes no tools (medical lockout)', () => {
    expect(skillForRole('super_admin')?.toolIds).toEqual([])
  })

  it('pharmacy copilot suggests low-stock', () => {
    const s = skillForRole('pharmacist')!
    expect(s.suggestedPrompts.some((p) => /low stock/i.test(p.label))).toBe(true)
  })
})
