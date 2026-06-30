-- ════════════════════════════════════════════════════════════════
-- 031 — AI Copilot audit tables (CHMS Intelligence Platform, Layer 1)
-- ════════════════════════════════════════════════════════════════
--
-- Clinic-scoped, RLS-enforced audit log for the read-only Copilot. Stores
-- conversation + per-turn metadata (tools used, data categories, provider,
-- confidence). Raw prompt/response text is NULL unless AI_LOG_RAW=true.
--
-- Conventions (Phase 3+): RLS on, clinic-scoped, soft-deleted hidden from
-- non-admins, hard DELETE blocked. super_admin has no clinic (get_clinic_id()
-- is NULL) so these policies exclude it automatically — consistent with the
-- medical lockout. Idempotent: safe to re-run.
--
-- NOTE: writes from /api/ai/chat are BEST-EFFORT — the route swallows insert
-- errors, so the Copilot works even before this migration is applied; applying
-- it simply turns on persistence.

-- ── A. ai_conversations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.user_profiles(id),
  page_context  TEXT,
  role_snapshot TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_clinic ON public.ai_conversations(clinic_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conv_user   ON public.ai_conversations(user_id) WHERE deleted_at IS NULL;

-- ── B. ai_messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  turn_role        TEXT NOT NULL CHECK (turn_role IN ('user','assistant')),
  content          TEXT,                                  -- NULL unless AI_LOG_RAW
  content_redacted BOOLEAN NOT NULL DEFAULT TRUE,
  tools_used       TEXT[] NOT NULL DEFAULT '{}',
  data_categories  TEXT[] NOT NULL DEFAULT '{}',          -- compliance: what was read
  provider         TEXT,
  confidence       TEXT,
  token_usage      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv   ON public.ai_messages(conversation_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_msg_clinic ON public.ai_messages(clinic_id, created_at DESC) WHERE deleted_at IS NULL;

-- ── C. RLS ────────────────────────────────────────────────────────
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages      ENABLE ROW LEVEL SECURITY;

-- Conversations: a user sees their own; admins see the clinic's. Writes only as
-- yourself within your clinic. No hard delete.
DROP POLICY IF EXISTS "ai_conv_select" ON public.ai_conversations;
CREATE POLICY "ai_conv_select" ON public.ai_conversations FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND (user_id = auth.uid() OR public.get_user_role() = 'admin')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "ai_conv_insert" ON public.ai_conversations;
CREATE POLICY "ai_conv_insert" ON public.ai_conversations FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND user_id = auth.uid());
DROP POLICY IF EXISTS "ai_conv_update" ON public.ai_conversations;
CREATE POLICY "ai_conv_update" ON public.ai_conversations FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND user_id = auth.uid())
  WITH CHECK (clinic_id = public.get_clinic_id() AND user_id = auth.uid());
DROP POLICY IF EXISTS "ai_conv_delete" ON public.ai_conversations;
CREATE POLICY "ai_conv_delete" ON public.ai_conversations FOR DELETE USING (false);

-- Messages: visible with their parent conversation; insert within own clinic.
DROP POLICY IF EXISTS "ai_msg_select" ON public.ai_messages;
CREATE POLICY "ai_msg_select" ON public.ai_messages FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
         AND (public.get_user_role() = 'admin'
              OR conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid())));
DROP POLICY IF EXISTS "ai_msg_insert" ON public.ai_messages;
CREATE POLICY "ai_msg_insert" ON public.ai_messages FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id()
              AND conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ai_msg_delete" ON public.ai_messages;
CREATE POLICY "ai_msg_delete" ON public.ai_messages FOR DELETE USING (false);

-- updated_at trigger for conversations (function defined in earlier migrations).
DROP TRIGGER IF EXISTS trg_ai_conv_updated_at ON public.ai_conversations;
CREATE TRIGGER trg_ai_conv_updated_at
  BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
