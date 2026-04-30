// Pro+ dashboard panel — train Riffly on the user's writing samples so
// generated drafts match their voice. Computes the fingerprint client-side
// (so we never persist raw messages), POSTs the derived stats to
// /api/voice-fingerprint, then renders the fingerprint card afterward.
//
// Free / pro / plus / team — actually it's "any paid plan" because the
// underlying API gates by hasUnlimitedDrafts (pro/plus/team). Free users
// see a locked card.

import { useEffect, useState } from 'react';
import { computeFingerprint, type VoiceFingerprint } from '../lib/voice-fingerprint';

type Plan = 'free' | 'pro' | 'plus' | 'team';

interface Props {
  token: string | null;
  plan?: Plan;
}

interface ServerFingerprint extends VoiceFingerprint {
  computed_at?: string;
  updated_at?: string;
}

export default function VoiceFingerprintPanel({ token, plan }: Props) {
  const [fp, setFp] = useState<ServerFingerprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [samples, setSamples] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isPaid = plan === 'pro' || plan === 'plus' || plan === 'team';

  useEffect(() => {
    if (!token || !isPaid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/voice-fingerprint', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && data.ok) setFp(data.fingerprint);
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, isPaid]);

  // Locked state for free users
  if (!isPaid && !loading) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Voice fingerprint · drafts in your dialect</div>
        <div style={lockedCardStyle}>
          <div style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
            Train Riffly on 5–10 of your best LinkedIn messages. Riffly learns
            your cadence, sentence length, and signoff style — drafts come out
            sounding like you wrote them.
          </div>
          <div style={{ fontSize: 13, color: '#888' }}>
            Pro feature · upgrade in the Subscription section above.
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Voice fingerprint · drafts in your dialect</div>
        <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>
      </section>
    );
  }

  // ---- form (no fingerprint yet OR retraining) ----
  function parseSamples(): string[] {
    return samples
      .split(/\n\s*\n/) // blank-line separator
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Live preview — compute the fingerprint as the user types, no API call.
  const previewSamples = parseSamples();
  const preview = previewSamples.length >= 3 ? computeFingerprint(previewSamples) : null;

  async function save() {
    if (!token) return;
    const list = parseSamples();
    if (list.length < 3) {
      setError('Paste at least 3 messages, separated by blank lines.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/voice-fingerprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ samples: list }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to save fingerprint');
      } else {
        setFp(data.fingerprint);
        setShowForm(false);
        setSamples('');
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function clearFingerprint() {
    if (!token) return;
    if (!confirm('Clear your voice fingerprint? Riffly will go back to the default style.')) return;
    try {
      const res = await fetch('/api/voice-fingerprint', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setFp(null);
      }
    } catch { /* best-effort */ }
  }

  return (
    <section style={sectionStyle} id="voice-fingerprint">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={sectionTitleStyle}>Voice fingerprint · drafts in your dialect</div>
        {fp && (
          <button onClick={clearFingerprint} style={smallGhostBtnStyle} title="Reset to default style">
            Clear
          </button>
        )}
      </div>

      {fp && !showForm ? (
        <>
          <p style={{ fontSize: 13, color: '#666', margin: '4px 0 14px', lineHeight: 1.55 }}>
            Riffly is matching your style. Trained on <strong>{fp.sample_count}</strong> sample{fp.sample_count === 1 ? '' : 's'}.
          </p>
          <div style={statsGridStyle}>
            <Stat label="Avg sentence" value={`${fp.avg_sentence_words} words`} />
            <Stat label="Register" value={formality(fp.formality_score)} />
            <Stat label="Contractions" value={`${Math.round(fp.contraction_rate * 100)}%`} />
            <Stat label="Asks questions" value={`${Math.round(fp.question_rate * 100)}%`} />
          </div>
          {fp.common_signoffs && fp.common_signoffs.length > 0 && (
            <div style={chipRowStyle}>
              <span style={chipLabelStyle}>Signoffs</span>
              {fp.common_signoffs.slice(0, 3).map((s, i) => (
                <span key={i} style={chipStyle}>{s}</span>
              ))}
            </div>
          )}
          {fp.common_openers && fp.common_openers.length > 0 && (
            <div style={chipRowStyle}>
              <span style={chipLabelStyle}>Openers</span>
              {fp.common_openers.slice(0, 3).map((s, i) => (
                <span key={i} style={chipStyle}>{s}</span>
              ))}
            </div>
          )}
          <button onClick={() => setShowForm(true)} style={primaryBtnStyle}>
            Retrain with new samples
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: '#666', margin: '4px 0 14px', lineHeight: 1.55 }}>
            Paste 5–10 of your best LinkedIn messages or sent emails (one per blank-line block). We compute style stats on your machine, then store the stats only — never the messages.
          </p>
          <textarea
            value={samples}
            onChange={(e) => setSamples(e.target.value)}
            placeholder={`Hey Maya — saw your post on…\n\nQuick one — your team's working on…\n\nAlex, came across the talk you gave at…`}
            rows={10}
            style={textareaStyle}
          />
          {preview && (
            <div style={previewBoxStyle}>
              <div style={previewLabelStyle}>Live preview ({preview.sample_count} samples)</div>
              <div style={statsGridStyle}>
                <Stat label="Avg sentence" value={`${preview.avg_sentence_words} words`} />
                <Stat label="Register" value={formality(preview.formality_score)} />
                <Stat label="Contractions" value={`${Math.round(preview.contraction_rate * 100)}%`} />
                <Stat label="Asks questions" value={`${Math.round(preview.question_rate * 100)}%`} />
              </div>
            </div>
          )}
          {error && <div style={errorBoxStyle}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={submitting} style={primaryBtnStyle}>
              {submitting ? 'Saving…' : 'Save fingerprint'}
            </button>
            {fp && (
              <button onClick={() => { setShowForm(false); setSamples(''); setError(null); }} style={ghostBtnStyle}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

function formality(score: number): string {
  if (score >= 0.7) return 'Formal';
  if (score >= 0.5) return 'Neutral';
  if (score >= 0.3) return 'Casual';
  return 'Very casual';
}

// ---------- styles ----------

const sectionStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e5e7',
  borderRadius: 16,
  padding: 28,
  maxWidth: 640,
  margin: '0 auto 16px',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
  fontWeight: 700, color: '#666', marginBottom: 14,
};
const lockedCardStyle: React.CSSProperties = {
  padding: 16, background: '#faf9f6', border: '1px dashed #d6d2c7', borderRadius: 10,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: 12,
  border: '1px solid #ddd', borderRadius: 8, fontSize: 13.5,
  fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical', minHeight: 200,
};
const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 10, margin: '12px 0 16px',
};
const statCardStyle: React.CSSProperties = {
  padding: '10px 12px', background: '#fafaf7',
  border: '1px solid #ececec', borderRadius: 8,
};
const statLabelStyle: React.CSSProperties = {
  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: '#888', fontWeight: 700, marginBottom: 4,
};
const statValueStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: '#111',
};
const chipRowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8,
};
const chipLabelStyle: React.CSSProperties = {
  fontSize: 11, color: '#888', textTransform: 'uppercase',
  letterSpacing: '0.04em', fontWeight: 700, marginRight: 4,
};
const chipStyle: React.CSSProperties = {
  padding: '3px 8px', background: '#fafaf7', border: '1px solid #ececec',
  borderRadius: 4, fontSize: 12, color: '#444',
};
const previewBoxStyle: React.CSSProperties = {
  marginTop: 12, padding: 12, background: '#faf9f6',
  border: '1px solid #e7e4dc', borderRadius: 8,
};
const previewLabelStyle: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  fontWeight: 700, color: '#888', marginBottom: 6,
};
const errorBoxStyle: React.CSSProperties = {
  padding: 10, background: '#fdf6f3', border: '1px solid #e8d6cf',
  borderRadius: 6, color: '#8b3015', fontSize: 13, marginTop: 12,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px', background: '#111', color: '#fff',
  border: '1px solid #111', borderRadius: 6, fontSize: 13,
  fontWeight: 500, cursor: 'pointer',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '9px 16px', background: 'transparent', color: '#111',
  border: '1px solid #ddd', borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
const smallGhostBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: 'transparent', color: '#888',
  border: '1px solid #ddd', borderRadius: 5, fontSize: 11.5, cursor: 'pointer',
};
