// /dashboard — the user's account hub.
// Profile header, usage stats, subscription details, extension setup.

import { useEffect, useState } from 'react';
import Head from 'next/head';
import SavedSearchesPanel from '../components/SavedSearchesPanel';
import UsagePanel from '../components/UsagePanel';
import OnboardingChecklist from '../components/OnboardingChecklist';
import JobSpecsPanel from '../components/JobSpecsPanel';
import VoiceFingerprintPanel from '../components/VoiceFingerprintPanel';

interface MeResponse {
  ok: boolean;
  email?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  plan?: 'free' | 'pro' | 'plus' | 'team';
  remainingThisWeek?: number;
  hasSubscription?: boolean;
  // True when the user clicked "Cancel" in the Stripe portal — they keep
  // their plan until current_period_end, then drop to free.
  cancel_at_period_end?: boolean;
  subscription_status?: string | null;
  member_since?: string;
  current_period_end?: string | null;
  usage?: {
    this_week: number;
    this_month: number;
    all_time: number;
  };
}

const FREE_WEEKLY_LIMIT = 3;

// Chrome Web Store listing URL — the only way users get the extension once
// we go public. Set NEXT_PUBLIC_CHROME_STORE_URL in Vercel once the listing
// is approved (e.g. "https://chrome.google.com/webstore/detail/riff/<id>").
// While unset, we render a "Coming soon" state instead of a live install button.
//
// We deliberately do NOT serve the .zip from /public — that would let anyone
// fork the source. The build script writes to dist/ at the repo root for
// uploading to the Chrome Web Store dev console manually.
const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_STORE_URL || '';

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function planLabel(plan?: string): string {
  if (plan === 'plus') return 'Plus';
  if (plan === 'pro') return 'Pro';
  if (plan === 'team') return 'Team';
  return 'Free';
}

function planPrice(plan?: string): string {
  if (plan === 'plus') return '$25 / month';
  if (plan === 'pro') return '$15 / month';
  if (plan === 'team') return '$99 / month · legacy';
  return 'Free · 3 drafts/week';
}

export default function Dashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenCopied, setTokenCopied] = useState(false);
  // bundleHint reflects the riff_v1 bundle if present — that's what Copy
  // actually puts in the clipboard, so the preview should mirror it.
  const [bundleHint, setBundleHint] = useState<string | null>(null);
  // Extension presence + connect-flow status. extensionDetected flips to
  // true when the content-script bridge announces itself via postMessage.
  // connectStatus tracks the click-to-hand-off result.
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [connectStatus, setConnectStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showCanceledMsg, setShowCanceledMsg] = useState(false);
  const [showUpgradedMsg, setShowUpgradedMsg] = useState(false);
  // True when the user landed here via the extension's sign-in flow
  // (?from=ext). Triggers a banner pointing them back to LinkedIn so
  // they don't sit on /dashboard wondering what to do next.
  const [fromExt, setFromExt] = useState(false);
  // True for users who signed in BEFORE the riff_session bundle was a thing.
  // We can't auto-refresh their token (no refresh_token in localStorage), so
  // we nudge them to sign out + sign back in once. After that, never again.
  const [needsReauthForRefresh, setNeedsReauthForRefresh] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  function showError(msg: string) {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 5000);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') === 'ext') setFromExt(true);
    if (params.get('canceled') === '1') setShowCanceledMsg(true);
    if (params.get('upgraded') === '1') {
      setShowUpgradedMsg(true);
      // Stripe webhooks usually land within ~1s but can lag. Retry-fetch the
      // /me endpoint a couple of times so the UI flips to the new plan
      // without the user needing to manually refresh.
      [1500, 4000].forEach((delay) => {
        setTimeout(() => {
          refreshAndFetchMe();
        }, delay);
      });
    }

    // Landing page sends signed-in users here with ?upgrade=pro|plus|test
    // to express intent. Auto-trigger checkout — but ONLY if they're not
    // already on that plan. Otherwise they'd bounce to Stripe portal which
    // is jarring when they just clicked a tier they already own.
    const upgradeIntent = params.get('upgrade');
    if (upgradeIntent === 'pro' || upgradeIntent === 'plus' || upgradeIntent === 'test') {
      // Strip the param so refreshing the dashboard doesn't re-trigger.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('upgrade');
        window.history.replaceState({}, '', url.toString());
      } catch {}
      // Wait for /api/me to populate, then check plan. Up to 5 attempts
      // (covers slow networks); skip if already on plan.
      const tryAutoCheckout = (attempts: number) => {
        if (attempts <= 0) return;
        setTimeout(() => {
          // setMe runs in refreshAndFetchMe; read latest via the closure's
          // useEffect doesn't capture it, so we re-read the storage indirectly
          // by reading window state via a fresh fetch call. Simplest: just
          // call startCheckout, which the API already handles correctly
          // (returns alreadyOnPlan: true → portal URL). But to avoid the
          // unwanted portal redirect for same-plan, we read me from a ref-
          // free pattern: use functional setState to peek.
          setMe((current) => {
            if (current?.plan === upgradeIntent) {
              showError(`You're already on ${upgradeIntent.charAt(0).toUpperCase() + upgradeIntent.slice(1)}.`);
              return current;
            }
            // Plan differs (or me hasn't loaded yet). If me is loaded and
            // it's a real plan change, fire checkout. If me is null, retry.
            if (current) {
              startCheckout(upgradeIntent as 'pro' | 'plus' | 'test');
            } else {
              tryAutoCheckout(attempts - 1);
            }
            return current;
          });
        }, 600);
      };
      tryAutoCheckout(5);
    }
    if (params.get('devmode') === '1') setDevMode(true);

    const t = window.localStorage.getItem('riff_token');
    setToken(t);
    if (!t) {
      // Redirect to /signup. .replace() means the back button doesn't
      // bounce them right back to this dead-loading state.
      window.location.replace('/signup');
      return;
    }

    // If we have the full session, compute the bundle preview synchronously
    // so the displayed "tokenPreview" reflects what Copy actually copies.
    let hasFullSession = false;
    try {
      const sessRaw = window.localStorage.getItem('riff_session');
      if (sessRaw) {
        const sess = JSON.parse(sessRaw);
        if (sess.access_token && sess.refresh_token) {
          const b64 = window.btoa(
            JSON.stringify({ a: sess.access_token, r: sess.refresh_token })
          );
          setBundleHint(`riff_v1.${b64}`);
          hasFullSession = true;
        }
      }
    } catch {}

    // Pre-bundle migration: if the user signed in BEFORE we started storing
    // refresh_tokens, they have only riff_token. Their session can't auto-
    // renew. Nudge them to sign in again — one time only.
    if (!hasFullSession) {
      setNeedsReauthForRefresh(true);
    }
    // Use the auto-refreshing fetch helper so an expired access_token gets
    // swapped for a fresh one before we hit /api/me. Fixes "I refreshed the
    // dashboard after sitting idle and now nothing loads".
    refreshAndFetchMe();

    // Listen for the extension's content script announcing itself. If we hear
    // it, the user can click "Connect extension" instead of paste.
    function onMessage(ev: MessageEvent) {
      if (ev.source !== window) return;
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'riff:extension-ready') {
        setExtensionDetected(true);
      } else if (data.type === 'riff:set-token-result') {
        if (data.ok) {
          setConnectStatus('connected');
          setConnectError(null);
        } else {
          setConnectStatus('error');
          setConnectError(data.error || 'Could not save token in extension.');
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // One-click hand-off: post the access + refresh tokens directly into the
  // extension via window.postMessage. The extension's content-script bridge
  // forwards them to background, which writes them to chrome.storage.local.
  // No copy/paste, no expiry pain.
  async function connectExtension() {
    setConnectStatus('connecting');
    setConnectError(null);
    try {
      // Re-mint a fresh access token if ours is near expiry, so we hand off
      // the longest-lived session possible.
      let access: string | null = null;
      let refresh: string | null = null;
      try {
        const sessRaw = window.localStorage.getItem('riff_session');
        if (sessRaw) {
          const sess = JSON.parse(sessRaw);
          access = sess.access_token || null;
          refresh = sess.refresh_token || null;
          if (access && refresh) {
            const payload = JSON.parse(
              atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
            );
            const expSoon = (payload.exp || 0) * 1000 - Date.now() < 5 * 60 * 1000;
            if (expSoon) {
              const r = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refresh }),
              });
              const j = await r.json();
              if (j.ok && j.access_token) {
                access = j.access_token;
                refresh = j.refresh_token || refresh;
                window.localStorage.setItem('riff_token', access || '');
                window.localStorage.setItem(
                  'riff_session',
                  JSON.stringify({
                    access_token: access,
                    refresh_token: refresh,
                    expires_at: j.expires_at || null,
                  })
                );
              }
            }
          }
        }
      } catch {}

      // Fall back to the bare JWT if we couldn't load the full session
      // (legacy users whose riff_session was never set).
      if (!access) access = token;

      if (!access) {
        setConnectStatus('error');
        setConnectError('No session found. Sign out and sign in again.');
        return;
      }

      window.postMessage(
        { type: 'riff:set-token', access_token: access, refresh_token: refresh },
        window.location.origin
      );

      // Safety timeout: if the extension never responds, surface a hint.
      setTimeout(() => {
        setConnectStatus((s) => {
          if (s === 'connecting') {
            setConnectError("Extension didn't respond. Reload this page or use Copy token instead.");
            return 'error';
          }
          return s;
        });
      }, 3000);
    } catch (e: any) {
      setConnectStatus('error');
      setConnectError(e?.message || 'Failed to connect extension.');
    }
  }

  async function startCheckout(plan: 'pro' | 'plus' | 'team' | 'test') {
    // Always refresh before billing endpoints. Stale JWT was the silent
    // killer — users would click "Start Pro" with an expired token, see
    // "Sign in first" and have no idea why.
    const fresh = await getFreshToken();
    if (!fresh) return;
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}` },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (data.ok && data.url) window.location.href = data.url;
    else showError(data.error || 'Could not start checkout. Try again in a moment.');
  }

  async function openBillingPortal() {
    const fresh = await getFreshToken();
    if (!fresh) return;
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fresh}` },
    });
    const data = await res.json();
    if (data.ok && data.url) window.location.href = data.url;
    else showError(data.error || 'Could not open billing portal. Try again in a moment.');
  }

  // Returns a fresh, non-expired access token. If the cached one has <5min
  // left, calls /api/auth/refresh to mint a new one and updates localStorage
  // + React state so subsequent calls (startCheckout, openBillingPortal,
  // connectExtension) all use the new token.
  async function getFreshToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    const cachedAccess = window.localStorage.getItem('riff_token');
    if (!cachedAccess) return null;

    let needsRefresh = false;
    try {
      const payload = JSON.parse(
        atob(cachedAccess.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      const expMs = (payload.exp || 0) * 1000;
      needsRefresh = expMs - Date.now() < 5 * 60 * 1000;
    } catch {
      // Couldn't parse — assume valid; backend will reject if not.
    }

    if (!needsRefresh) return cachedAccess;

    // Need to refresh. Read the refresh_token from the session bundle.
    let refreshToken: string | null = null;
    try {
      const sessRaw = window.localStorage.getItem('riff_session');
      if (sessRaw) {
        const sess = JSON.parse(sessRaw);
        refreshToken = sess?.refresh_token || null;
      }
    } catch {}

    if (!refreshToken) {
      // Pre-bundle user. Their access token is about to expire and we have
      // no way to renew it. Surface the migration nudge in renderMigrationNudge.
      return cachedAccess;
    }

    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const j = await r.json();
      if (j.ok && j.access_token) {
        window.localStorage.setItem('riff_token', j.access_token);
        window.localStorage.setItem(
          'riff_session',
          JSON.stringify({
            access_token: j.access_token,
            refresh_token: j.refresh_token || refreshToken,
            expires_at: j.expires_at || null,
          })
        );
        // Keep React state in sync so future setState reads pick up the new
        // token instead of holding the stale one in closure.
        setToken(j.access_token);
        return j.access_token;
      }
    } catch (e) {
      // Network / refresh error — fall through with cached token.
    }
    return cachedAccess;
  }

  // /api/me with auto-refresh. Used on initial load and after upgrade webhook
  // round-trip (?upgraded=1) so the user immediately sees their new plan.
  async function refreshAndFetchMe() {
    const fresh = await getFreshToken();
    if (!fresh) {
      window.location.href = '/signup';
      return;
    }
    try {
      const r = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${fresh}` },
      });
      if (r.status === 401) {
        // Refresh failed and access expired. Send to signup to start fresh.
        window.localStorage.removeItem('riff_token');
        window.localStorage.removeItem('riff_session');
        window.location.href = '/signup';
        return;
      }
      const data = (await r.json()) as MeResponse;
      setMe(data);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function signOut() {
    try {
      window.localStorage.removeItem('riff_token');
      window.localStorage.removeItem('riff_session');
    } catch {}
    window.location.href = '/';
  }

  // Build the extension token. Prefer the riff_v1 bundle (access + refresh,
  // auto-refreshing) over the bare JWT (legacy, expires in 1hr). The bundle
  // is what we want every user pasting — it's the difference between a stable
  // sign-in and "why does it keep logging me out?".
  async function getExtensionToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem('riff_session');
      if (raw) {
        const sess = JSON.parse(raw) as {
          access_token?: string;
          refresh_token?: string;
        };
        if (sess.access_token && sess.refresh_token) {
          // If the cached access token is near expiry, refresh it server-side
          // first so the user pastes a fresh one (gives them a clean 1hr +
          // long-lived refresh on top).
          let access = sess.access_token;
          let refresh = sess.refresh_token;
          try {
            // Check exp claim. JWTs are base64url-encoded; pad and decode.
            const payload = JSON.parse(
              atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
            );
            const expSoon = (payload.exp || 0) * 1000 - Date.now() < 5 * 60 * 1000;
            if (expSoon) {
              const r = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refresh }),
              });
              const j = await r.json();
              if (j.ok && j.access_token) {
                access = j.access_token;
                refresh = j.refresh_token || refresh;
                // Cache the rotated session so subsequent /api/me calls work
                window.localStorage.setItem('riff_token', access);
                window.localStorage.setItem(
                  'riff_session',
                  JSON.stringify({
                    access_token: access,
                    refresh_token: refresh,
                    expires_at: j.expires_at || null,
                  })
                );
              }
            }
          } catch {
            // Best-effort. If decode/refresh fails, fall through with what we have.
          }
          const payload = { a: access, r: refresh };
          return `riff_v1.${btoa(JSON.stringify(payload))}`;
        }
      }
    } catch {}
    // Legacy fallback: bare JWT (will expire in <=1hr).
    return token;
  }

  async function copyToken() {
    const toCopy = await getExtensionToken();
    if (!toCopy) return;
    await navigator.clipboard.writeText(toCopy);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  if (loading) {
    // Two distinct loading states the user might be in:
    //   1. They're authed and we're waiting on /api/me — brief flash, fine.
    //   2. They're NOT authed and the useEffect is about to redirect to
    //      /signup — but if redirect is slow (cold page cache, blocked
    //      script, prerender), they'd otherwise stare at "Loading…" forever
    //      (the bug the brutal review caught).
    //
    // We show different copy + a manual fallback link for the no-token
    // case so the page never reads as "broken" even if the JS redirect
    // misses for any reason.
    const hasToken = typeof window !== 'undefined' && !!window.localStorage.getItem('riff_token');
    return (
      <main style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', maxWidth: 480, margin: '64px auto', padding: 32 }}>
          {hasToken ? (
            <>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>Loading your dashboard…</div>
              <div style={{ fontSize: 12, color: '#999' }}>If this takes longer than a few seconds, refresh the page.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: '#666', marginBottom: 8 }}>
                Riffly
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: '#111' }}>
                You need to sign in first.
              </div>
              <p style={{ fontSize: 14, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
                Riffly's dashboard is for signed-in users only. Sign in or create a free account in one click.
              </p>
              <a
                href="/signup"
                style={{
                  display: 'inline-block',
                  padding: '10px 18px',
                  background: '#111',
                  color: '#fff',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Sign in / Sign up →
              </a>
              <noscript>
                <div style={{ fontSize: 12, color: '#888', marginTop: 16 }}>
                  JavaScript is required to use the Riffly dashboard.
                </div>
              </noscript>
            </>
          )}
        </div>
      </main>
    );
  }

  // BUG FIX: 'plus' was missing here. Plus subscribers were seeing the
  // upgrade tier grid (free/pro/plus) instead of "Manage billing & cancel".
  // They couldn't reach the Stripe portal to update their card or cancel.
  const isPaid = me?.plan === 'pro' || me?.plan === 'plus' || me?.plan === 'team';
  const initials = (me?.full_name || me?.email || '?').split(/\s+|@/).filter(Boolean).map(s => s[0]?.toUpperCase()).slice(0, 2).join('');
  // Show bundle prefix in the preview (riff_v1.…) when available, else fall
  // back to raw JWT preview. The Copy button always copies the same thing.
  const previewSource = bundleHint || token;
  const tokenPreview = previewSource
    ? `${previewSource.slice(0, 12)}…${previewSource.slice(-6)}`
    : '';

  return (
    <>
      <Head>
        <title>Dashboard — Riffly</title>
        <style>{`
          @keyframes riff-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes riff-slide-down { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes riff-pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
          @keyframes riff-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(177, 74, 26, 0.35); } 70% { box-shadow: 0 0 0 10px rgba(177, 74, 26, 0); } 100% { box-shadow: 0 0 0 0 rgba(177, 74, 26, 0); } }
          .riff-card { animation: riff-fade-in 380ms cubic-bezier(.22,.61,.36,1); }
          .riff-stat { animation: riff-fade-in 320ms cubic-bezier(.22,.61,.36,1) backwards; }
          .riff-stat:nth-child(1) { animation-delay: 60ms; }
          .riff-stat:nth-child(2) { animation-delay: 140ms; }
          .riff-stat:nth-child(3) { animation-delay: 220ms; }
          .riff-banner { animation: riff-slide-down 320ms cubic-bezier(.22,.61,.36,1); }
          .riff-pop { animation: riff-pop 300ms cubic-bezier(.22,1.4,.36,1); }
          .riff-popular { animation: riff-pulse-ring 2.4s ease-out 600ms; }
          .riff-btn { transition: transform 80ms ease, background 140ms ease, box-shadow 200ms ease; }
          .riff-btn:hover { box-shadow: 0 4px 12px rgba(17,17,16,0.15); }
          .riff-btn:active { transform: scale(0.985); }
          .riff-ghost-btn { transition: background 140ms ease, border-color 140ms ease, transform 80ms ease; }
          .riff-ghost-btn:hover { background: #f3f0e8; border-color: #b14a1a; }
          .riff-ghost-btn:active { transform: scale(0.985); }
          .riff-link-card { transition: border-color 160ms ease, box-shadow 200ms ease; }
          .riff-link-card:hover { border-color: #d6d2c7; box-shadow: 0 4px 16px rgba(17,17,16,0.06); }
        `}</style>
      </Head>
      <main style={pageStyle}>
        <div style={cardStyle} className="riff-card">
          {/* Top nav */}
          <header style={topNavStyle}>
            <a href="/" style={brandStyle}>
              <span style={dotStyle} />Riffly
            </a>
            <button onClick={signOut} style={ghostBtnSmStyle}>Sign out</button>
          </header>

          {/* Banners */}
          {/* Reviewer Flow 2: when the user comes here from the extension's
              "Sign in via rifflylabs.com →" button, the dashboard-bridge has
              just handed the token back to the extension. Without this
              banner, they'd sit on /dashboard wondering why nothing
              happened. Tell them their next step is to go back to LinkedIn. */}
          {fromExt && (
            <div style={bannerOkStyle} className="riff-banner">
              <strong>You're signed in.</strong> Go back to a candidate profile (LinkedIn, GitHub, or Wellfound), open Riffly from the Chrome toolbar, and start drafting. You can close this tab.
            </div>
          )}
          {needsReauthForRefresh && (
            <div style={bannerInfoStyle} className="riff-banner">
              <strong>Sign in again — one last time.</strong> We added auto-refresh so the extension never logs you out. To activate it, click <strong>Sign out</strong> above and sign back in. After that, never again.
            </div>
          )}
          {showUpgradedMsg && (
            <div style={bannerOkStyle} className="riff-banner">
              <strong>Welcome to {planLabel(me?.plan)}.</strong> Your subscription is active — happy drafting.
            </div>
          )}
          {showCanceledMsg && (
            <div style={bannerInfoStyle} className="riff-banner">
              Checkout canceled. No charge. You can upgrade anytime below.
            </div>
          )}
          {errorToast && (
            <div style={bannerErrorStyle} className="riff-banner">
              {errorToast}
            </div>
          )}

          {/* Profile header.
              The "Install the Riffly extension" prompt that used to live here
              was redundant with the OnboardingChecklist below AND with the
              detailed install walkthrough at the bottom of the page. Removed
              to cut three duplicate install CTAs down to one progress card. */}
          <section style={profileStyle}>
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="" referrerPolicy="no-referrer" style={avatarStyle} />
            ) : (
              <div style={avatarFallbackStyle}>{initials || '?'}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={nameRowStyle}>
                {me?.full_name || (me?.email?.split('@')[0]) || 'Unknown'}
              </div>
              <div style={subRowStyle}>{me?.email}</div>
              <div style={memberSinceStyle}>
                Member since {formatDate(me?.member_since)}
              </div>
            </div>
          </section>

          {/* Onboarding checklist — auto-ticks as the user progresses,
              self-dismisses once complete. Skips render entirely if the
              user has clicked Dismiss. */}
          <OnboardingChecklist token={token} plan={me?.plan} />

          {/* Usage stats */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Activity</div>
            <div style={statsGridStyle}>
              {(() => {
                const used = me?.usage?.this_week ?? 0;
                const remaining = isPaid ? null : Math.max(0, FREE_WEEKLY_LIMIT - used);
                let weekColor = '#0a0a0a';
                if (!isPaid) {
                  if (remaining === 0) weekColor = '#b8331a';      // depleted — red
                  else if (remaining === 1) weekColor = '#b85a1a'; // last one — amber
                }
                return (
                  <div style={statTileStyle} className="riff-stat">
                    <div style={{ ...statNumberStyle, color: weekColor }}>
                      {used}
                      {!isPaid && <span style={statLimitStyle}> / {FREE_WEEKLY_LIMIT}</span>}
                    </div>
                    <div style={statLabelStyle}>This week</div>
                    {!isPaid && remaining !== null && remaining <= 1 && (
                      <div style={urgencyTextStyle}>
                        {remaining === 0 ? 'Limit reached. Upgrade ↓' : '1 draft left this week'}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div style={statTileStyle} className="riff-stat">
                <div style={statNumberStyle}>{me?.usage?.this_month ?? 0}</div>
                <div style={statLabelStyle}>This month</div>
              </div>
              <div style={statTileStyle} className="riff-stat">
                <div style={statNumberStyle}>{me?.usage?.all_time ?? 0}</div>
                <div style={statLabelStyle}>All time</div>
              </div>
            </div>
          </section>

          {/* Subscription */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Subscription</div>
            <div style={subRowKVStyle}>
              <div>
                <div style={kvKeyStyle}>Plan</div>
                <div style={kvValueStyle}>{planLabel(me?.plan)}</div>
                <div style={kvSubStyle}>{planPrice(me?.plan)}</div>
              </div>
              {isPaid && me?.current_period_end && (
                <div>
                  <div style={kvKeyStyle}>{me?.cancel_at_period_end ? 'Cancels' : 'Renews'}</div>
                  <div style={kvValueStyle}>{formatDate(me.current_period_end)}</div>
                  <div style={kvSubStyle}>
                    {me?.cancel_at_period_end
                      ? 'Plan ends on this date. Reactivate any time.'
                      : 'Auto-renews unless canceled'}
                  </div>
                </div>
              )}
            </div>

            {/* Tier grid — visible to everyone, paid or free. The button on
                each tile is plan-aware: "Current plan" disabled if it's the
                user's plan, "Switch to X" if they're on a different paid
                plan, "Start X" if they're free. The /api/billing/checkout
                endpoint handles the in-place price swap (no double subs). */}
            <div style={upgradeStyle}>
              <p style={upgradeTextStyle}>
                {isPaid ? 'Change your plan or manage billing.' : 'Pick a plan. Cancel anytime.'}
              </p>

              <div style={tierGridStyle}>

                {/* Free */}
                <div style={tierCardStyle}>
                  <div style={tierNameStyle}>Free</div>
                  <div style={tierPriceStyle}>$0</div>
                  <div style={tierBlurbStyle}>Try it before paying.</div>
                  <ul style={tierListStyle}>
                    <li>3 drafts per week (+3 one-time bonus on first roast share)</li>
                    <li>Cold opener variant only</li>
                    <li>All profile sources (LinkedIn, GitHub, Wellfound)</li>
                    <li>Local reply stats</li>
                  </ul>
                  {me?.plan === 'free' ? (
                    <button disabled style={{ ...ghostBtnStyle, opacity: 0.6, cursor: 'default' }}>Current plan</button>
                  ) : isPaid ? (
                    <button onClick={openBillingPortal} style={ghostBtnStyle} className="riff-ghost-btn" title="Cancel via Stripe portal — your plan ends at the period boundary.">
                      Downgrade in portal
                    </button>
                  ) : null}
                </div>

                {/* Pro */}
                <div style={{ ...tierCardStyle, ...(me?.plan === 'pro' ? {} : tierCardHighlightStyle) }} className={me?.plan !== 'pro' ? 'riff-popular' : ''}>
                  {me?.plan !== 'pro' && me?.plan !== 'plus' && <div style={tierBadgeStyle}>Most popular</div>}
                  <div style={tierNameStyle}>Pro</div>
                  <div style={tierPriceStyle}>$15<span style={tierMoStyle}>/mo</span></div>
                  <div style={tierBlurbStyle}>Everything you need to run cold outreach at speed.</div>
                  <ul style={tierListStyle}>
                    <li><strong>200 drafts / month</strong></li>
                    <li><strong>All 3 variants</strong> (cold opener + follow-up + breakup)</li>
                    <li>Voice fingerprint (drafts in your dialect)</li>
                    <li>Saved pitch templates, synced across devices</li>
                    <li>Three variants per draft (opener · follow-up · breakup)</li>
                    <li>7 languages</li>
                    <li>Cross-machine reply analytics</li>
                    <li>Email support</li>
                  </ul>
                  {me?.plan === 'pro' ? (
                    <button disabled style={{ ...primaryBtnStyle, opacity: 0.6, cursor: 'default' }}>Current plan</button>
                  ) : me?.plan === 'plus' ? (
                    <button onClick={() => startCheckout('pro')} style={ghostBtnStyle} className="riff-ghost-btn">Switch to Pro</button>
                  ) : (
                    <button onClick={() => startCheckout('pro')} style={primaryBtnStyle} className="riff-btn">Start Pro · $15/mo</button>
                  )}
                </div>

                {/* Plus — agentic features (in development).
                    Honest framing: the Pro feature set is fully delivered;
                    the Plus-exclusive agentic stuff ships in waves over the
                    next few weeks. We mark each upcoming line "Coming soon"
                    inline so anyone subscribing to Plus today knows exactly
                    what they're getting now vs. shortly. */}
                <div style={{ ...tierCardStyle, ...tierCardPlusStyle }}>
                  {me?.plan !== 'plus' && <div style={{ ...tierBadgeStyle, ...tierBadgePlusStyle }}>Power users</div>}
                  <div style={tierNameStyle}>Plus</div>
                  <div style={tierPriceStyle}>$25<span style={tierMoStyle}>/mo</span></div>
                  <div style={tierBlurbStyle}>Pro + 3x more drafts + live fit-scoring as you browse.</div>
                  <ul style={tierListStyle}>
                    <li><strong>600 drafts / month (3× Pro)</strong></li>
                    <li>Everything in Pro</li>
                    <li><strong>Active Profile Assist</strong>: live fit-scoring against your job specs as you browse</li>
                    <li>Up to 5 active job specs</li>
                    <li><strong>Saved-Search Daily Digest</strong>: auto-rank profiles in your saved LinkedIn searches</li>
                    <li>Up to 10 saved search watches</li>
                  </ul>
                  <div style={plusBetaNoteStyle}>
                    Plus is in beta. Active Profile Assist and the Saved-Search Daily Digest are both live. Current subscribers stay at $25/mo as long as the subscription stays active.
                  </div>
                  {me?.plan === 'plus' ? (
                    <button disabled style={{ ...primaryBtnStyle, opacity: 0.6, cursor: 'default' }}>Current plan</button>
                  ) : me?.plan === 'pro' ? (
                    <button onClick={() => startCheckout('plus')} style={primaryBtnStyle} className="riff-btn">Upgrade to Plus · +$10/mo</button>
                  ) : (
                    <button onClick={() => startCheckout('plus')} style={primaryBtnStyle} className="riff-btn">Start Plus · $25/mo</button>
                  )}
                </div>
              </div>

              {devMode && (
                <div style={{ marginTop: 14, fontSize: 12, color: '#888' }}>
                  devmode: <button onClick={() => startCheckout('test')} style={{ ...ghostBtnStyle, padding: '6px 10px', fontSize: 12 }} className="riff-ghost-btn" title="Smoke-test tier ($5/mo, full Pro features).">Test · $5/mo</button>
                </div>
              )}
            </div>

            {isPaid && (
              <button onClick={openBillingPortal} style={{ ...primaryBtnStyle, marginTop: 16 }}>
                Manage billing &amp; cancel
              </button>
            )}
          </section>

          {/* Usage panel — drafts used vs cap, color-coded warning bar.
              Renders first under the subscription card so the most
              load-bearing number on the dashboard is immediately visible. */}
          <UsagePanel token={token} plan={me?.plan} />

          {/* Voice fingerprint (Pro+ — the moat feature).
              Lets the user train Riffly on their writing samples so drafts
              come out in their dialect. Free users see a locked card. */}
          <VoiceFingerprintPanel token={token} plan={me?.plan} />

          {/* Job specs (Plus tier — Active Profile Assist).
              Renders before saved-search digest because specs power the
              fit-scoring that the digest results depend on. */}
          <JobSpecsPanel token={token} plan={me?.plan} />

          {/* Saved-Search Daily Digest (Plus tier).
              Self-contained: fetches its own /api/saved-searches and
              /api/saved-searches/digest, manages its own form state, shows
              an upgrade-locked card for Free/Pro users. */}
          <SavedSearchesPanel token={token} plan={me?.plan} />

          {/* Extension setup — Chrome Web Store flow.
              Three steps once the listing is live: Add to Chrome, pin,
              paste-token. While the listing is in review, we still surface
              the token + the in-review notice so devmode users can paste-test.
              The dev-only "load unpacked" path is gated behind ?devmode=1. */}
          <section id="install-steps" style={sectionStyle}>
            <div style={sectionTitleStyle}>Install the extension</div>

            {!CHROME_STORE_URL && (
              <div style={inReviewBannerStyle}>
                <strong>In Chrome Web Store review.</strong> Riffly submits to the store on every release;
                Google's review usually takes 1–7 days. We'll email you the moment the listing is live.
              </div>
            )}

            <p style={pStyle}>
              {CHROME_STORE_URL
                ? 'Three clicks. About 30 seconds.'
                : 'Once the store listing is live, install is three clicks (about 30 seconds).'}
            </p>

            <div style={installStepsStyle}>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>1</span>
                <div style={{ flex: 1 }}>
                  <strong>Add Riffly to Chrome</strong>
                  <div style={installBodyStyle}>
                    {CHROME_STORE_URL ? (
                      <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={primaryBtnStyle}>
                        Add to Chrome →
                      </a>
                    ) : (
                      <span style={{ ...primaryBtnStyle, opacity: 0.55, cursor: 'default', display: 'inline-block' }}>
                        Add to Chrome (coming soon)
                      </span>
                    )}
                  </div>
                  <div style={installNoteStyle}>
                    Chrome will ask you to confirm — click <strong>Add extension</strong>.
                  </div>
                </div>
              </div>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>2</span>
                <div style={{ flex: 1 }}>
                  <strong>Pin Riffly to your toolbar</strong>
                  <div style={installNoteStyle}>
                    Click the <strong>puzzle-piece icon</strong> in the top-right of Chrome (next to your profile picture).
                    Find <strong>Riffly</strong> in the list and click the <strong>pin icon</strong> next to it.
                    Riffly's icon now sits in your toolbar.
                  </div>
                </div>
              </div>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>3</span>
                <div style={{ flex: 1 }}>
                  <strong>Sign in</strong>
                  {extensionDetected ? (
                    <>
                      <div style={installNoteStyle}>
                        Riffly is installed. One click to sign in — no copy/paste needed.
                      </div>
                      <div style={tokenRowStyle}>
                        <button
                          onClick={connectExtension}
                          style={{
                            ...primaryBtnStyle,
                            opacity: connectStatus === 'connecting' ? 0.6 : 1,
                            cursor: connectStatus === 'connecting' ? 'wait' : 'pointer',
                          }}
                          disabled={connectStatus === 'connecting'}
                        >
                          {connectStatus === 'connected'
                            ? '✓ Connected'
                            : connectStatus === 'connecting'
                              ? 'Connecting…'
                              : 'Connect extension'}
                        </button>
                      </div>
                      {connectStatus === 'connected' && (
                        <div style={{ ...installNoteStyle, color: '#1a7a48' }}>
                          You're signed in. The extension will stay signed in automatically.
                        </div>
                      )}
                      {connectStatus === 'error' && connectError && (
                        <div style={{ ...installNoteStyle, color: '#b8331a' }}>
                          {connectError} Falling back to copy/paste — see below.
                        </div>
                      )}
                      {(connectStatus === 'idle' || connectStatus === 'error') && (
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ cursor: 'pointer', color: '#666', fontSize: 12 }}>
                            Or paste a token manually
                          </summary>
                          <div style={installNoteStyle}>
                            Click the Riffly icon in your toolbar, paste this token, click <strong>Save token</strong>.
                          </div>
                          <div style={tokenRowStyle}>
                            <code style={tokenPreviewStyle}>{tokenPreview}</code>
                            <button onClick={copyToken} style={tokenBtnStyle}>
                              {tokenCopied ? '✓ Copied' : 'Copy token'}
                            </button>
                          </div>
                        </details>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={installNoteStyle}>
                        Click the Riffly icon in your toolbar. The popup opens. Paste this token where it says <strong>"Sign in to Riffly"</strong>, then click <strong>Save token</strong>.
                      </div>
                      <div style={tokenRowStyle}>
                        <code style={tokenPreviewStyle}>{tokenPreview}</code>
                        <button onClick={copyToken} style={tokenBtnStyle}>
                          {tokenCopied ? '✓ Copied' : 'Copy token'}
                        </button>
                      </div>
                      <div style={{ ...installNoteStyle, fontSize: 11, opacity: 0.7 }}>
                        Already installed? Reload this page — we'll detect the extension and show a one-click <strong>Connect</strong> button instead.
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>

            <details style={{ marginTop: 24 }}>
              <summary style={detailsSummaryStyle}>Something went wrong?</summary>
              <ul style={troubleshootStyle}>
                <li><strong>Riffly popup says "Open a LinkedIn profile..."</strong> — you're on the LinkedIn home page or feed. Click into a person's profile (URL must contain <code>/in/</code>).</li>
                <li><strong>Generation says "Sign in first"</strong> — your token wasn't saved. Click the Riffly icon again, paste the token, hit Save.</li>
                <li><strong>Got signed out</strong> — your refresh token was rotated or revoked. Sign in to your dashboard again, then click <strong>Connect extension</strong> (or paste a fresh token if Connect isn't visible).</li>
                <li><strong>Auto-update isn't picking up new versions</strong> — Chrome auto-updates extensions every few hours. To force it: open <code>chrome://extensions</code>, toggle Developer mode on, click <strong>Update</strong> at the top.</li>
              </ul>
            </details>

            {devMode && (
              <details style={{ marginTop: 16, borderTop: '1px dashed #ddd', paddingTop: 14 }}>
                <summary style={detailsSummaryStyle}>devmode: load unpacked from local source</summary>
                <ol style={{ ...troubleshootStyle, listStyle: 'decimal' }}>
                  <li>Clone or pull the latest <code>riff</code> repo to your machine.</li>
                  <li>Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top-right toggle).</li>
                  <li>Click <strong>Load unpacked</strong> and select the <code>extension/</code> folder from the repo.</li>
                  <li>Pin Riffly to your toolbar (puzzle-piece icon → pin).</li>
                  <li>Paste the token above into the popup.</li>
                </ol>
                <p style={smallStyle}>
                  This path is for first-party dogfooding only. We do not serve the unpacked source from a public URL.
                </p>
              </details>
            )}

            <p style={smallStyle}>
              Your token is stored only in <code>chrome.storage.local</code> on your computer. It never leaves your machine except when the extension talks to Riffly's API. Don't share it — anyone with this token can use Riffly as you.
            </p>
          </section>

          {/* Footer */}
          <footer style={footerStyle}>
            <a href="/" style={linkStyle}>Home</a>
            <a href="mailto:support@rifflylabs.com?subject=Riffly%20feedback" style={linkStyle}>Send feedback</a>
          </footer>
        </div>
      </main>
    </>
  );
}

// ---------- styles ----------

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#fafafa', padding: '40px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 40,
  // Bumped from 640 -> 920. The previous narrow column wasted huge amounts
  // of horizontal space on desktop monitors and made the inner pricing
  // grid + saved-search panels feel cramped. 920 still keeps prose
  // readable (paragraphs in the Activity/Subscription subsections) while
  // letting wider grids breathe.
  maxWidth: 920, margin: '0 auto',
};

const topNavStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 24, paddingBottom: 18, borderBottom: '1px solid #f0f0f2',
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontWeight: 800, fontSize: 20, letterSpacing: '-0.03em',
  color: '#0a0a0a', textDecoration: 'none',
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };

const bannerOkStyle: React.CSSProperties = {
  background: '#ecfdf3', border: '1px solid #a6e3bd', color: '#065f46',
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 18,
};
const bannerInfoStyle: React.CSSProperties = {
  background: '#f5f5f7', border: '1px solid #e5e5e7', color: '#444',
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 18,
};
const bannerErrorStyle: React.CSSProperties = {
  background: '#fef2f0', border: '1px solid #f4c4ba', color: '#b8331a',
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 18,
};

const profileStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28,
};
const avatarStyle: React.CSSProperties = {
  width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
  border: '1px solid #e5e5e7', objectFit: 'cover',
};
const avatarFallbackStyle: React.CSSProperties = {
  width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
  background: '#0a0a0a', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: 18, letterSpacing: '0.02em',
};
const nameRowStyle: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const subRowStyle: React.CSSProperties = {
  fontSize: 14, color: '#555', marginTop: 2,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const memberSinceStyle: React.CSSProperties = {
  fontSize: 12, color: '#999', marginTop: 6,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 28, paddingBottom: 22, borderBottom: '1px solid #f0f0f2',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#777',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  marginBottom: 14,
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
};
const statTileStyle: React.CSSProperties = {
  background: '#fafafa', border: '1px solid #f0f0f2', borderRadius: 10, padding: '14px 12px',
};
const statNumberStyle: React.CSSProperties = {
  fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#0a0a0a',
};
const statLimitStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 500, color: '#999',
};
const statLabelStyle: React.CSSProperties = {
  fontSize: 12, color: '#777', marginTop: 4,
};

const subRowKVStyle: React.CSSProperties = {
  display: 'flex', gap: 32, marginBottom: 14, flexWrap: 'wrap',
};
const kvKeyStyle: React.CSSProperties = {
  fontSize: 12, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
};
const kvValueStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 700,
};
const kvSubStyle: React.CSSProperties = {
  fontSize: 12, color: '#999', marginTop: 2,
};

const upgradeStyle: React.CSSProperties = {
  background: '#fafafa', padding: 18, borderRadius: 10, marginTop: 14,
  border: '1px solid #f0f0f2',
};
const upgradeTextStyle: React.CSSProperties = {
  fontSize: 13, color: '#555', margin: '0 0 16px', lineHeight: 1.55,
};
const tierGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 10,
};
const tierCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e5e7',
  borderRadius: 10,
  padding: '16px 14px',
  position: 'relative',
  display: 'flex', flexDirection: 'column', gap: 10,
};
const tierCardHighlightStyle: React.CSSProperties = {
  borderColor: '#0a0a0a',
  borderWidth: 2,
  boxShadow: '0 2px 12px rgba(17, 17, 16, 0.08)',
};
const tierCardPlusStyle: React.CSSProperties = {
  borderColor: '#b14a1a',
  background: 'linear-gradient(180deg, #fff 0%, #fdeee5 100%)',
};
const tierBadgeStyle: React.CSSProperties = {
  position: 'absolute', top: -10, left: 12,
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: '#fff', background: '#0a0a0a',
  padding: '3px 9px', borderRadius: 100,
};
const tierBadgePlusStyle: React.CSSProperties = {
  background: '#b14a1a',
};
// Inline "Coming soon" pill used inside Plus tier feature bullets.
// Small, low-contrast, sits next to the feature so users see exactly
// which lines aren't built yet without us hiding the tier entirely.
const comingSoonPillStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#6b4a14',
  background: '#fff8eb',
  border: '1px solid #f3d99a',
  padding: '1px 6px',
  borderRadius: 100,
  marginLeft: 4,
  verticalAlign: 'middle',
};
// Soft footnote below the Plus feature list. Sets honest expectations
// before checkout — Plus is in beta, features ship in waves, price-locked.
const plusBetaNoteStyle: React.CSSProperties = {
  marginTop: 12,
  marginBottom: 10,
  padding: '8px 10px',
  background: '#fff8eb',
  border: '1px solid #f3d99a',
  borderRadius: 8,
  fontSize: 11,
  color: '#6b4a14',
  lineHeight: 1.45,
};
const tierNameStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#0a0a0a',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tierPriceStyle: React.CSSProperties = {
  fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: '#0a0a0a',
};
const tierMoStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: '#888', marginLeft: 2,
};
const tierBlurbStyle: React.CSSProperties = {
  fontSize: 12, color: '#666', lineHeight: 1.45,
};
const tierListStyle: React.CSSProperties = {
  margin: '4px 0 8px', paddingLeft: 16,
  fontSize: 12, color: '#444', lineHeight: 1.55,
  flex: 1,
};
const upgradeBtnsStyle: React.CSSProperties = {
  display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start',
};
const proBtnWrapStyle: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
};
const popularBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: '#b14a1a', background: '#fdeee5', padding: '2px 8px', borderRadius: 6,
};
const urgencyTextStyle: React.CSSProperties = {
  fontSize: 11, color: '#b8331a', marginTop: 6, fontWeight: 600,
};

const tokenRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
};
const tokenPreviewStyle: React.CSSProperties = {
  flex: 1, padding: '10px 12px', background: '#fafafa',
  border: '1px solid #e5e5e7', borderRadius: 8,
  fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
  fontSize: 13, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const tokenBtnStyle: React.CSSProperties = {
  padding: '10px 16px', background: '#0a0a0a', color: '#fff', border: 'none',
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  fontFamily: 'inherit',
};

const extHeroNewStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, #faf9f6 0%, #f3f0e8 100%)',
  border: '1px solid #d6d2c7',
  borderRadius: 14,
  padding: '24px 24px 26px',
  marginBottom: 28,
};
const extHeroEyebrowStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: '#b14a1a', marginBottom: 10,
};
const extHeroTitleStyle: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8, color: '#0a0a0a',
};
const extHeroBodyStyle: React.CSSProperties = {
  fontSize: 14, color: '#444', lineHeight: 1.55, margin: '0 0 16px',
};
const extHeroBtnRowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, flexWrap: 'wrap',
};
const extHeroCompactStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  background: '#fafafa', border: '1px solid #f0f0f2', borderRadius: 10,
  padding: '12px 14px', marginBottom: 24,
};
const inReviewBannerStyle: React.CSSProperties = {
  background: '#fff8eb',
  border: '1px solid #f3d99a',
  borderRadius: 8,
  padding: '10px 14px',
  marginBottom: 14,
  fontSize: 13,
  color: '#6b4a14',
  lineHeight: 1.55,
};
const installStepsStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14,
};
const installStepStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  fontSize: 14, color: '#333', lineHeight: 1.55,
};
const installStepNumStyle: React.CSSProperties = {
  flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
  background: '#0a0a0a', color: '#fff',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, marginTop: 2,
};
const installNoteStyle: React.CSSProperties = {
  fontSize: 13, color: '#555', marginTop: 6, lineHeight: 1.6,
};
const installBodyStyle: React.CSSProperties = {
  marginTop: 8,
};
const detailsSummaryStyle: React.CSSProperties = {
  fontSize: 13, color: '#555', cursor: 'pointer',
  paddingTop: 6, paddingBottom: 6, fontWeight: 600,
};
const troubleshootStyle: React.CSSProperties = {
  marginTop: 10, paddingLeft: 22, fontSize: 13, color: '#555', lineHeight: 1.7,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px', background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '10px 18px', background: 'transparent', color: '#0a0a0a', border: '1px solid #d8d8dc',
  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const ghostBtnSmStyle: React.CSSProperties = {
  padding: '7px 14px', background: 'transparent', color: '#0a0a0a', border: '1px solid #d8d8dc',
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const pStyle: React.CSSProperties = {
  margin: '0 0 8px', fontSize: 14, color: '#555', lineHeight: 1.55,
};
const smallStyle: React.CSSProperties = { fontSize: 12, color: '#999', marginTop: 12 };
const footerStyle: React.CSSProperties = {
  display: 'flex', gap: 24, fontSize: 13, paddingTop: 8,
};
const linkStyle: React.CSSProperties = { color: '#777', textDecoration: 'none' };
