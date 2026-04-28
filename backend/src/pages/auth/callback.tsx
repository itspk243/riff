// /auth/callback — handles the magic-link redirect from Supabase.
// Supabase puts the access_token in the URL hash (#access_token=...).
// We extract it, store in localStorage, and show the user a copy-to-extension UI.

import { useEffect, useState } from 'react';
import Head from 'next/head';

export default function AuthCallback() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const errParam = params.get('error_description') || params.get('error');

    if (errParam) {
      setError(decodeURIComponent(errParam));
      return;
    }
    if (!accessToken) {
      setError('Magic link is invalid or expired. Try sending a new one.');
      return;
    }

    setToken(accessToken);
    try { window.localStorage.setItem('riff_token', accessToken); } catch {}

    // Strip the hash from the URL so the token isn't sitting in browser history.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      // some browsers block clipboard from non-user-gesture; fall back to select-all
    }
  }

  return (
    <>
      <Head>
        <title>You're signed in — Riff</title>
      </Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <a href="/" style={brandStyle}>
            <span style={dotStyle} />Riff
          </a>

          {error ? (
            <>
              <h1 style={h1Style}>Sign-in failed.</h1>
              <p style={pStyle}>{error}</p>
              <a href="/signup" style={primaryButtonStyle}>Try again</a>
            </>
          ) : token ? (
            <>
              <h1 style={h1Style}>You're signed in.</h1>
              <p style={pStyle}>
                One last step: paste your token into the Riff extension so it can talk to your account.
              </p>

              <ol style={olStyle}>
                <li>Click the Riff icon in your Chrome toolbar.</li>
                <li>Click <strong>Sign in</strong> at the top of the popup.</li>
                <li>Paste the token below.</li>
              </ol>

              <label style={labelStyle}>Your token</label>
              <textarea
                readOnly
                value={token}
                style={tokenStyle}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button onClick={copyToken} style={primaryButtonStyle}>
                {copied ? 'Copied ✓' : 'Copy token'}
              </button>

              <p style={smallStyle}>
                The token is also saved in your browser localStorage on this site if you need to grab it again. Don't share it — anyone with this token can use Riff as you.
              </p>

              <p style={smallStyle}>
                <a href="/dashboard" style={linkStyle}>Go to dashboard →</a>
              </p>
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
  background: '#fafafa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 40,
  width: '100%', maxWidth: 480,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 22,
  letterSpacing: '-0.03em', color: '#0a0a0a', textDecoration: 'none', marginBottom: 28,
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const h1Style: React.CSSProperties = { margin: '0 0 12px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' };
const pStyle: React.CSSProperties = { margin: '0 0 18px', fontSize: 15, color: '#555', lineHeight: 1.55 };
const olStyle: React.CSSProperties = { padding: '0 0 0 18px', fontSize: 14, color: '#444', lineHeight: 1.7, marginBottom: 18 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#444', marginBottom: 6 };
const tokenStyle: React.CSSProperties = {
  width: '100%', minHeight: 80, padding: 10, fontSize: 11.5, fontFamily: 'ui-monospace, Menlo, monospace',
  border: '1px solid #d8d8dc', borderRadius: 8, marginBottom: 12, background: '#fafafa', color: '#444',
  resize: 'vertical', wordBreak: 'break-all',
};
const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-block', width: '100%', padding: '12px', background: '#0a0a0a', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box',
};
const smallStyle: React.CSSProperties = { fontSize: 12, color: '#777', marginTop: 14, lineHeight: 1.5 };
const linkStyle: React.CSSProperties = { color: '#0a0a0a' };
