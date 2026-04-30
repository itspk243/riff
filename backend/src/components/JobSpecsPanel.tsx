// Plus-tier dashboard panel for managing job specs from the web (not just
// from the extension popup). Powers the "Active Profile Assist" feature —
// each spec is a free-text description of what the user is hiring for, and
// Riffly scores every profile they visit against the active specs.
//
// Free/Pro users see a locked card with an upgrade CTA so the dashboard
// renders cleanly without API errors.

import { useEffect, useState } from 'react';

type Plan = 'free' | 'pro' | 'plus' | 'team';

interface JobSpec {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

interface SpecsResponse {
  ok: boolean;
  specs?: JobSpec[];
  locked?: boolean;
  maxActiveSpecs?: number;
  error?: string;
}

interface Props {
  token: string | null;
  plan?: Plan;
}

export default function JobSpecsPanel({ token, plan }: Props) {
  const [specs, setSpecs] = useState<JobSpec[] | null>(null);
  const [maxSpecs, setMaxSpecs] = useState<number>(5);
  const [locked, setLocked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formDesc, setFormDesc] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isPlus = plan === 'plus' || plan === 'team';

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/job-specs', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as SpecsResponse;
        if (cancelled) return;
        if (data.ok) {
          setSpecs(data.specs || []);
          setMaxSpecs(data.maxActiveSpecs || 5);
          setLocked(!!data.locked);
        } else {
          setError(data.error || 'Failed to load job specs');
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function addSpec(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!formName.trim() || !formDesc.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/job-specs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: formName.trim(), description: formDesc.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to save spec');
      } else {
        setSpecs((prev) => (prev ? [data.spec, ...prev] : [data.spec]));
        setFormName('');
        setFormDesc('');
        setShowForm(false);
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function archive(id: string) {
    if (!token) return;
    if (!confirm('Archive this job spec? Riffly will stop scoring profiles against it.')) return;
    try {
      const res = await fetch(`/api/job-specs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setSpecs((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      }
    } catch {
      /* best-effort */
    }
  }

  // Locked card for Free / Pro
  if (locked || (!isPlus && !loading)) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Job specs · Active Profile Assist</div>
        <div style={lockedCardStyle}>
          <div style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
            Each job spec is a description of what you're hiring for. Riffly
            scores every LinkedIn / GitHub / Wellfound profile you visit
            against your active specs in real time.
          </div>
          <div style={{ fontSize: 13, color: '#888' }}>
            Plus tier · $25/mo (600 drafts/month) · upgrade in the Subscription section above.
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Job specs · Active Profile Assist</div>
        <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>
      </section>
    );
  }

  const atCap = (specs?.length || 0) >= maxSpecs;

  return (
    <section style={sectionStyle} id="job-specs">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={sectionTitleStyle}>Job specs · Active Profile Assist</div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {(specs?.length || 0)} / {maxSpecs} active
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#666', margin: '4px 0 14px', lineHeight: 1.55 }}>
        Each spec is a free-text description of what you're hiring for. Riffly
        live-scores every candidate profile against your active specs and
        flags strong matches.
      </p>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {!specs || specs.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 14, color: '#444', marginBottom: 6 }}>No job specs yet.</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Add the first one to start fit-scoring candidates automatically.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {specs.map((s) => (
            <div key={s.id} style={specCardStyle}>
              <div style={specHeadStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={specNameStyle}>{s.name}</div>
                  <div style={specDescStyle}>{s.description}</div>
                </div>
                <button
                  onClick={() => archive(s.id)}
                  style={smallGhostBtnStyle}
                  title="Archive this spec"
                >
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {!showForm && !atCap && (
          <button onClick={() => setShowForm(true)} style={primaryBtnStyle}>
            + Add job spec
          </button>
        )}
        {atCap && !showForm && (
          <div style={{ fontSize: 12, color: '#888' }}>
            You're at the cap of {maxSpecs} active specs. Archive one to add another.
          </div>
        )}
        {showForm && (
          <form onSubmit={addSpec} style={formStyle}>
            <label style={labelStyle}>
              Spec name
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder='e.g. "Staff backend, payments infra"'
                maxLength={80}
                required
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Description
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="What you're hiring for. Stack, seniority, comp band, location, must-haves, nice-to-haves. Plain language is fine."
                rows={4}
                maxLength={5000}
                required
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
                {formDesc.length} / 5000 characters
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submitting} style={primaryBtnStyle}>
                {submitting ? 'Saving…' : 'Save spec'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormName('');
                  setFormDesc('');
                  setError(null);
                }}
                style={ghostBtnStyle}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ---------- styles (matched to SavedSearchesPanel) ----------

const sectionStyle: React.CSSProperties = {
  // Flat subsection — dashboard provides the outer card.
  background: 'transparent',
  padding: 0,
  marginBottom: 28,
  paddingBottom: 24,
  borderBottom: '1px solid #f0f0f2',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 700,
  color: '#666',
  marginBottom: 14,
};

const lockedCardStyle: React.CSSProperties = {
  padding: 16,
  background: '#faf9f6',
  border: '1px dashed #d6d2c7',
  borderRadius: 10,
};

const emptyStyle: React.CSSProperties = {
  padding: 18,
  background: '#fafaf7',
  border: '1px dashed #e5e5e7',
  borderRadius: 10,
  textAlign: 'center',
};

const errorBoxStyle: React.CSSProperties = {
  padding: 10,
  background: '#fdf6f3',
  border: '1px solid #e8d6cf',
  borderRadius: 6,
  color: '#8b3015',
  fontSize: 13,
  marginBottom: 14,
};

const specCardStyle: React.CSSProperties = {
  border: '1px solid #ececec',
  borderRadius: 12,
  padding: 14,
  background: '#fff',
};

const specHeadStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
};

const specNameStyle: React.CSSProperties = {
  fontSize: 14.5,
  fontWeight: 600,
  color: '#111',
  marginBottom: 4,
};

const specDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#555',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  background: '#fafafa',
  border: '1px solid #ececec',
  borderRadius: 10,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#666',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  background: '#111',
  color: '#fff',
  border: '1px solid #111',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  background: 'transparent',
  color: '#111',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
};

const smallGhostBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: '#888',
  border: '1px solid #ddd',
  borderRadius: 5,
  fontSize: 11.5,
  cursor: 'pointer',
  flexShrink: 0,
};
