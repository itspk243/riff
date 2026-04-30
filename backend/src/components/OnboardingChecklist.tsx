// Dashboard onboarding checklist — surfaces above the fold until the user
// has done the things that prove Riffly is "working" for them. Auto-ticks
// as they progress. Dismiss button stores a flag in localStorage so it
// stays out of the way once the user is set up.
//
// Steps are progressive — only show what's relevant for the user's plan:
//   1. Install Riffly in Chrome           (everyone)
//   2. Generate your first draft          (everyone)
//   3. Add a job spec for fit-scoring     (Plus only — drives upgrade nudge)
//   4. Track a LinkedIn search            (Plus only)
//
// "Sign in" is implicit (they're on /dashboard, so they're authed). We
// don't track it as its own step.

import { useEffect, useState } from 'react';

type Plan = 'free' | 'pro' | 'plus' | 'team';

interface Status {
  ok: boolean;
  extensionUsed?: boolean;
  firstSpec?: boolean;
  firstSearch?: boolean;
  plan?: Plan;
}

interface Props {
  token: string | null;
  plan?: Plan;
}

const DISMISS_KEY = 'riff_onboarding_dismissed_v1';

export default function OnboardingChecklist({ token, plan }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Read the dismiss flag once. If it's set, we won't bother fetching status.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
        setDismissed(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!token || dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/onboarding-status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ ok: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, dismissed]);

  if (dismissed) return null;
  if (loading || !status?.ok) return null;

  const isPlus = plan === 'plus' || plan === 'team';

  // Build the step list with done/action.
  const steps: Array<{
    id: string;
    title: string;
    description: string;
    done: boolean;
    action?: { label: string; onClick?: () => void; href?: string };
  }> = [
    {
      id: 'install',
      title: 'Install Riffly in Chrome',
      description: 'Riffly lives in your browser toolbar. Open a profile, click the icon, get a draft.',
      done: !!status.extensionUsed,
      action: { label: 'Get the extension', href: '#install' },
    },
    {
      id: 'first-draft',
      title: 'Generate your first draft',
      description: 'Open any LinkedIn, GitHub, or Wellfound profile and click the Riffly icon. Three variants in 15 seconds.',
      done: !!status.extensionUsed,
    },
  ];

  if (isPlus) {
    steps.push({
      id: 'spec',
      title: 'Add a job spec for fit-scoring',
      description: 'Riffly will live-score every profile you visit against your active spec.',
      done: !!status.firstSpec,
    });
    steps.push({
      id: 'search',
      title: 'Track your first LinkedIn search',
      description: 'Paste a search URL — Riffly auto-ranks results and surfaces top matches in your daily digest.',
      done: !!status.firstSearch,
    });
  }

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  if (completed >= total) return null; // all done — checklist self-dismisses

  function dismiss() {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
    } catch { /* ignore */ }
    setDismissed(true);
  }

  return (
    <section style={cardStyle}>
      <div style={headRowStyle}>
        <div>
          <div style={eyebrowStyle}>Get started</div>
          <div style={titleStyle}>{completed} of {total} done</div>
        </div>
        <button onClick={dismiss} style={dismissBtnStyle} title="Hide this checklist">
          Dismiss
        </button>
      </div>

      <div style={progressBarOuterStyle}>
        <div style={{ ...progressBarInnerStyle, width: `${(completed / total) * 100}%` }} />
      </div>

      <ol style={listStyle}>
        {steps.map((s) => (
          <li key={s.id} style={itemStyle(s.done)}>
            <div style={iconStyle(s.done)}>
              {s.done ? '✓' : ''}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={s.done ? titleDoneStyle : itemTitleStyle}>{s.title}</div>
              <div style={s.done ? descDoneStyle : itemDescStyle}>{s.description}</div>
            </div>
            {!s.done && s.action && (
              s.action.href ? (
                <a href={s.action.href} style={actionBtnStyle}>{s.action.label}</a>
              ) : (
                <button onClick={s.action.onClick} style={actionBtnStyle}>{s.action.label}</button>
              )
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- styles (matched to dashboard.tsx) ----------

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e5e7',
  borderRadius: 16,
  padding: 24,
  maxWidth: 640,
  margin: '0 auto 16px',
};

const headRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 14,
  gap: 10,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: '#666',
  marginBottom: 4,
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#111',
  letterSpacing: '-0.01em',
};

const dismissBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: '#888',
  border: '1px solid #e5e5e7',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
};

const progressBarOuterStyle: React.CSSProperties = {
  height: 4,
  background: '#f3f0e8',
  borderRadius: 2,
  overflow: 'hidden',
  marginBottom: 14,
};

const progressBarInnerStyle: React.CSSProperties = {
  height: '100%',
  background: '#111',
  transition: 'width 240ms ease',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const itemStyle = (done: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: 12,
  background: done ? '#fafaf7' : '#fff',
  border: '1px solid ' + (done ? '#e7e4dc' : '#ececec'),
  borderRadius: 10,
});

const iconStyle = (done: boolean): React.CSSProperties => ({
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: done ? '#1a7a48' : '#fff',
  border: '1.5px solid ' + (done ? '#1a7a48' : '#d6d2c7'),
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  marginTop: 1,
});

const itemTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#111',
  marginBottom: 3,
};

const titleDoneStyle: React.CSSProperties = {
  ...itemTitleStyle,
  color: '#666',
  textDecoration: 'line-through',
};

const itemDescStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: '#666',
  lineHeight: 1.5,
};

const descDoneStyle: React.CSSProperties = {
  ...itemDescStyle,
  color: '#999',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  flexShrink: 0,
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};
