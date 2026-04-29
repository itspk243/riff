// /signup — Sign in with Google (primary) + magic link (fallback).
// Both paths land on /auth/callback, which extracts the Supabase access token
// from the URL hash and stores it in localStorage for the dashboard + extension.

import { useState } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';

// Lazy browser-only Supabase client (anon key — safe to ship to the browser)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function SignupPage() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function continueWithGoogle() {
    setState('sending');
    setErrorMsg('');
    try {
      const supabase = getSupabase();
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}/auth/callback`
          : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          // Optional: scopes to grab user's profile picture / name explicitly
          scopes: 'email profile',
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setState('error');
      }
      // On success, the browser is redirected to Google — nothing else to do here.
    } catch (e: any) {
      setErrorMsg(e?.message || 'Google sign-in failed');
      setState('error');
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !/.+@.+\..+/.test(email)) {
      setErrorMsg('Enter a valid email');
      setState('error');
      return;
    }
    setState('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Could not send magic link. Try again.');
        setState('error');
        return;
      }
      setState('sent');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Network error');
      setState('error');
    }
  }

  return (
    <>
      <Head>
        <title>Sign in — Riffly</title>
        <meta name="description" content="Sign in to Riffly." />
      </Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}>
            <span style={dotStyle} />Riffly
          </a>

          {state === 'sent' ? (
            <>
              <h1 style={h1Style}>Check your email.</h1>
              <p style={pStyle}>
                We sent a sign-in link to <strong>{email}</strong>. Click it and you'll come back here. The link expires in an hour.
              </p>
              <p style={hintStyle}>
                Don't see it? Check spam, or{' '}
                <button onClick={() => setState('idle')} style={linkButtonStyle}>try again</button>.
              </p>
            </>
          ) : (
            <>
              <h1 style={h1Style}>Sign in to Riffly.</h1>
              <p style={pStyle}>One click — we use Google so you don't have to remember another password.</p>

              <button
                onClick={continueWithGoogle}
                disabled={state === 'sending'}
                style={googleButtonStyle}
              >
                <GoogleLogo />
                {state === 'sending' ? 'Redirecting…' : 'Continue with Google'}
              </button>

              {!showEmail ? (
                <p style={altStyle}>
                  <button onClick={() => setShowEmail(true)} style={linkButtonStyle}>
                    Use a magic link instead
                  </button>
                </p>
              ) : (
                <form onSubmit={sendMagicLink} style={{ marginTop: 18 }}>
                  <label style={labelStyle}>
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="you@company.com"
                      style={inputStyle}
                      disabled={state === 'sending'}
                    />
                  </label>
                  <button type="submit" disabled={state === 'sending'} style={secondaryButtonStyle}>
                    {state === 'sending' ? 'Sending…' : 'Send magic link'}
                  </button>
                </form>
              )}

              {state === 'error' && <div style={errorStyle}>{errorMsg}</div>}

              <p style={smallStyle}>
                By signing in you agree to the <a href="/terms" style={linkStyle}>Terms</a> and{' '}
                <a href="/privacy" style={linkStyle}>Privacy</a>.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

// Inline styles
const pageStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#fafafa',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 40,
  width: '100%', maxWidth: 420,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em',
  color: '#0a0a0a', textDecoration: 'none', marginBottom: 28,
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const h1Style: React.CSSProperties = { margin: '0 0 12px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' };
const pStyle: React.CSSProperties = { margin: '0 0 24px', fontSize: 15, color: '#555', lineHeight: 1.55 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#444', marginBottom: 16 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 15,
  border: '1px solid #d8d8dc', borderRadius: 8, marginTop: 6,
  fontFamily: 'inherit', background: '#fff',
};
const googleButtonStyle: React.CSSProperties = {
  width: '100%', padding: '12px', background: '#fff', color: '#3c4043',
  border: '1px solid #dadce0', borderRadius: 8, fontSize: 15, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
};
const secondaryButtonStyle: React.CSSProperties = {
  width: '100%', padding: '10px', marginTop: 8,
  background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const altStyle: React.CSSProperties = { margin: '14px 0 0', fontSize: 13, color: '#777', textAlign: 'center' };
const errorStyle: React.CSSProperties = {
  background: '#fef2f0', border: '1px solid #f4c4ba', color: '#b8331a',
  padding: '8px 12px', borderRadius: 6, fontSize: 13, marginTop: 12,
};
const hintStyle: React.CSSProperties = { fontSize: 13, color: '#777', marginTop: 16 };
const smallStyle: React.CSSProperties = { fontSize: 12, color: '#999', marginTop: 16, textAlign: 'center' };
const linkStyle: React.CSSProperties = { color: '#0a0a0a' };
const linkButtonStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, color: '#0a0a0a',
  textDecoration: 'underline', cursor: 'pointer', font: 'inherit',
};
