// Single source of truth for "can a user with plan X use feature Y".
// Every API route and UI surface should call these helpers — never check
// `user.plan === 'pro'` directly. That way adding a new tier (Plus, Team,
// Enterprise) is one file change, not a global grep.

import type { Plan } from './types';

export function isPaidPlan(plan: Plan | null | undefined): boolean {
  return plan === 'pro' || plan === 'plus' || plan === 'team';
}

/** Unlimited generations per week (no soft quota). */
export function hasUnlimitedDrafts(plan: Plan | null | undefined): boolean {
  return isPaidPlan(plan);
}

/** All 3 variants per generation (cold opener + follow-up + breakup). */
export function hasAllVariants(plan: Plan | null | undefined): boolean {
  return isPaidPlan(plan);
}

/** Saved pitch templates synced server-side. */
export function hasSavedTemplates(plan: Plan | null | undefined): boolean {
  return isPaidPlan(plan);
}

/** Server-side reply analytics + cross-machine sync of sent/replied marks. */
export function hasReplyAnalytics(plan: Plan | null | undefined): boolean {
  return isPaidPlan(plan);
}

/** Follow-up loop reminders + auto-detection of prior threads. */
export function hasFollowUpLoop(plan: Plan | null | undefined): boolean {
  return isPaidPlan(plan);
}

// -------- Plus-only features (the agentic stuff that costs us API $) --------

/** Active Profile Assist — live fit-scoring against saved job specs as the
 *  user browses LinkedIn. Each scored profile costs ~$0.005 in Claude calls,
 *  so this is gated to Plus tier ($25/mo) where margin covers it. */
export function hasActiveProfileAssist(plan: Plan | null | undefined): boolean {
  return plan === 'plus' || plan === 'team';
}

/** Saved-Search Daily Digest — auto-rank profiles in saved LinkedIn searches.
 *  Same cost concern as Active Profile Assist; same gate. */
export function hasSavedSearchDigest(plan: Plan | null | undefined): boolean {
  return plan === 'plus' || plan === 'team';
}

/** Maximum number of active job specs a user can save. */
export function maxJobSpecs(plan: Plan | null | undefined): number {
  if (plan === 'plus' || plan === 'team') return 5;
  return 0; // Free and Pro cannot save job specs at all.
}

/** Maximum number of saved LinkedIn search "watches". */
export function maxWatches(plan: Plan | null | undefined): number {
  if (plan === 'plus' || plan === 'team') return 10;
  return 0;
}
