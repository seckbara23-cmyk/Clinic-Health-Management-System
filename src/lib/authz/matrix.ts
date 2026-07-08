// ── Enterprise Authorization — Default access matrix (Phase 40) ───
//
// The DEFAULT least-privilege permission grants per role. This matrix is the
// registry-driven source of truth for page / button / field visibility. It is
// designed to reproduce EXACTLY the access the platform grants today (the current
// Sidebar role map), so switching the UI onto `can()` is a zero-regression change.
//
// IMPORTANT — this is a UI/UX authorization layer, NOT the security boundary. The
// database RLS remains the enforcement boundary and is UNCHANGED. A permission
// here can never grant access the DB would refuse; it only decides what to show
// and which buttons to enable. Custom grants and specialty refinements layer on
// top of this in the engine.
//
// Wildcards: `<module>.*` grants every action the module exposes; `*` grants all.

import type { Role } from '@/types/database'

export const DEFAULT_MATRIX: Record<Role, string[]> = {
  // ── Platform owner. Sees the admin surface + operational modules. Deliberately
  // does NOT get AI copilots (super_admin is zero-tool for AI) nor psychiatry
  // notes (confidential care-team only). Full field access otherwise.
  super_admin: [
    'dashboard.view',
    'patients.*',
    'queue.*', 'appointments.*',
    'consultations.view', 'consultations.edit',
    'prescriptions.view',
    'laboratory.*', 'radiology.view',
    'pharmacy.*', 'billing.*', 'finance.*',
    'inventory.*', 'reports.*', 'documents.*',
    'workforce.*', 'hr.*',
    'settings.*', 'administration.*',
    'field.national_id', 'field.insurance_number', 'field.financial',
    'field.medical_history', 'field.salary',
  ],

  // ── Clinic administrator. Same operational reach within the clinic. Part of the
  // care team → may read psychiatry notes. Finance = view + approve (not raw export
  // by default; adjustable via custom grants).
  admin: [
    'dashboard.view',
    'patients.*',
    'queue.*', 'appointments.*',
    'consultations.view', 'consultations.edit',
    'prescriptions.view',
    'laboratory.*', 'radiology.view',
    'pharmacy.*', 'billing.*',
    'finance.view', 'finance.approve',
    'inventory.*', 'reports.*', 'documents.*',
    'workforce.*', 'hr.*',
    'settings.*', 'administration.*',
    'field.national_id', 'field.insurance_number', 'field.financial',
    'field.medical_history', 'field.salary', 'field.psychiatry_notes',
  ],

  // ── Clinician. Consultations, prescriptions, orders, AI copilots. Care team →
  // psychiatry notes + medical history. radiology.sign is granted only when the
  // doctor's specialty is radiology (resolved in the engine, not here).
  doctor: [
    'dashboard.view',
    'patients.view', 'patients.create', 'patients.edit',
    'queue.view',
    'appointments.view', 'appointments.create',
    'consultations.view', 'consultations.create', 'consultations.edit', 'consultations.sign',
    'prescriptions.view', 'prescriptions.create', 'prescriptions.edit',
    'laboratory.view', 'laboratory.create',
    'radiology.view', 'radiology.report',
    'pharmacy.catalog',
    'billing.view',
    'documents.view', 'documents.create', 'documents.print',
    'ai.view',
    'settings.view',
    'field.national_id', 'field.medical_history', 'field.psychiatry_notes',
  ],

  // ── Nurse. Vitals, med administration, orders on assigned patients. Care team →
  // psychiatry notes + medical history. No finance/HR/salary.
  nurse: [
    'dashboard.view',
    'patients.view',
    'queue.view',
    'appointments.view',
    'consultations.view',
    'prescriptions.view', 'prescriptions.create',
    'laboratory.view',
    'pharmacy.catalog',
    'documents.view',
    'settings.view',
    'field.national_id', 'field.medical_history', 'field.psychiatry_notes',
  ],

  // ── Reception. Registration, demographics, scheduling, front-desk billing view.
  // Insurance number visible (needed at registration). No clinical content.
  receptionist: [
    'dashboard.view',
    'patients.view', 'patients.create',
    'queue.view',
    'appointments.view', 'appointments.create', 'appointments.edit',
    'appointments.cancel', 'appointments.schedule',
    'billing.view',
    'documents.view',
    'settings.view',
    'field.national_id', 'field.insurance_number',
  ],

  // ── Cashier. Payments, receipts, balances, insurance. Financial field access;
  // no clinical modules, no AI, no HR.
  cashier: [
    'dashboard.view',
    'patients.view',
    'billing.view', 'billing.payment',
    'settings.view',
    'field.insurance_number', 'field.financial',
  ],

  // ── Lab technician. Lab worklist, sample handling, result entry & verification.
  // Lab-scoped only.
  lab_technician: [
    'dashboard.view',
    'laboratory.view', 'laboratory.result_entry', 'laboratory.verify',
    'settings.view',
  ],

  // ── Pharmacist. Dispensing, inventory, stock, catalog, scanning. No HR/payroll.
  pharmacist: [
    'dashboard.view',
    'pharmacy.view', 'pharmacy.dispense', 'pharmacy.inventory',
    'pharmacy.reports', 'pharmacy.catalog', 'pharmacy.scan',
    'inventory.view',
    'settings.view',
  ],
}

export const ROLES = Object.keys(DEFAULT_MATRIX) as Role[]

export function defaultGrantsFor(role?: Role | string | null): string[] {
  if (!role) return []
  return DEFAULT_MATRIX[role as Role] ?? []
}
