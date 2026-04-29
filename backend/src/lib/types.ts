// Shared types between backend and (eventually) the extension.

export interface ProfileSnapshot {
  profileUrl: string;
  name: string;
  headline: string;
  about: string;
  currentRole: string;
  currentCompany: string;
  capturedAt: string;
}

export type Tone = 'warm' | 'direct' | 'cheeky';
export type Length = 'short' | 'medium';
export type Purpose = 'hire' | 'refer' | 'network' | 'ask' | 'advisor';

export interface GenerateRequest {
  profile: ProfileSnapshot;
  tone: Tone;
  length: Length;
  pitch: string;
  recentPost?: string | null;
  purpose?: Purpose;
}

export type VariantType = 'cold_opener' | 'follow_up' | 'breakup';

export interface MessageVariant {
  type: VariantType;
  text: string;
}

export interface GenerateResponse {
  ok: boolean;
  variants?: MessageVariant[];
  error?: string;
  remainingThisWeek?: number; // for free-tier users
  plan?: 'free' | 'pro' | 'team';
  upgradeMessage?: string; // shown when free users hit the variant ceiling
}

export type Plan = 'free' | 'pro' | 'team';

export interface UserRow {
  id: string;
  email: string;
  plan: Plan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
}

export interface UsageRow {
  user_id: string;
  generated_at: string;
  variants: number;
}
