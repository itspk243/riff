// /auth/callback — handles the Supabase auth redirect (Google OAuth or
// magic link). We extract the access + refresh tokens from the URL hash,
// stash the session in localStorage, and then immediately redirect to
// /dashboard. The dashboard-bridge content script auto-hands the session
// off to the extension if it's installed.
//
// No "copy your token" UI any more — that flow used to live here as a
// pre-bridge fallback. The bridge made it unnecessary, and the extra
// interstitial was a UX wart for non-technical recruiters.

import { useEffect, useState } from 'react';
import Head from 'next/head';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresAt = params.get('expires_at');
    const errParam = params.get('error_description') || params.get('error');
    const type = params.get('type'); // 'recovery' for password-reset links

    if (errParam) {
      setError(decodeURIComponent(errParam));
      return;
    }

    // Password-reset emails route here too if our redirectTo wasn't set
    // correctly. Forward those to the dedicated reset page (preserve hash).
    if (type === 'recovery') {
      window.location.replace('/auth/reset-password' + window.location.hash);
      return;
    }

    if (!accessToken) {
      setError('Sign-in link is invalid or expired. Try sending a new one.');
      return;
    }

    // Persist the session for the dashboard + extension bridge.
    try {
      window.localStorage.setItem('riff_token', accessToken);
      if (refreshToken) {
        window.localStorage.setItem(
          'riff_session',
          JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresAt ? parseInt(expiresAt, 10) : null,
          })
        );
      }
    } catch {}

    // Strip the hash so credentials don't sit in browser history.
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch {}

    // Straight to the dashboard. The bridge handoff is automatic.
    window.location.replace('/dashboard');
  }, []);

  return (
    <>
      <Head><title>Signing you in — Riffly</title></Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}><span style={dotStyle} />Riffly</a>
          {error ? (
            <>
              <h1 style={h1Style}>Sign-in failed.</h1>
              <p style={pStyle}>{error}</p>
              <a href="/signup" style={primaryButtonStyle}>Try again</a>
            </>
          ) : (
            <p style={pStyle}>Signing you in…</p>
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
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 40,
  width: '100%', maxWidth: 420,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800,
  fontSize: 22, letterSpacing: '-0.03em', color: '#0a0a0a',
  textDecoration: 'none', marginBottom: 24,
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const h1Style: React.CSSProperties = { margin: '0 0 12px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' };
const pStyle: React.CSSProperties = { margin: '0 0 18px', fontSize: 14.5, color: '#555', lineHeight: 1.55 };
const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-block', width: '100%', padding: '11px', background: '#0a0a0a',
  color: '#fff', border: 'none', borderRadius: 8, fontSize: 14.5, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none',
  boxSizing: 'border-box',
};
