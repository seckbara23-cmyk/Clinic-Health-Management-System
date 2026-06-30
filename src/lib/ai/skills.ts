// ── AI Skills (revision #3) ───────────────────────────────────────
//
// Independent role copilots over the same infrastructure. Each skill exposes
// only the tools its role is permitted to use (derived from the registry, so a
// skill can never out-grant the tool's own role list) and ships page-first
// suggested prompts (revision #1). super_admin has no data skill — medical
// lockout means the Copilot has nothing to offer it beyond a notice.

import type { AISkill, AISuggestion } from './types'
import type { Role } from '@/types/database'
import { toolsForRole } from './tools'

function suggestions(skillId: string, items: Array<[string, string]>): AISuggestion[] {
  return items.map(([id, label]) => ({ id: `${skillId}:${id}`, label, prompt: label, skillId }))
}

function skill(id: string, label: string, role: Role, prompts: Array<[string, string]>): AISkill {
  return {
    id,
    label,
    roles: [role],
    toolIds: toolsForRole(role).map((t) => t.id),
    suggestedPrompts: suggestions(id, prompts),
  }
}

export const SKILLS: AISkill[] = [
  skill('reception_copilot', 'Reception Copilot', 'receptionist', [
    ['queue', "Summarize today's queue"],
    ['waiting', 'Who is waiting now?'],
  ]),
  skill('doctor_copilot', 'Doctor Copilot', 'doctor', [
    ['history', "Summarize this patient's history"],
    ['labs', 'Any critical lab results?'],
    ['pending_labs', 'Show pending lab orders'],
  ]),
  skill('nurse_copilot', 'Nurse Copilot', 'nurse', [
    ['queue', "Summarize today's queue"],
    ['history', "Summarize this patient's history"],
  ]),
  skill('laboratory_copilot', 'Laboratory Copilot', 'lab_technician', [
    ['pending', 'Show pending lab orders'],
    ['critical', 'Any critical results?'],
  ]),
  skill('pharmacy_copilot', 'Pharmacy Copilot', 'pharmacist', [
    ['low_stock', 'Which medicines are low stock?'],
    ['expiry', 'What is near expiry?'],
  ]),
  skill('cashier_copilot', 'Cashier Copilot', 'cashier', [
    ['unpaid', 'Show unpaid invoices'],
  ]),
  skill('administrator_copilot', 'Administrator Copilot', 'admin', [
    ['activity', "Summarize today's clinic activity"],
    ['queue', "Summarize today's queue"],
    ['unpaid', 'Show unpaid invoices'],
  ]),
  // super_admin: intentionally no tools (medical lockout).
  {
    id: 'platform_copilot',
    label: 'Platform Copilot',
    roles: ['super_admin'],
    toolIds: [],
    suggestedPrompts: [],
  },
]

export function skillForRole(role: Role): AISkill | undefined {
  return SKILLS.find((s) => s.roles.includes(role))
}
