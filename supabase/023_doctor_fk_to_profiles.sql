-- ============================================================
-- Migration 023: add PostgREST-traversable FKs for doctor_id
-- ============================================================
-- Problem: consultations/appointments/lab_requests.doctor_id
-- references auth.users(id). PostgREST operates in the public
-- schema only and cannot traverse FKs into auth.users, so
-- any join hint like user_profiles!<fk> returns a 400.
--
-- Fix: add a second FK on each doctor_id column pointing to
-- public.user_profiles(id) — same underlying UUID, but now
-- PostgREST can resolve the join. Existing auth.users FK is
-- kept for referential integrity.
-- ============================================================

ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_doctor_profiles_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.user_profiles(id);

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_doctor_profiles_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.user_profiles(id);

ALTER TABLE public.lab_requests
  ADD CONSTRAINT lab_requests_doctor_profiles_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.user_profiles(id);
