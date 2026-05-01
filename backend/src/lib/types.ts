// Shared types between backend and (eventually) the extension.

export interface ProfileSnapshot {
  profileUrl: string;
  name: string;
  headline: string;
  about: string;
  currentRole: string;
  currentCompany: string;
  capturedAt: string;
  // Which surface the content script parsed from. Used by /api/generate's
  // RIFF_DISABLED_SURFACES kill switch to selectively block Sales Nav /
  // Recruiter parsing without redeploying the extension. Optional because
  // older clients didn't send it; defaults to 'unknown' on the server side.
  surface?: 'linkedin_profile' | 'sales_navigator' | 'linkedin_recruiter' | 'github' | 'wellfound' | 'unknown';
  // ---- Day-2 enrichment (optional; popup falls back gracefully when missing)
  // Auto-extracted by content.js from the candidate's profile page.
  recentPosts?: string[]; // up to 3 most-recent post snippets
  skills?: string[];      // up to top 5 listed skills
  pastRoles?: string[];   // last 1-2 prior roles, formatted "Title at Company"
}

export type Tone = 'warm' | 'direct' | 'cheeky';
export type Length = 'short' | 'medium';
export type Purpose = 'hire' | 'refer' | 'network' | 'ask' | 'advisor';
export type Language = 'en' | 'de' | 'fr' | 'es' | 'pt' | 'it' | 'nl';

export interface GenerateRequest {
  profile: ProfileSnapshot;
  tone: Tone;
  length: Length;
  pitch: string;
  recentPost?: string | null;
  purpose?: Purpose;
  language?: Language; // defaults to 'en' when omitted
  // Server-injected (NOT from client) — derived from user_voice_fingerprints
  // when the Pro+ user has trained Riffly on their writing samples.
  voiceHint?: string | null;
}

export type VariantType = 'cold_opener' | 'follow_up' | 'breakup';

export interface MessageVariant {
  type: VariantType;
  text: string;
}

// Snapshot of where the user stands against their quota at the moment
// this generation either ran or was blocked. Mirrors lib/quota.QuotaInfo
// (kept as its own type here to avoid circular import + so the extension
// has a self-contained shape to read).
export interface UsageSnapshot {
  used: number;
  limit: number | null;
  remaining: number | null;
  plan: Plan;
  resetsAt: string | null;     // ISO; null on weekly window
  resetsLabel: string;         // "Jun 1" or "weekly" or "in 24 hours"
  windowKind: 'monthly' | 'weekly';
}

export interface GenerateResponse {
  ok: boolean;
  variants?: MessageVariant[];
  error?: string;
  /** @deprecated use `usage.remaining` — kept for older extension versions. */
  remainingThisWeek?: number;
  plan?: Plan;
  upgradeMessage?: string;
  /** Rich quota snapshot for dashboard + extension warning bars. */
  usage?: UsageSnapshot;
  /**
   * True if the user has already burned their one-time +3 roast-share bonus.
   * Returned on 402 quota-exceeded responses so the extension's inline upgrade
   * hint can decide whether to show "Share a roast for +3" or hide it.
   */
  roastShareUsed?: boolean;
  /**
   * True when the request was rejected because RIFF_DISABLED_SURFACES is set
   * in env and the profile.surface matched. Lets the extension popup show a
   * surface-specific nudge ("not available on this LinkedIn surface")
   * instead of a generic error.
   */
  surfaceDisabled?: boolean;
}

// Plans are ranked by capability:
//   free  → trial (3 drafts/week, +3 bonus on first roast share, cold opener only)
//   pro   → 200 drafts/month, all 3 variants, templates, follow-up loop ($15/mo)
//   plus  → 600 drafts/month, Pro + Active Profile Assist + Saved-Search Digest ($25/mo)
//   team  → legacy, kept for grandfathered subscribers ($99/mo, no longer offered to new customers)
export type Plan = 'free' | 'pro' | 'plus' | 'team';

export interface UserRow {
  id: string;
  email: string;
  plan: Plan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
  // One-time bonus drafts awarded e.g. for sharing a /roast result.
  // Added to the user's effective monthly limit until consumed.
  // See schema-bonus-drafts.sql migration.
  bonus_drafts?: number;
  // Set when the user first POSTs to /api/roast-share. NULL until then.
  // Used to gate the one-time +3 drafts award.
  roast_shared_at?: string | null;
}

export interface UsageRow {
  user_id: string;
  generated_at: string;
  variants: number;
}

// ---------- Active Profile Assist (Plus tier) ----------
//
// JobSpec is a stored description of what the user is hiring for. The LLM
// reads it as free-form text — we don't pre-parse it into structured fields,
// because the variation in real hiring needs ("staff backend with payments
// experience, NY-only" vs "founding designer who's done brand systems")
// would lock us out of cases the model handles fine on its own.
export interface JobSpec {
  id: string;
  user_id: string;
  name: string;        // short label, ≤80 chars (used in chip rows)
  description: string; // free-form criteria, ≤5000 chars
  archived: boolean;
  created_at: string;
  updated_at: string;
}

// Result of scoring one profile against one JobSpec.
export interface ScoreResult {
  score: number;       // 0-100 fit score
  reasoning: string;   // one-sentence summary of the fit
  matched: string[];   // 2-4 short bullets — what lines up
  missing: string[];   // 2-4 short bullets — what's absent / risky
}

export interface ScoreRequest {
  profile: ProfileSnapshot;
  // Score against this specific spec id, or against all of the user's
  // active specs and return the best match.
  jobSpecId?: string;
}

export interface ScoreResponse {
  ok: boolean;
  error?: string;
  // Top match across the user's active specs (or for the requested spec).
  best?: {
    jobSpecId: string;
    jobSpecName: string;
    result: ScoreResult;
  };
  // All scored specs, ordered by score desc. Useful for showing a list.
  all?: Array<{
    jobSpecId: string;
    jobSpecName: string;
    result: ScoreResult;
  }>;
  // Up to 5 active job specs per Plus user — surfaced so the popup can
  // show "you have 3/5 active specs" and prompt to add more.
  activeSpecsCount?: number;
  maxActiveSpecs?: number;
}
