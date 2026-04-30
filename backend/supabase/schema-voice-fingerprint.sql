-- Riffly: Voice fingerprint groundwork (Pro+ feature, "drafts in your dialect")
--
-- Stores derived statistics about a user's writing style — average sentence
-- length, formality score, common openers, signature phrases — so the
-- generation prompt can match their voice. We deliberately do NOT store
-- the raw input messages; only the derived fingerprint.
--
-- Workflow:
--   1. Onboarding step asks user to paste 5-10 of their best LinkedIn
--      messages (or sent emails). Frontend computes the fingerprint
--      client-side using a small heuristics function (see
--      lib/voice-fingerprint.ts).
--   2. Frontend POSTs the fingerprint (not the messages) to
--      /api/voice-fingerprint.
--   3. /api/generate reads the user's fingerprint at generation time and
--      passes it to the prompt as a style guide.
--
-- Why store derived stats only:
--   - Privacy: messages may contain candidate names, comp data, etc.
--     Storing the fingerprint instead means a breach yields no PII.
--   - Cost: the fingerprint is ~200 bytes, the messages would be ~5KB+
--   - Trust: aligns with the brand stance ("we don't keep candidate data")
--
-- Run via Supabase SQL editor. Idempotent.

create table if not exists public.user_voice_fingerprints (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- Numeric stats
  avg_sentence_words numeric(5, 2),         -- e.g. 14.30
  avg_sentence_count numeric(5, 2),         -- per message
  formality_score numeric(3, 2),            -- 0.0 (casual) to 1.0 (formal)
  contraction_rate numeric(3, 2),           -- 0.0 to 1.0 (uses "we're" vs "we are")
  emoji_rate numeric(4, 3),                 -- emojis per 100 words
  question_rate numeric(3, 2),              -- ratio of sentences that are questions
  -- Qualitative samples (top patterns the user uses)
  common_openers text[],                    -- ["Hey {name},", "Quick one — ", ...]
  common_signoffs text[],                   -- ["Cheers,", "— Sruly", ...]
  signature_phrases text[],                 -- distinctive phrases the user reaches for
  -- Metadata
  sample_count int not null default 0,      -- how many messages contributed
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_voice_fingerprints enable row level security;

-- Users can read their own fingerprint (so the dashboard can render the
-- "your voice fingerprint" card). Service-role writes only — fingerprint
-- gets recomputed via the API endpoint, not by the user directly.
drop policy if exists "voice_fingerprints self read" on public.user_voice_fingerprints;
create policy "voice_fingerprints self read"
  on public.user_voice_fingerprints
  for select
  using (auth.uid() = user_id);

-- Verify
-- select column_name, data_type from information_schema.columns
-- where table_name = 'user_voice_fingerprints' order by ordinal_position;
