// /dashboard — the user's account hub.
// Shows current plan, free-tier remaining, upgrade CTAs (Stripe Checkout),
// billing portal link (Stripe), and a copy-extension-token UI.

import { useEffect, useState } from 'react';
import Head from 'next/head';

interface MeResponse {
  ok: boolean;
  plan?: 'free' | 'pro' | 'team';
  email?: string;
  remainingThisWeek?: number;
  hasSubscription?: boolean;
}

export default function Dashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  async function startCheckout(plan: 'pro' | 'team') {
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
    alert('Token copied — paste it into the Riff extension.');
  }

  if (loading) return <main style={pageStyle}><div style={cardStyle}>Loading…</div></main>;

  return (
    <>
      <Head><title>Dashboard — Riff</title></Head>
      <main style={pageStyle}>
        <div style={cardStyle}>
          <header style={headerStyle}>
            <a href="/" style={brandStyle}><span style={dotStyle} />Riff</a>
            <button onClick={signOut} style={ghostBtnStyle}>Sign out</button>
          </header>

          <h1 style={h1Style}>Hey{me?.email ? `, ${me.email.split('@')[0]}` : ''}.</h1>

          <section style={sectionStyle}>
            <div style={planRowStyle}>
              <div>
                <div style={smallLabelStyle}>Current plan</div>
                <div style={planNameStyle}>
                  {me?.plan === 'pro' ? 'Pro' : me?.plan === 'team' ? 'Team' : 'Free'}
                </div>
              </div>
              <div>
                <div style={smallLabelStyle}>This week</div>
                <div style={planNameStyle}>
                  {me?.plan === 'pro' || me?.plan === 'team' ? '∞' : `${me?.remainingThisWeek ?? 5} / 5`}
                </div>
              </div>
            </div>

            {(!me?.plan || me?.plan === 'free') && (
              <div style={upgradeStyle}>
                <p style={upgradeTextStyle}>Upgrade for unlimited generations, 3 variants per call, tone controls, and reply tracking.</p>
                <div style={upgradeBtnsStyle}>
                  <button onClick={() => startCheckout('pro')} style={primaryBtnStyle}>Get Pro · $39/mo</button>
                  <button onClick={() => startCheckout('team')} style={ghostBtnStyle}>Team · $99/mo</button>
                </div>
              </div>
            )}

            {(me?.plan === 'pro' || me?.plan === 'team') && (
              <button onClick={openBillingPortal} style={primaryBtnStyle}>Manage billing &amp; cancel</button>
            )}
          </section>

          <section style={sectionStyle}>
            <h2 style={h2Style}>Connect the extension</h2>
            <p style={pStyle}>Paste your token into the Riff extension's Sign-in field to authenticate.</p>
            <button onClick={copyToken} style={primaryBtnStyle}>Copy token</button>
            <p style={smallStyle}>The extension stores this in chrome.storage.local. Don't share it.</p>
          </section>

          <footer style={footerStyle}>
            <a href="/" style={linkStyle}>Home</a>
            <a href="mailto:hello@riff.example" style={linkStyle}>Support</a>
          </footer>
        </div>
      </main>
    </>
  );
}

// styles
const pageStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#fafafa', padding: '40px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e5e7', borderRadius: 16, padding: 40,
  maxWidth: 560, margin: '0 auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24,
};
const brandStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 22,
  letterSpacing: '-0.03em', color: '#0a0a0a', textDecoration: 'none',
};
const dotStyle: React.CSSProperties = { width: 9, height: 9, background: '#0a0a0a', borderRadius: '50%' };
const h1Style: React.CSSProperties = { margin: '0 0 24px', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' };
const h2Style: React.CSSProperties = { margin: '0 0 8px', fontSize: 17, fontWeight: 700 };
const pStyle: React.CSSProperties = { margin: '0 0 14px', fontSize: 14, color: '#555', lineHeight: 1.55 };
const sectionStyle: React.CSSProperties = { marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #f0f0f2' };
const planRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 };
const smallLabelStyle: React.CSSProperties = { fontSize: 12, color: '#777', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const planNameStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700 };
const upgradeStyle: React.CSSProperties = { background: '#f5f5f7', padding: 18, borderRadius: 10 };
const upgradeTextStyle: React.CSSProperties = { fontSize: 13, color: '#444', margin: '0 0 12px', lineHeight: 1.55 };
const upgradeBtnsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px', background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8,
  fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '10px 18px', background: 'transparent', color: '#0a0a0a', border: '1px solid #d8d8dc',
  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const smallStyle: React.CSSProperties = { fontSize: 12, color: '#777', marginTop: 10 };
const footerStyle: React.CSSProperties = { display: 'flex', gap: 24, fontSize: 13 };
const linkStyle: React.CSSProperties = { color: '#777', textDecoration: 'none' };
