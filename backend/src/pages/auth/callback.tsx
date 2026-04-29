// /auth/callback — handles the magic-link redirect from Supabase.
// Supabase puts the access_token in the URL hash (#access_token=...).
// We extract it, store in localStorage, and show the user a copy-to-extension UI.

import { useEffect, useState } from 'react';
import Head from 'next/head';

// Chrome Web Store listing URL — set NEXT_PUBLIC_CHROME_STORE_URL in Vercel
// once the listing is approved. Until then we show an "in review" notice
// instead of a download link (we never serve the .zip publicly).
const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_STORE_URL || '';

export default function AuthCallback() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Bundle the full session (access + refresh + expiry) into a single
  // pasteable token. Format: `riff_v1.<base64-json>`. The extension parses
  // both tokens and silently refreshes the access token before it expires —
  // so users never have to re-paste again.
  const [bundle, setBundle] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresAt = params.get('expires_at');
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

    // Persist full session for the dashboard to read. Older code that only
    // needs the JWT (e.g. fetch('/api/me')) keeps reading riff_token.
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

    // Build the extension bundle if we have a refresh_token. Without one,
    // fall back to the legacy JWT-only flow (works for ~1hr).
    if (refreshToken) {
      const payload = { a: accessToken, r: refreshToken };
      try {
        const b64 = window.btoa(JSON.stringify(payload));
        setBundle(`riff_v1.${b64}`);
      } catch {
        setBundle(null);
      }
    } else {
      setBundle(null);
    }

    // Strip the hash from the URL so credentials aren't sitting in history.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function copyToken() {
    // Prefer the bundle (auto-refresh capable) over the raw JWT.
    const toCopy = bundle || token;
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
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
                {CHROME_STORE_URL
                  ? 'Two steps: install the extension from the Chrome Web Store, then paste your token in.'
                  : "We're in Chrome Web Store review. Once it's live, you'll install in two clicks. In the meantime, copy your token below."}
              </p>

              {CHROME_STORE_URL ? (
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...primaryButtonStyle, marginBottom: 12 }}
                >
                  Add Riff to Chrome →
                </a>
              ) : (
                <div
                  style={{
                    background: '#fff8eb',
                    border: '1px solid #f3d99a',
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginBottom: 14,
                    fontSize: 13,
                    color: '#6b4a14',
                  }}
                >
                  <strong>Riff is in Chrome Web Store review.</strong> We'll email you when the listing goes live (usually 1–7 days).
                </div>
              )}

              {CHROME_STORE_URL && (
                <ol style={olStyle}>
                  <li><strong>Click <em>Add to Chrome</em></strong> on the store listing, then confirm.</li>
                  <li><strong>Pin Riff to your toolbar</strong> — click the puzzle-piece icon (top-right of Chrome) and pin Riff.</li>
                  <li><strong>Paste your token</strong> in the popup's "Sign in to Riff" field, then click Save.</li>
                </ol>
              )}
              <p style={{ ...smallStyle, marginBottom: 16 }}>
                <a href="/dashboard#install-steps" style={linkStyle}>Full instructions on your dashboard.</a>
              </p>

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
