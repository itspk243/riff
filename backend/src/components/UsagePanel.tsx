// Dashboard usage panel. Fetches /api/usage on mount and renders a
// progress bar that shifts color as the user approaches their cap:
//   <70% used → green   ("you're fine")
//   70-90%    → amber   ("heads up")
//   90%+      → red     ("upgrade or wait for reset")
// Free users see a weekly window, Pro/Plus see calendar-month.
//
// Pre-pricing-page surfaces ("you'll get N drafts/month at this tier")
// live elsewhere — this panel is for users who already have a plan.

import { useEffect, useState } from 'react';

type Plan = 'free' | 'pro' | 'plus' | 'team';

interface UsageSnapshot {
  used: number;
  limit: number | null;
  remaining: number | null;
  plan: Plan;
  resetsAt: string | null;
  resetsLabel: string;
  windowKind: 'monthly' | 'weekly';
}

interface Props {
  token: string | null;
  plan?: Plan;
}

export default function UsagePanel({ token, plan }: Props) {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [roastShareUsed, setRoastShareUsed] = useState(false);
  const [bonusDrafts, setBonusDrafts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok && data.usage) {
          setUsage(data.usage);
          setRoastShareUsed(!!data.roastShareUsed);
          setBonusDrafts(typeof data.bonusDrafts === 'number' ? data.bonusDrafts : 0);
        } else setError(data.error || 'Could not load usage');
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <section style={sectionStyle}>
        <div style={titleStyle}>Drafts this {usage?.windowKind === 'weekly' ? 'week' : 'month'}</div>
        <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>
      </section>
    );
  }

  if (error || !usage) {
    return (
      <section style={sectionStyle}>
        <div style={titleStyle}>Drafts this month</div>
        <div style={{ fontSize: 13, color: '#888' }}>{error || 'Usage unavailable.'}</div>
      </section>
    );
  }

  const used = usage.used;
  const limit = usage.limit ?? 0;
  const remaining = usage.remaining ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  // Threshold tier — drives color + the warning copy.
  const tier =
    pct >= 100 ? 'blocked'
    : pct >= 90 ? 'red'
    : pct >= 70 ? 'amber'
    : 'green';

  const barColor =
    tier === 'blocked' ? '#b14a1a'
    : tier === 'red'   ? '#b14a1a'
    : tier === 'amber' ? '#c87a17'
    : '#1a7a48';

  const windowLabel = usage.windowKind === 'weekly' ? 'this week' : 'this month';
  const planLabel = labelForPlan(usage.plan);

  // Show upgrade nudge when Pro users get within 20% of their cap, or any time blocked.
  const showProUpgrade = usage.plan === 'pro' && (tier === 'amber' || tier === 'red' || tier === 'blocked');
  // Free user is running low and hasn't claimed the one-time +3 roast-share bonus.
  // Show this BEFORE the Pro upgrade CTA so the user has a free recovery path first.
  const showShareForBonus = usage.plan === 'free' && tier !== 'green' && !roastShareUsed;
  // Free user is running low AND already burned the bonus → push toward Pro.
  const showPlusFreeUpgrade = usage.plan === 'free' && tier !== 'green' && roastShareUsed;

  return (
    <section style={sectionStyle} id="usage-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={titleStyle}>
          Drafts {windowLabel} · {planLabel}
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {limit > 0 ? `${used} / ${limit}` : `${used} used`}
        </div>
      </div>

      <div style={barTrackStyle}>
        <div style={{ ...barFillStyle, width: `${Math.max(2, pct)}%`, background: barColor }} />
      </div>

      <div style={statusRowStyle}>
        <span style={{ color: tier === 'green' ? '#666' : barColor, fontWeight: tier === 'green' ? 400 : 600 }}>
          {tier === 'blocked' ? 'Limit reached.'
          : tier === 'red'    ? `Only ${remaining} draft${remaining === 1 ? '' : 's'} left.`
          : tier === 'amber'  ? `${remaining} drafts left.`
          : `${remaining} drafts left.`}
        </span>
        {usage.resetsAt && (
          <span style={{ color: '#888' }}>Resets {usage.resetsLabel}</span>
        )}
      </div>

      {bonusDrafts > 0 && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
          Includes <strong>+{bonusDrafts}</strong> bonus draft{bonusDrafts === 1 ? '' : 's'} from sharing a roast.
        </div>
      )}

      {showProUpgrade && (
        <div style={ctaCardStyle}>
          <div style={{ fontSize: 13.5, color: '#444', marginBottom: 8 }}>
            <strong>Need more headroom?</strong> Plus is 600 drafts/month (3× Pro)
            plus voice fingerprint and active profile assist.
          </div>
          <a href="#subscription" style={ctaBtnStyle}>Upgrade to Plus →</a>
        </div>
      )}

      {showShareForBonus && (
        <div style={ctaCardStyle}>
          <div style={{ fontSize: 13.5, color: '#444', marginBottom: 8 }}>
            <strong>Out of drafts? Share a roast and get +3 free.</strong>{' '}
            One-time bonus, no card needed. Then Pro is $15/mo for 200 drafts if you keep going.
          </div>
          <a href="/roast" style={ctaBtnStyle}>Earn 3 bonus drafts →</a>
        </div>
      )}

      {showPlusFreeUpgrade && (
        <div style={ctaCardStyle}>
          <div style={{ fontSize: 13.5, color: '#444', marginBottom: 8 }}>
            <strong>You're close to the free weekly cap.</strong> Pro gets you 200 drafts/month for $15.
          </div>
          <a href="#subscription" style={ctaBtnStyle}>See plans →</a>
        </div>
      )}
    </section>
  );
}

function labelForPlan(plan: Plan): string {
  if (plan === 'free') return 'Free';
  if (plan === 'pro') return 'Pro';
  if (plan === 'plus') return 'Plus';
  if (plan === 'team') return 'Team';
  return plan;
}

// ---------- styles (matches the flat sub-section pattern used by the other panels) ----------

const sectionStyle: React.CSSProperties = {
  background: 'transparent',
  padding: 0,
  marginBottom: 28,
  paddingBottom: 24,
  borderBottom: '1px solid #f0f0f2',
};

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: '#666',
  marginBottom: 14,
};

const barTrackStyle: React.CSSProperties = {
  height: 10,
  background: '#f0eee8',
  borderRadius: 6,
  overflow: 'hidden',
  marginBottom: 8,
};

const barFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 6,
  transition: 'width 0.3s ease, background 0.2s ease',
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  fontSize: 13,
  marginTop: 6,
};

const ctaCardStyle: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  background: '#faf9f6',
  border: '1px dashed #d6d2c7',
  borderRadius: 10,
};

const ctaBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
};
