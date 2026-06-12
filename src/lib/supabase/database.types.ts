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
          ninea: string | null
          rc_number: string | null
          sms_reminders_enabled: boolean
          reminder_24h_enabled: boolean
          reminder_same_day_enabled: boolean
          sms_sender_id: string | null
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
          ninea?: string | null
          rc_number?: string | null
          sms_reminders_enabled?: boolean
          reminder_24h_enabled?: boolean
          reminder_same_day_enabled?: boolean
          sms_sender_id?: string | null
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
          ninea?: string | null
          rc_number?: string | null
          sms_reminders_enabled?: boolean
          reminder_24h_enabled?: boolean
          reminder_same_day_enabled?: boolean
          sms_sender_id?: string | null
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
          cni: string | null
          insurance_payer_type: string | null
          insurance_provider: string | null
          insurance_policy_number: string | null
          insurance_coverage_percent: number | null
          sms_opt_in: boolean
          sms_opt_out_at: string | null
          consent_given: boolean
          consent_date: string | null
          consent_method: string | null
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
          cni?: string | null
          insurance_payer_type?: string | null
          insurance_provider?: string | null
          insurance_policy_number?: string | null
          insurance_coverage_percent?: number | null
          sms_opt_in?: boolean
          sms_opt_out_at?: string | null
          consent_given?: boolean
          consent_date?: string | null
          consent_method?: string | null
          consent_notes?: string | null
          consent_recorded_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
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
          cni?: string | null
          insurance_payer_type?: string | null
          insurance_provider?: string | null
          insurance_policy_number?: string | null
          insurance_coverage_percent?: number | null
          sms_opt_in?: boolean
          sms_opt_out_at?: string | null
          consent_given?: boolean
          consent_date?: string | null
          consent_method?: string | null
          consent_notes?: string | null
          consent_recorded_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
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
          last_reminder_sent_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
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
          last_reminder_sent_at?: string | null
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
          last_reminder_sent_at?: string | null
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
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
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
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
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
          insurance_share: number
          patient_share: number
          payer_type: string | null
          payer_name: string | null
          currency: string
          status: string
          payment_method: string | null
          due_date: string | null
          paid_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
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
          insurance_share?: number
          payer_type?: string | null
          payer_name?: string | null
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
          insurance_share?: number
          payer_type?: string | null
          payer_name?: string | null
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
      sms_messages: {
        Row: {
          id: string
          clinic_id: string
          patient_id: string | null
          appointment_id: string | null
          reminder_type: string
          to_phone: string
          body: string
          status: string
          provider: string | null
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
        }
        Insert: {
          id?: string
          clinic_id: string
          patient_id?: string | null
          appointment_id?: string | null
          reminder_type: string
          to_phone: string
          body: string
          status?: string
          provider?: string | null
          provider_message_id?: string | null
          attempts?: number
          max_attempts?: number
          segments?: number | null
          cost_amount?: number | null
          cost_currency?: string | null
          scheduled_for?: string
          next_attempt_at?: string
          queued_at?: string
          sent_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          patient_id?: string | null
          appointment_id?: string | null
          reminder_type?: string
          to_phone?: string
          body?: string
          status?: string
          provider?: string | null
          provider_message_id?: string | null
          attempts?: number
          max_attempts?: number
          segments?: number | null
          cost_amount?: number | null
          cost_currency?: string | null
          scheduled_for?: string
          next_attempt_at?: string
          queued_at?: string
          sent_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_delivery_events: {
        Row: {
          id: string
          clinic_id: string
          sms_message_id: string
          provider: string | null
          event_type: string
          provider_ref: string | null
          status: string | null
          payload: Json | null
          received_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          sms_message_id: string
          provider?: string | null
          event_type: string
          provider_ref?: string | null
          status?: string | null
          payload?: Json | null
          received_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          sms_message_id?: string
          provider?: string | null
          event_type?: string
          provider_ref?: string | null
          status?: string | null
          payload?: Json | null
          received_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          id: string
          clinic_id: string
          user_id: string | null
          entity_type: string
          entity_id: string | null
          action: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          clinic_id: string
          user_id?: string | null
          entity_type: string
          entity_id?: string | null
          action: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          clinic_id?: string
          user_id?: string | null
          entity_type?: string
          entity_id?: string | null
          action?: string
          metadata?: Json
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
      claim_sms_batch: { Args: { p_limit?: number }; Returns: Database['public']['Tables']['sms_messages']['Row'][] }
      log_record_view: { Args: { p_entity: string; p_id: string; p_ip?: string | null; p_ua?: string | null }; Returns: undefined }
      soft_delete_record: { Args: { p_entity: string; p_id: string; p_reason?: string | null; p_ip?: string | null; p_ua?: string | null }; Returns: undefined }
      restore_record: { Args: { p_entity: string; p_id: string; p_ip?: string | null; p_ua?: string | null }; Returns: undefined }
      get_platform_billing_summary: {
        Args: Record<PropertyKey, never>
        Returns: {
          clinic_id: string
          clinic_name: string
          invoice_count: number
          total_invoiced: number
          total_collected: number
          pending_count: number
          online_count: number
        }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
