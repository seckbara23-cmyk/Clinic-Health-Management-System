export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Role = 'super_admin' | 'admin' | 'doctor' | 'receptionist' | 'nurse' | 'cashier' | 'lab_technician' | 'pharmacist'
export type SubscriptionPlan = 'free' | 'basic' | 'pro' | 'enterprise'
export type SubscriptionStatus = 'active' | 'suspended' | 'cancelled'
export type ClinicStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'inactive' | 'archived'
export type ClinicRequestStatus = 'pending' | 'approved' | 'rejected'
export type Gender = 'male' | 'female' | 'other'
export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'
export type AppointmentStatus =
  | 'scheduled'       // booked, not yet arrived
  | 'waiting'         // patient arrived, waiting in waiting room
  | 'called'          // receptionist called patient's name
  | 'in_consultation' // actively with the doctor
  | 'completed'
  | 'cancelled'
  | 'no_show'
  // legacy values — kept for backward compat with existing rows
  | 'in_queue'
  | 'in_progress'
export type AppointmentPriority = 'normal' | 'urgent' | 'emergency'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled'
export type PaymentMethod = 'cash' | 'card' | 'mobile_money' | 'insurance' | 'other' | 'wave' | 'orange_money'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
export type PrescriptionStatus = 'active' | 'partially_dispensed' | 'dispensed' | 'expired' | 'cancelled'
export type LabRequestStatus = 'ordered' | 'collected' | 'processing' | 'resulted' | 'cancelled'
export type LabRequestType = 'blood' | 'urine' | 'imaging' | 'biopsy' | 'microbiology' | 'other'
// Senegal third-party payers: IPM (Institution de Prévoyance Maladie),
// mutuelle de santé, CNSS, IPRES, private insurer.
export type InsurancePayerType = 'ipm' | 'mutuelle' | 'cnss' | 'ipres' | 'private' | 'other'

// ─── SMS reminders ──────────────────────────────────────────────
export type SmsProviderId = 'orange_sms' | 'twilio'
export type SmsReminderType = 'appointment_24h' | 'appointment_same_day' | 'manual'
export type SmsStatus =
  | 'queued'     // enqueued, awaiting dispatch
  | 'sending'    // claimed by a dispatch worker
  | 'sent'       // accepted by a provider
  | 'delivered'  // provider delivery receipt confirmed (Phase 2)
  | 'failed'     // exhausted retries / non-retryable error
  | 'cancelled'  // cancelled before send
  | 'skipped'    // intentionally not sent (opt-out, no phone, etc.)

// ─── Compliance: consent + audit ────────────────────────────────
export type ConsentMethod = 'verbal' | 'written' | 'electronic'
export type AuditEntityType = 'patient' | 'appointment' | 'consultation' | 'prescription' | 'invoice' | 'export'
export type AuditEventAction = 'viewed' | 'updated' | 'soft_deleted' | 'restored' | 'exported'

// Soft-delete columns shared by every protected medical/billing table.
export interface SoftDeletable {
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
}

export interface Clinic {
  id: string
  name: string
  location: string
  phone: string | null
  email: string | null
  ninea: string | null
  rc_number: string | null
  sms_reminders_enabled: boolean
  reminder_24h_enabled: boolean
  reminder_same_day_enabled: boolean
  sms_sender_id: string | null
  logo_url: string | null
  subscription_plan: SubscriptionPlan
  subscription_status: SubscriptionStatus
  status: ClinicStatus
  onboarding_completed_at: string | null
  onboarding_step: number
  created_at: string
  updated_at: string
}

export interface ClinicRequest {
  id: string
  clinic_name: string
  location: string
  phone: string | null
  admin_full_name: string
  admin_email: string
  message: string | null
  status: ClinicRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  review_notes: string | null
  clinic_id: string | null
  created_user_id: string | null
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  clinic_id: string | null
  full_name: string
  email: string
  role: Role
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  must_change_password: boolean
  // Specialty identity (migration 037, additive — Phase 14.1).
  primary_specialty?: string | null
  sub_specialty?: string | null
  department?: string | null
  created_at: string
  updated_at: string
  clinic?: Clinic
}

// Per-(user, clinic) workspace personalization (migration 037, Phase 14.1).
export interface UserPreferences {
  user_id: string
  clinic_id: string
  preferences: Record<string, unknown>
  updated_at: string
}

export interface Patient {
  id: string
  clinic_id: string
  patient_number: string
  full_name: string
  date_of_birth: string | null
  gender: Gender | null
  phone: string | null
  email: string | null
  address: string | null
  emergency_contact: string | null
  emergency_phone: string | null
  blood_type: BloodType | null
  allergies: string[] | null
  cni: string | null
  insurance_payer_type: InsurancePayerType | null
  insurance_provider: string | null
  insurance_policy_number: string | null
  insurance_coverage_percent: number | null
  sms_opt_in: boolean
  sms_opt_out_at: string | null
  consent_given: boolean
  consent_date: string | null
  consent_method: ConsentMethod | null
  consent_notes: string | null
  consent_recorded_by: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Appointment {
  id: string
  clinic_id: string
  patient_id: string
  doctor_id: string | null
  title: string
  scheduled_at: string
  duration_min: number
  status: AppointmentStatus
  priority: AppointmentPriority
  queue_number: number | null
  arrived_at: string | null
  called_at: string | null
  last_reminder_sent_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient?: Patient
  doctor?: UserProfile
}

export interface VitalSigns {
  blood_pressure?: string
  heart_rate?: number
  temperature?: number
  weight?: number
  height?: number
  oxygen_saturation?: number
}

export interface Consultation {
  id: string
  clinic_id: string
  appointment_id: string | null
  patient_id: string
  doctor_id: string
  chief_complaint: string | null
  symptoms: string | null
  diagnosis: string | null
  treatment_plan: string | null
  notes: string | null
  vital_signs: VitalSigns
  follow_up_date: string | null
  started_at: string | null
  ended_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
  patient?: Patient
  doctor?: UserProfile
}

export interface Medication {
  name: string
  dosage: string
  frequency: string
  duration: string
  instructions?: string
  // Catalog link (optional — free-text entries leave these null). Snapshots so
  // the prescription stays correct even if the catalog later changes.
  medication_id?: string | null
  strength?: string | null
  dosage_form?: string | null
}

// Reference formulary row (migration 029; enriched by 032 — LNMPE 2025).
// Global, not clinic-scoped. therapeutic_class/source are populated for
// catalogued rows (e.g. source = 'LNMPE 2025') and NULL for legacy seed rows.
export interface CatalogMedication {
  id: string
  name: string
  strength: string | null
  dosage_form: string | null
  therapeutic_class?: string | null
  source?: string | null
  normalized_name?: string | null
  // Smart Pharmacy (migration 033, additive) — optional identifiers.
  barcode?: string | null
  manufacturer?: string | null
  brand_name?: string | null
  atc_code?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Pharmacy: inventory + dispensing (Phase 5B) ────────────────
export type StockMovementType = 'received' | 'dispensed' | 'adjustment' | 'expired' | 'damaged' | 'returned'
export type DispensingStatus = 'dispensed' | 'partial' | 'unavailable'

export interface ClinicMedicationInventory {
  id: string
  clinic_id: string
  medication_id: string
  stock_quantity: number       // maintained = sum of batch quantity_remaining
  reorder_level: number
  selling_price: number
  purchase_price: number
  supplier: string | null
  is_active: boolean
  // Smart Pharmacy (migration 033, additive) — physical shelf/bin location.
  location_cabinet?: string | null
  location_shelf?: string | null
  location_row?: string | null
  location_bin?: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
  medication?: CatalogMedication
}

// Smart Pharmacy cycle count (migration 033).
export interface MedicationCycleCount {
  id: string
  clinic_id: string
  inventory_id: string
  expected_qty: number
  counted_qty: number
  variance: number
  notes: string | null
  counted_by: string | null
  created_at: string
}

export interface MedicationBatch {
  id: string
  clinic_id: string
  inventory_id: string
  batch_number: string | null
  expiry_date: string | null
  quantity_received: number
  quantity_remaining: number
  purchase_price: number | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
}

export interface StockMovement {
  id: string
  clinic_id: string
  inventory_id: string | null
  batch_id: string | null
  medication_id: string | null
  movement_type: StockMovementType
  quantity_change: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  performed_by: string | null
  created_at: string
}

export interface MedicationDispensing {
  id: string
  clinic_id: string
  prescription_id: string
  patient_id: string
  prescription_line_index: number
  medication_id: string | null
  inventory_id: string | null
  medication_name: string
  quantity_prescribed: number
  quantity_dispensed: number
  unit_selling_price: number
  status: DispensingStatus
  substitution_notes: string | null
  unavailable_reason: string | null
  dispensed_by: string | null
  dispensed_at: string | null
  invoice_id: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
}

export interface Prescription {
  id: string
  clinic_id: string
  consultation_id: string
  patient_id: string
  doctor_id: string
  medications: Medication[]
  instructions: string | null
  valid_until: string | null
  status: PrescriptionStatus
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
  patient?: Patient
  doctor?: UserProfile
}

export interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export interface Invoice {
  id: string
  clinic_id: string
  patient_id: string
  consultation_id: string | null
  invoice_number: string
  line_items: LineItem[]
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  insurance_share: number
  patient_share: number   // generated: total_amount - insurance_share
  payer_type: InsurancePayerType | null
  payer_name: string | null
  currency: string
  status: InvoiceStatus
  payment_method: PaymentMethod | null
  payment_status: PaymentStatus | null
  payment_provider_reference: string | null
  provider_payload: Record<string, unknown> | null
  webhook_received_at: string | null
  due_date: string | null
  paid_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient?: Patient
}

export interface AuditEvent {
  id: string
  clinic_id: string
  user_id: string | null
  entity_type: string
  entity_id: string | null
  action: AuditEventAction
  metadata: Record<string, unknown>
  created_at: string
}

export interface PlatformBillingSummary {
  clinic_id: string
  clinic_name: string
  invoice_count: number
  total_invoiced: number
  total_collected: number
  pending_count: number
  online_count: number
}

export interface PaymentEvent {
  id: string
  clinic_id: string
  invoice_id: string
  provider: 'wave' | 'orange_money' | 'manual'
  event_type: string
  provider_ref: string | null
  amount: number | null
  currency: string
  status: string | null
  payload: Record<string, unknown> | null
  received_at: string
  created_at: string
}

export interface SmsMessage {
  id: string
  clinic_id: string
  patient_id: string | null
  appointment_id: string | null
  reminder_type: SmsReminderType
  to_phone: string
  body: string
  status: SmsStatus
  provider: SmsProviderId | null
  provider_message_id: string | null
  attempts: number
  max_attempts: number
  segments: number | null
  cost_amount: number | null
  cost_currency: string | null
  scheduled_for: string
  next_attempt_at: string
  queued_at: string
  sent_at: string | null
  delivered_at: string | null
  failed_at: string | null
  last_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient?: Patient
}

export interface SmsDeliveryEvent {
  id: string
  clinic_id: string
  sms_message_id: string
  provider: SmsProviderId | null
  event_type: 'queued' | 'dispatch_attempt' | 'accepted' | 'delivery_receipt' | 'failed'
  provider_ref: string | null
  status: string | null
  payload: Record<string, unknown> | null
  received_at: string
}

export interface LabRequest {
  id: string
  clinic_id: string
  consultation_id: string | null
  patient_id: string
  doctor_id: string
  test_name: string
  test_type: LabRequestType
  priority: AppointmentPriority
  status: LabRequestStatus
  clinical_notes: string | null
  result_notes: string | null
  ordered_at: string
  resulted_at: string | null
  created_at: string
  updated_at: string
  patient?: Patient
  doctor?: UserProfile
}

// ─── Laboratory module (Phase 4) ────────────────────────────────
export type LabOrderStatus =
  | 'ordered'
  | 'sample_collected'
  | 'sample_rejected'
  | 'in_progress'
  | 'completed'
  | 'reviewed'
  | 'cancelled'
export type LabResultFlag = 'normal' | 'abnormal' | 'high' | 'low' | 'critical'

export interface LabTest {
  id: string
  clinic_id: string
  name: string
  category: string | null
  sample_type: string | null
  unit: string | null
  normal_range_low: number | null
  normal_range_high: number | null
  normal_range_text: string | null
  price: number
  currency: string
  is_active: boolean
  sort_order: number
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
}

export interface LabOrderItem {
  id: string
  clinic_id: string
  lab_order_id: string
  patient_id: string
  lab_test_id: string | null
  test_name: string
  unit: string | null
  normal_range_low: number | null
  normal_range_high: number | null
  normal_range_text: string | null
  price: number
  result_value: string | null
  result_numeric: number | null
  flag: LabResultFlag
  result_notes: string | null
  resulted_by: string | null
  resulted_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
}

export interface LabOrder {
  id: string
  clinic_id: string
  patient_id: string
  consultation_id: string | null
  ordered_by: string
  patient_name: string | null
  patient_number: string | null
  status: LabOrderStatus
  priority: AppointmentPriority
  clinical_notes: string | null
  sample_collected_at: string | null
  completed_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  interpretation: string | null
  invoice_id: string | null
  // Sample tracking (migration 035, additive).
  sample_id?: string | null
  sample_barcode?: string | null
  collected_by?: string | null
  received_at?: string | null
  received_by?: string | null
  processing_started_at?: string | null
  deleted_at: string | null
  deleted_by: string | null
  deletion_reason: string | null
  created_at: string
  updated_at: string
  items?: LabOrderItem[]
  doctor?: UserProfile
  reviewer?: UserProfile
}

export interface LabOrderPatientIdentity {
  full_name: string
  patient_number: string
  cni: string | null
  date_of_birth: string | null
  gender: string | null
}

export interface ClinicInvitation {
  id: string
  clinic_id: string
  email: string
  role: Exclude<Role, 'super_admin'>
  token: string
  invited_by: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export interface ClinicService {
  id: string
  clinic_id: string
  name: string
  description: string | null
  price: number
  currency: string
  duration_min: number | null
  category: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ConsultationVitals {
  id: string
  clinic_id: string
  patient_id: string
  consultation_id: string
  systolic_bp: number | null
  diastolic_bp: number | null
  heart_rate: number | null
  respiratory_rate: number | null
  spo2: number | null
  weight_kg: number | null
  height_cm: number | null
  bmi: number | null
  temperature_c: number | null
  blood_glucose: number | null
  pain_scale: number | null
  notes: string | null
  recorded_by: string
  created_at: string
}

// ─── Dashboard Stats ────────────────────────────────────────────
export interface DashboardStats {
  total_patients: number
  appointments_today: number
  appointments_pending: number
  consultations_today: number
  unpaid_invoices: number
  revenue_today: number
  revenue_month: number
  active_queue: number
}
