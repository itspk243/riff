// Supabase clients. Two flavors:
//   - browserClient(): anon key, used for magic-link auth from the landing page
//   - serviceClient(): service role, used by API routes that need to bypass RLS

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let _service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!_service) {
    _service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _service;
}

export function browserClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Verify a Supabase JWT (sent by the extension as `Authorization: Bearer <token>`)
 * and return the user row from the public.users table. Returns null if invalid.
 */
export async function getUserFromBearer(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const supabase = serviceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: row, error: rowErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();
  if (rowErr) return null;

  // Auto-provision row on first call (cheap and avoids a separate signup endpoint).
  if (!row) {
    const { data: created } = await supabase
      .from('users')
      .insert({ id: data.user.id, email: data.user.email!, plan: 'free' })
      .select()
      .single();
    return created;
  }
  return row;
}
