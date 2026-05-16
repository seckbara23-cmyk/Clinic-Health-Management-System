export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Role = 'super_admin' | 'admin' | 'doctor' | 'receptionist' | 'nurse' | 'cashier'
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
export type PrescriptionStatus = 'active' | 'dispensed' | 'expired' | 'cancelled'
export type LabRequestStatus = 'ordered' | 'collected' | 'processing' | 'resulted' | 'cancelled'
export type LabRequestType = 'blood' | 'urine' | 'imaging' | 'biopsy' | 'microbiology' | 'other'

export interface Clinic {
  id: string
  name: string
  location: string
  phone: string | null
  email: string | null
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
  created_at: string
  updated_at: string
  clinic?: Clinic
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
  currency: string
  status: InvoiceStatus
  payment_method: PaymentMethod | null
  payment_status: PaymentStatus | null
  payment_provider_reference: string | null
  provider_payload: Record<string, unknown> | null
  webhook_received_at: string | null
  due_date: string | null
  paid_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  patient?: Patient
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
