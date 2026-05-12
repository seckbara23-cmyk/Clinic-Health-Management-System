// Supabase database types — replace with: npx supabase gen types typescript --project-id YOUR_ID
// This manual definition works with @supabase/supabase-js v2.x

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      clinics: {
        Row: {
          id: string
          name: string
          location: string
          phone: string | null
          email: string | null
          logo_url: string | null
          subscription_plan: string
          subscription_status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          location: string
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          subscription_plan?: string
          subscription_status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          location?: string
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          subscription_plan?: string
          subscription_status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          id: string
          clinic_id: string | null
          full_name: string
          email: string
          role: 'super_admin' | 'admin' | 'doctor' | 'receptionist' | 'nurse' | 'cashier'
          phone: string | null
          avatar_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          clinic_id?: string | null
          full_name: string
          email: string
          role?: string
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string | null
          full_name?: string
          email?: string
          role?: string
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      patients: {
        Row: {
          id: string
          clinic_id: string
          patient_number: string
          full_name: string
          date_of_birth: string | null
          gender: string | null
          phone: string | null
          email: string | null
          address: string | null
          emergency_contact: string | null
          emergency_phone: string | null
          blood_type: string | null
          allergies: string[] | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          patient_number?: string
          full_name: string
          date_of_birth?: string | null
          gender?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          blood_type?: string | null
          allergies?: string[] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          patient_number?: string
          full_name?: string
          date_of_birth?: string | null
          gender?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          blood_type?: string | null
          allergies?: string[] | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          id: string
          clinic_id: string
          patient_id: string
          doctor_id: string | null
          title: string
          scheduled_at: string
          duration_min: number
          status: string
          priority: string
          queue_number: number | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          patient_id: string
          doctor_id?: string | null
          title?: string
          scheduled_at: string
          duration_min?: number
          status?: string
          priority?: string
          queue_number?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          patient_id?: string
          doctor_id?: string | null
          title?: string
          scheduled_at?: string
          duration_min?: number
          status?: string
          priority?: string
          queue_number?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
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
          vital_signs: Json
          follow_up_date: string | null
          started_at: string | null
          ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          appointment_id?: string | null
          patient_id: string
          doctor_id: string
          chief_complaint?: string | null
          symptoms?: string | null
          diagnosis?: string | null
          treatment_plan?: string | null
          notes?: string | null
          vital_signs?: Json
          follow_up_date?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          appointment_id?: string | null
          patient_id?: string
          doctor_id?: string
          chief_complaint?: string | null
          symptoms?: string | null
          diagnosis?: string | null
          treatment_plan?: string | null
          notes?: string | null
          vital_signs?: Json
          follow_up_date?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      prescriptions: {
        Row: {
          id: string
          clinic_id: string
          consultation_id: string
          patient_id: string
          doctor_id: string
          medications: Json
          instructions: string | null
          valid_until: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          consultation_id: string
          patient_id: string
          doctor_id: string
          medications?: Json
          instructions?: string | null
          valid_until?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          consultation_id?: string
          patient_id?: string
          doctor_id?: string
          medications?: Json
          instructions?: string | null
          valid_until?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          clinic_id: string
          patient_id: string
          consultation_id: string | null
          invoice_number: string
          line_items: Json
          subtotal: number
          tax_amount: number
          discount_amount: number
          total_amount: number
          amount_paid: number
          currency: string
          status: string
          payment_method: string | null
          due_date: string | null
          paid_at: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          patient_id: string
          consultation_id?: string | null
          invoice_number?: string
          line_items?: Json
          subtotal?: number
          tax_amount?: number
          discount_amount?: number
          total_amount?: number
          amount_paid?: number
          currency?: string
          status?: string
          payment_method?: string | null
          due_date?: string | null
          paid_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          patient_id?: string
          consultation_id?: string | null
          invoice_number?: string
          line_items?: Json
          subtotal?: number
          tax_amount?: number
          discount_amount?: number
          total_amount?: number
          amount_paid?: number
          currency?: string
          status?: string
          payment_method?: string | null
          due_date?: string | null
          paid_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lab_requests: {
        Row: {
          id: string
          clinic_id: string
          consultation_id: string | null
          patient_id: string
          doctor_id: string
          test_name: string
          test_type: string
          priority: string
          status: string
          clinical_notes: string | null
          result_notes: string | null
          ordered_at: string
          resulted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          consultation_id?: string | null
          patient_id: string
          doctor_id: string
          test_name: string
          test_type?: string
          priority?: string
          status?: string
          clinical_notes?: string | null
          result_notes?: string | null
          ordered_at?: string
          resulted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          consultation_id?: string | null
          patient_id?: string
          doctor_id?: string
          test_name?: string
          test_type?: string
          priority?: string
          status?: string
          clinical_notes?: string | null
          result_notes?: string | null
          ordered_at?: string
          resulted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinic_invitations: {
        Row: {
          id: string
          clinic_id: string
          email: string
          role: string
          token: string
          invited_by: string | null
          accepted_at: string | null
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          email: string
          role?: string
          token?: string
          invited_by?: string | null
          accepted_at?: string | null
          expires_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          email?: string
          role?: string
          token?: string
          invited_by?: string | null
          accepted_at?: string | null
          expires_at?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_clinic_id: { Args: Record<PropertyKey, never>; Returns: string }
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      get_user_role: { Args: Record<PropertyKey, never>; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
