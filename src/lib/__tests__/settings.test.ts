import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canEditSettings, canViewSection, visibleSections, searchSettings,
  mergeSectionValues, changedKeys, hasUnsavedChanges, pickSectionValues,
} from '../settings/logic'
import { SETTINGS_SECTIONS, getSection, sectionDefaults } from '../settings/registry'

describe('settings permissions (role behavior)', () => {
  it('only admin / super_admin may edit', () => {
    expect(canEditSettings('admin')).toBe(true)
    expect(canEditSettings('super_admin')).toBe(true)
    for (const r of ['doctor', 'nurse', 'pharmacist', 'lab_technician', 'receptionist', 'cashier', '']) {
      expect(canEditSettings(r)).toBe(false)
    }
    expect(canEditSettings(null)).toBe(false)
  })

  it('restricts sensitive sections (users/audit) to admins', () => {
    const users = getSection('users')!
    expect(canViewSection(users, 'admin')).toBe(true)
    expect(canViewSection(users, 'doctor')).toBe(false)
    const pharmacy = getSection('pharmacy')!
    expect(canViewSection(pharmacy, 'doctor')).toBe(true) // read-only, but visible
  })

  it('hides restricted sections from non-admins', () => {
    const doctorSections = visibleSections('doctor').map(s => s.id)
    expect(doctorSections).not.toContain('users')
    expect(doctorSections).not.toContain('audit')
    expect(doctorSections).toContain('pharmacy')
    expect(visibleSections('admin').length).toBe(SETTINGS_SECTIONS.length)
  })
})

describe('settings search', () => {
  it('jumps "SMS" to the SMS reminders section under the Communication category', () => {
    const hits = searchSettings('SMS', 'admin')
    const smsHit = hits.find(h => h.section.id === 'sms')
    expect(smsHit).toBeDefined()
    expect(smsHit!.section.category).toBe('communication')
  })
  it('matches by keyword across sections', () => {
    expect(searchSettings('expiry', 'admin').map(h => h.section.id)).toContain('pharmacy')
    expect(searchSettings('barcode', 'admin').map(h => h.section.id).sort()).toEqual(
      expect.arrayContaining(['pharmacy']),
    )
  })
  it('respects role visibility (a doctor cannot search into users)', () => {
    expect(searchSettings('invitations', 'doctor').map(h => h.section.id)).not.toContain('users')
    expect(searchSettings('invitations', 'admin').map(h => h.section.id)).toContain('users')
  })
  it('returns nothing for an empty query', () => {
    expect(searchSettings('   ', 'admin')).toEqual([])
  })
})

describe('value merge + tenant isolation', () => {
  it('layers stored values over defaults, ignoring nulls', () => {
    const pharmacy = getSection('pharmacy')!
    const merged = mergeSectionValues(pharmacy, { low_stock_threshold: 25, fefo_enabled: null as unknown as number })
    expect(merged.low_stock_threshold).toBe(25)       // stored wins
    expect(merged.fefo_enabled).toBe(true)             // null → default
    expect(merged.expiry_warning_days).toBe(90)        // untouched → default
  })
  it('two tenants never share values (pure per-input transform)', () => {
    const pharmacy = getSection('pharmacy')!
    const a = mergeSectionValues(pharmacy, { low_stock_threshold: 5 })
    const b = mergeSectionValues(pharmacy, { low_stock_threshold: 500 })
    expect(a.low_stock_threshold).toBe(5)
    expect(b.low_stock_threshold).toBe(500)            // no cross-contamination
    expect(sectionDefaults(pharmacy).low_stock_threshold).toBe(10) // defaults unchanged
  })
  it('pickSectionValues drops unknown keys', () => {
    const pharmacy = getSection('pharmacy')!
    const picked = pickSectionValues(pharmacy, { low_stock_threshold: 7, hacker_key: 'x' } as never)
    expect(picked.low_stock_threshold).toBe(7)
    expect('hacker_key' in picked).toBe(false)
  })
})

describe('unsaved-change detection', () => {
  it('detects and lists changed keys', () => {
    const saved = { a: 1, b: true, c: 'x' }
    expect(hasUnsavedChanges(saved, { a: 1, b: true, c: 'x' })).toBe(false)
    expect(hasUnsavedChanges(saved, { a: 2, b: true, c: 'x' })).toBe(true)
    expect(changedKeys(saved, { a: 2, b: false, c: 'x' })).toEqual(['a', 'b'])
  })
})

describe('registry integrity', () => {
  it('has unique section ids and non-empty field keys', () => {
    const ids = SETTINGS_SECTIONS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SETTINGS_SECTIONS) {
      for (const f of s.fields) expect(f.key).toBeTruthy()
    }
  })
})

describe('security invariants', () => {
  it('registry + logic import no Supabase client / service role and never write', () => {
    for (const file of ['registry.ts', 'logic.ts']) {
      const src = readFileSync(join(__dirname, '..', 'settings', file), 'utf8')
      expect(src).not.toMatch(/import[^\n]*supabase/i)
      expect(src).not.toMatch(/createClient|service_role|SERVICE_ROLE|serviceRole/)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })
})
