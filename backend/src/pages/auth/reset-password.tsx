// /auth/reset-password — landing page for the password-reset email link.
//
// Supabase sends users here with a recovery token in the URL hash. We let
// the Supabase client pick that up automatically (it parses the hash on
// init), then show a "set a new password" form. On success we redirect
// straight to /dashboard — the dashboard-bridge will hand the new session
// off to the extension if it's installed.

import { useEffect, useState } from 'react';
import Head from 'next/head';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { detectSessionInUrl: true, flowType: 'implicit' } }
  );
}

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supabase = getSupabase();
    // detectSessionInUrl on init parses the URL fragment automatically.
    // We just need to check whether there's a session a moment later.
    (async () => {
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setReady(true);
      // Strip the hash so the recovery token isn't sitting in browser history.
      try {
        if (window.location.hash) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch {}
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      setState('error');
      return;
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.');
      setState('error');
      return;
    }
    setState('busy');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMsg(error.message);
        setState('error');
        return;
      }
      // Password updated — Supabase keeps the session active, so we can
      // send the user straight to the dashboard.
      window.location.replace('/dashboard');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not update your password.');
      setState('error');
    }
  }

  return (
    <>
      <Head><title>Set a new password — Riffly</title></Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}><span style={dotStyle} />Riffly</a>

          {!ready && <p style={pStyle}>Loading…</p>}

          {ready && !hasSession && (
            <>
              <h1 style={h1Style}>Reset link expired or invalid.</h1>
              <p style={pStyle}>
                Reset links are good for one hour and can only be used once. Try sending a fresh one.
              </p>
              <a href="/signup" style={primaryButtonStyle}>Send a new reset link</a>
            </>
          )}

          {ready && hasSession && (
            <>
              <h1 style={h1Style}>Set a new password.</h1>
              <p style={pStyle}>You're signed in via the reset link. Pick a new password and you're done.</p>
              <form onSubmit={handleSubmit}>
                <label style={labelStyle}>
                  New password (8+ characters)
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    placeholder="••••••••"
                    style={inputStyle}
                    disabled={state === 'busy'}
                  />
                </label>
                <label style={labelStyle}>
                  Confirm new password
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    style={inputStyle}
                    disabled={state === 'busy'}
                  />
                </label>
                <button type="submit" disabled={state === 'busy'} style={primaryButtonStyle}>
                  {state === 'busy' ? 'Saving…' : 'Save and sign in'}
                </button>
              </form>
              {state === 'error' && <div style={errorStyle}>{errorMsg}</div>}
            </>
          )}
        </div>
      </main>
    </>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#fafafa',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 36,
  width: '100%', maxWidth: 420,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800,
  fontSize: 22, letterSpacing: '-0.03em', color: '#0a0a0a',
  textDecoration: 'none', marginBottom: 24,
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const h1Style: React.CSSProperties = { margin: '0 0 14px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' };
const pStyle: React.CSSProperties = { margin: '0 0 18px', fontSize: 14.5, color: '#555', lineHeight: 1.55 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#444', marginBottom: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15,
  border: '1px solid #d8d8dc', borderRadius: 8, marginTop: 6,
  fontFamily: 'inherit', background: '#fff',
};
const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-block', width: '100%', padding: '11px',
  background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box',
};
const errorStyle: React.CSSProperties = {
  background: '#fef2f0', border: '1px solid #f4c4ba', color: '#b8331a',
  padding: '8px 12px', borderRadius: 6, fontSize: 13, marginTop: 12,
};
