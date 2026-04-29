// /dashboard — the user's account hub.
// Profile header, usage stats, subscription details, extension setup.

import { useEffect, useState } from 'react';
import Head from 'next/head';

interface MeResponse {
  ok: boolean;
  email?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  plan?: 'free' | 'pro' | 'team';
  remainingThisWeek?: number;
  hasSubscription?: boolean;
  member_since?: string;
  current_period_end?: string | null;
  usage?: {
    this_week: number;
    this_month: number;
    all_time: number;
  };
}

const FREE_WEEKLY_LIMIT = 3;

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
  if (plan === 'pro') return 'Pro';
  if (plan === 'team') return 'Team';
  return 'Free';
}

function planPrice(plan?: string): string {
  if (plan === 'pro') return '$39 / month';
  if (plan === 'team') return '$99 / month';
  return 'Free · 5 drafts/week';
}

export default function Dashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showCanceledMsg, setShowCanceledMsg] = useState(false);
  const [showUpgradedMsg, setShowUpgradedMsg] = useState(false);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === '1') setShowCanceledMsg(true);
    if (params.get('upgraded') === '1') setShowUpgradedMsg(true);
    if (params.get('devmode') === '1') setDevMode(true);

    const t = window.localStorage.getItem('riff_token');
    setToken(t);
    if (!t) {
      window.location.href = '/signup';
      return;
    }
    fetch('/api/me', { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.json())
      .then((data: MeResponse) => {
        setMe(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  async function startCheckout(plan: 'pro' | 'team' | 'test') {
    if (!token) return;
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (data.ok && data.url) window.location.href = data.url;
    else alert(data.error || 'Could not start checkout');
  }

  async function openBillingPortal() {
    if (!token) return;
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok && data.url) window.location.href = data.url;
    else alert(data.error || 'Could not open billing portal');
  }

  function signOut() {
    try { window.localStorage.removeItem('riff_token'); } catch {}
    window.location.href = '/';
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', color: '#777' }}>Loading…</div>
      </main>
    );
  }

  const isPaid = me?.plan === 'pro' || me?.plan === 'team';
  const initials = (me?.full_name || me?.email || '?').split(/\s+|@/).filter(Boolean).map(s => s[0]?.toUpperCase()).slice(0, 2).join('');
  const tokenPreview = token ? `${token.slice(0, 12)}…${token.slice(-6)}` : '';

  return (
    <>
      <Head><title>Dashboard — Riff</title></Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          {/* Top nav */}
          <header style={topNavStyle}>
            <a href="/" style={brandStyle}>
              <span style={dotStyle} />Riff
            </a>
            <button onClick={signOut} style={ghostBtnSmStyle}>Sign out</button>
          </header>

          {/* Banners */}
          {showUpgradedMsg && (
            <div style={bannerOkStyle}>
              <strong>Welcome to Pro.</strong> Your subscription is active — happy drafting.
            </div>
          )}
          {showCanceledMsg && (
            <div style={bannerInfoStyle}>
              Checkout canceled. No charge. You can upgrade anytime below.
            </div>
          )}

          {/* Extension hero — always visible, prominent for new users.
              First thing every user sees after sign in.
              Without the extension, the product does nothing — so this is
              the highest-priority action for any user who hasn't set it up. */}
          {(me?.usage?.all_time ?? 0) === 0 ? (
            <section style={extHeroNewStyle}>
              <div style={extHeroEyebrowStyle}>Step 1 · 60 seconds</div>
              <div style={extHeroTitleStyle}>Install the Riff extension</div>
              <p style={extHeroBodyStyle}>
                Riff lives in your Chrome toolbar. Open a LinkedIn, GitHub, or Wellfound
                profile, click the icon, and Riff drafts the message.
              </p>
              <div style={extHeroBtnRowStyle}>
                <a href="/riff-extension.zip" download style={primaryBtnStyle}>
                  ↓ Download extension
                </a>
                <a href="#install-steps" style={ghostBtnStyle}>How to install ↓</a>
              </div>
            </section>
          ) : (
            <section style={extHeroCompactStyle}>
              <div style={{ flex: 1 }}>
                <strong>Riff extension</strong>
                <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                  Need to reinstall, or set it up on a new machine?
                </div>
              </div>
              <a href="/riff-extension.zip" download style={ghostBtnSmStyle}>
                ↓ Re-download
              </a>
            </section>
          )}

          {/* Profile header */}
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
                  <div style={statTileStyle}>
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
              <div style={statTileStyle}>
                <div style={statNumberStyle}>{me?.usage?.this_month ?? 0}</div>
                <div style={statLabelStyle}>This month</div>
              </div>
              <div style={statTileStyle}>
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
                  <div style={kvKeyStyle}>Renews</div>
                  <div style={kvValueStyle}>{formatDate(me.current_period_end)}</div>
                  <div style={kvSubStyle}>Auto-renews unless canceled</div>
                </div>
              )}
            </div>

            {!isPaid && (
              <div style={upgradeStyle}>
                <p style={upgradeTextStyle}>
                  Pro unlocks <strong>unlimited drafts</strong>, all <strong>3 variants per generation</strong> (cold opener + follow-up + breakup), tone controls, and reply tracking.
                </p>
                <div style={upgradeBtnsStyle}>
                  <div style={proBtnWrapStyle}>
                    <button onClick={() => startCheckout('pro')} style={primaryBtnStyle}>Get Pro · $39/mo</button>
                    <span style={popularBadgeStyle}>Most popular</span>
                  </div>
                  <button onClick={() => startCheckout('team')} style={ghostBtnStyle}>Team · $99/mo</button>
                  {devMode && (
                    <button onClick={() => startCheckout('test')} style={ghostBtnStyle} title="Smoke-test tier (devmode only).">Test · $5/mo</button>
                  )}
                </div>
              </div>
            )}

            {isPaid && (
              <button onClick={openBillingPortal} style={primaryBtnStyle}>Manage billing &amp; cancel</button>
            )}
          </section>

          {/* Extension setup */}
          <section id="install-steps" style={sectionStyle}>
            <div style={sectionTitleStyle}>Get the extension</div>
            <p style={pStyle}>
              Two minutes. Download, unzip, point Chrome at the folder, paste your token.
            </p>

            <div style={installStepsStyle}>
              <div style={installStepStyle}>
                <span style={installStepNumStyle}>1</span>
                <div style={{ flex: 1 }}>
                  <a href="/riff-extension.zip" download style={primaryBtnStyle}>
                    ↓ Download Riff extension
                  </a>
                  <div style={installNoteStyle}>~16 KB · unzip after downloading</div>
                </div>
              </div>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>2</span>
                <div style={{ flex: 1 }}>
                  <strong>Open <code>chrome://extensions</code></strong> in a new tab.
                  <div style={installNoteStyle}>Toggle <strong>Developer mode</strong> on (top right).</div>
                </div>
              </div>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>3</span>
                <div style={{ flex: 1 }}>
                  <strong>Click "Load unpacked"</strong> → pick the unzipped folder.
                  <div style={installNoteStyle}>Pin the Riff icon to your toolbar.</div>
                </div>
              </div>

              <div style={installStepStyle}>
                <span style={installStepNumStyle}>4</span>
                <div style={{ flex: 1 }}>
                  <strong>Paste this token</strong> into the extension's Sign-in field:
                  <div style={tokenRowStyle}>
                    <code style={tokenPreviewStyle}>{tokenPreview}</code>
                    <button onClick={copyToken} style={tokenBtnStyle}>
                      {tokenCopied ? '✓ Copied' : 'Copy token'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <p style={smallStyle}>
              Token is stored in <code>chrome.storage.local</code> on your device. Don't share it.
            </p>
          </section>

          {/* Footer */}
          <footer style={footerStyle}>
            <a href="/" style={linkStyle}>Home</a>
            <a href="mailto:hello@riff.example" style={linkStyle}>Support</a>
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
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 36,
  maxWidth: 640, margin: '0 auto',
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
  background: '#f5f5f7', padding: 18, borderRadius: 10, marginTop: 14,
};
const upgradeTextStyle: React.CSSProperties = {
  fontSize: 13, color: '#444', margin: '0 0 12px', lineHeight: 1.55,
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
  fontSize: 12, color: '#777', marginTop: 4,
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
