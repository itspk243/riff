// Plus-tier dashboard panel for managing tracked LinkedIn searches and
// viewing the Daily Digest. Self-contained: fetches its own data, owns its
// own UI state. Added to dashboard.tsx as a single section.
//
// Behavior:
//   - Plus users: fetch saved searches + digest, can add/archive searches
//   - Free/Pro: locked card with an upgrade CTA (consistent with Active
//     Profile Assist gating elsewhere)
//
// Scanning is triggered by the extension when the user visits a saved-search
// URL. This panel just renders the existing scored events. It does NOT call
// the LLM directly.

import { useEffect, useState } from 'react';

type Plan = 'free' | 'pro' | 'plus' | 'team';

type Cadence = 'manual' | 'on_visit' | 'thrice_daily' | 'daily' | 'weekly';

interface SavedSearch {
  id: string;
  name: string;
  search_url: string;
  archived: boolean;
  scan_cadence?: Cadence;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
}

const CADENCE_LABEL: Record<Cadence, string> = {
  manual: 'Manual only',
  on_visit: 'Every visit',
  thrice_daily: '3× daily',
  daily: 'Daily',
  weekly: 'Weekly',
};

const CADENCE_INTERVAL_HRS: Record<Cadence, number> = {
  manual: Number.POSITIVE_INFINITY,
  on_visit: 0,
  thrice_daily: 8,
  daily: 24,
  weekly: 24 * 7,
};

interface DigestCandidate {
  candidate_url: string | null;
  candidate_name: string | null;
  score: number;
  reasoning: string | null;
  job_spec_id: string;
  scored_at: string;
}

interface DigestEntry {
  saved_search_id: string;
  saved_search_name: string;
  search_url: string;
  last_scanned_at: string | null;
  total_in_window: number;
  top: DigestCandidate[];
}

interface SearchesResponse {
  ok: boolean;
  searches?: SavedSearch[];
  locked?: boolean;
  maxSearches?: number;
  error?: string;
}

interface DigestResponse {
  ok: boolean;
  digest?: DigestEntry[];
  windowDays?: number;
  locked?: boolean;
}

interface Props {
  token: string | null;
  plan?: Plan;
}

export default function SavedSearchesPanel({ token, plan }: Props) {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [digest, setDigest] = useState<DigestEntry[] | null>(null);
  const [maxSearches, setMaxSearches] = useState<number>(10);
  const [locked, setLocked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formCadence, setFormCadence] = useState<Cadence>('manual');
  const [submitting, setSubmitting] = useState(false);
  const [savingCadenceId, setSavingCadenceId] = useState<string | null>(null);
  const [digestHour, setDigestHour] = useState<number>(8);
  const [savingDigestHour, setSavingDigestHour] = useState<boolean>(false);

  const isPlus = plan === 'plus' || plan === 'team';

  // Fetch on mount + when token changes.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [searchesRes, digestRes, prefsRes] = await Promise.all([
          fetch('/api/saved-searches', { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
            r.json() as Promise<SearchesResponse>
          ),
          fetch('/api/saved-searches/digest?days=7&top=5', {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json() as Promise<DigestResponse>),
          fetch('/api/preferences', { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
            r.json() as Promise<{ ok: boolean; digest_send_hour_utc?: number }>
          ),
        ]);
        if (cancelled) return;
        if (searchesRes.ok) {
          setSearches(searchesRes.searches || []);
          setMaxSearches(searchesRes.maxSearches || 10);
          setLocked(!!searchesRes.locked);
        } else {
          setError(searchesRes.error || 'Failed to load saved searches');
        }
        if (digestRes.ok) {
          setDigest(digestRes.digest || []);
        }
        if (prefsRes.ok && typeof prefsRes.digest_send_hour_utc === 'number') {
          setDigestHour(prefsRes.digest_send_hour_utc);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function updateDigestHour(hour: number) {
    if (!token) return;
    const previous = digestHour;
    setDigestHour(hour); // optimistic
    setSavingDigestHour(true);
    try {
      const res = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ digest_send_hour_utc: hour }),
      });
      const data = await res.json();
      if (!data.ok) {
        setDigestHour(previous);
        setError(data.error || 'Failed to save digest time');
      }
    } catch (e: any) {
      setDigestHour(previous);
      setError(e.message || 'Network error');
    } finally {
      setSavingDigestHour(false);
    }
  }

  async function addSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!formName.trim() || !formUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formName.trim(),
          search_url: formUrl.trim(),
          scan_cadence: formCadence,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to add saved search');
      } else {
        setSearches((prev) => (prev ? [data.search, ...prev] : [data.search]));
        setFormName('');
        setFormUrl('');
        setFormCadence('manual');
        setShowForm(false);
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateCadence(id: string, cadence: Cadence) {
    if (!token) return;
    setSavingCadenceId(id);
    setError(null);
    // Optimistic update.
    setSearches((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, scan_cadence: cadence } : s)) : prev
    );
    try {
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scan_cadence: cadence }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to update cadence');
      } else if (data.search) {
        setSearches((prev) =>
          prev ? prev.map((s) => (s.id === id ? { ...s, ...data.search } : s)) : prev
        );
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSavingCadenceId(null);
    }
  }

  async function archive(id: string) {
    if (!token) return;
    if (!confirm('Archive this saved search? Past digest results stay visible.')) return;
    try {
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setSearches((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        setDigest((prev) => (prev ? prev.filter((d) => d.saved_search_id !== id) : prev));
      }
    } catch {
      // best-effort; user can refresh
    }
  }

  // -------- locked card (Free / Pro) --------
  if (locked || (!isPlus && !loading)) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Saved-Search Daily Digest</div>
        <div style={lockedCardStyle}>
          <div style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
            Track up to 10 LinkedIn searches and let Riffly auto-rank candidates
            against your active job specs. Top matches surface here every day.
          </div>
          <div style={{ fontSize: 13, color: '#888' }}>
            Plus tier · $19.99/mo · upgrade in the Subscription section above.
          </div>
        </div>
      </section>
    );
  }

  // -------- loading --------
  if (loading) {
    return (
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Saved-Search Daily Digest</div>
        <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>
      </section>
    );
  }

  const atCap = (searches?.length || 0) >= maxSearches;

  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={sectionTitleStyle}>Saved-Search Daily Digest</div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {(searches?.length || 0)} / {maxSearches} active
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#666', margin: '4px 0 14px', lineHeight: 1.55 }}>
        Add the URL of any LinkedIn people-search you want to track. When the
        Riffly extension is open on that search, it scrapes visible profile
        cards and scores them against your active job specs. Top matches
        appear below — refreshed every time you re-visit the search.
      </p>

      {/* Per-user email-digest send time. Stored in users.digest_send_hour_utc;
          cron filters recipients by current UTC hour so the cron must invoke
          hourly (Vercel Hobby caps at daily — wire an external pinger or
          upgrade for full coverage). */}
      <div id="digest-prefs" style={prefsRowStyle}>
        <span style={{ fontSize: 12.5, color: '#444' }}>
          Email me my digest at
        </span>
        <select
          value={digestHour}
          onChange={(e) => updateDigestHour(parseInt(e.target.value, 10))}
          disabled={savingDigestHour}
          style={hourSelectStyle}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{formatHour(h)}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>UTC</span>
        <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>
          ({localTimeForUtcHour(digestHour)} your time)
        </span>
      </div>

      {error && (
        <div style={errorBoxStyle}>{error}</div>
      )}

      {/* List of saved searches with their digest cards */}
      {(!searches || searches.length === 0) ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 14, color: '#444', marginBottom: 6 }}>
            No saved searches yet.
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Add the first one to start ranking candidates automatically.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {searches.map((s) => {
            const entry = digest?.find((d) => d.saved_search_id === s.id);
            return (
              <div key={s.id} style={searchCardStyle}>
                <div style={searchHeadStyle}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={searchNameStyle}>{s.name}</div>
                    <a href={s.search_url} target="_blank" rel="noopener noreferrer" style={searchUrlStyle}>
                      {truncateUrl(s.search_url)}
                    </a>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <a href={s.search_url} target="_blank" rel="noopener noreferrer" style={smallBtnStyle}>
                      Open
                    </a>
                    <button onClick={() => archive(s.id)} style={smallGhostBtnStyle} title="Archive this search">
                      Archive
                    </button>
                  </div>
                </div>
                <div style={metaRowStyle}>
                  <span>
                    Last scan: <strong>{formatRelative(s.last_scanned_at)}</strong>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Cadence:
                    <select
                      value={s.scan_cadence || 'manual'}
                      onChange={(e) => updateCadence(s.id, e.target.value as Cadence)}
                      disabled={savingCadenceId === s.id}
                      style={inlineSelectStyle}
                    >
                      {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                        <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                      ))}
                    </select>
                  </span>
                  {nextScanLabel(s) && (
                    <span>Next: <strong>{nextScanLabel(s)}</strong></span>
                  )}
                  {entry && (
                    <span>
                      Top {entry.top.length} of {entry.total_in_window} scored in last 7 days
                    </span>
                  )}
                </div>

                {entry && entry.top.length > 0 ? (
                  <ol style={topListStyle}>
                    {entry.top.map((c, i) => (
                      <li key={(c.candidate_url || c.candidate_name || '') + i} style={topItemStyle}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={scorePillStyle(c.score)}>{c.score}</span>
                          {c.candidate_url ? (
                            <a href={c.candidate_url} target="_blank" rel="noopener noreferrer" style={candidateNameStyle}>
                              {c.candidate_name || 'Unnamed candidate'}
                            </a>
                          ) : (
                            <span style={candidateNameStyle}>{c.candidate_name || 'Unnamed candidate'}</span>
                          )}
                        </div>
                        {c.reasoning && (
                          <div style={reasoningStyle}>{c.reasoning}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div style={emptyDigestStyle}>
                    No matches scored yet. Open the search in the extension to scan it.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add-search form / button */}
      <div style={{ marginTop: 18 }}>
        {!showForm && !atCap && (
          <button onClick={() => setShowForm(true)} style={primaryBtnStyle}>
            + Add saved search
          </button>
        )}
        {atCap && !showForm && (
          <div style={{ fontSize: 12, color: '#888' }}>
            You're at the cap of {maxSearches} active searches. Archive one to add another.
          </div>
        )}
        {showForm && (
          <form onSubmit={addSearch} style={formStyle}>
            <label style={labelStyle}>
              Name
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Bay Area staff backend, payments infra"
                maxLength={80}
                required
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              LinkedIn search URL
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
                pattern="https://.*linkedin\.com/.*"
                required
                style={inputStyle}
              />
              <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
                Tip: easier to add searches directly from the Riffly extension while you're on a LinkedIn search page.
              </span>
            </label>
            <label style={labelStyle}>
              Scan cadence
              <select
                value={formCadence}
                onChange={(e) => setFormCadence(e.target.value as Cadence)}
                style={inputStyle}
              >
                {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
                How often the extension is allowed to auto-scan this search. You can always force a scan from the dashboard.
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submitting} style={primaryBtnStyle}>
                {submitting ? 'Adding…' : 'Add'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setFormName(''); setFormUrl(''); setError(null); }} style={ghostBtnStyle}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ---------- helpers ----------

function truncateUrl(url: string, max = 70): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + '…';
}

function formatHour(h: number): string {
  // 0 → "12 AM", 8 → "8 AM", 13 → "1 PM"
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// Display the local time equivalent of a UTC hour so users can pick
// without doing math. Uses the browser's timezone via Intl.
function localTimeForUtcHour(utcHour: number): string {
  try {
    const today = new Date();
    today.setUTCHours(utcHour, 0, 0, 0);
    const fmt = new Intl.DateTimeFormat([], {
      hour: 'numeric',
      hour12: true,
      timeZoneName: 'short',
    });
    return fmt.format(today); // e.g. "4 AM EDT"
  } catch {
    return '—';
  }
}

function nextScanLabel(s: SavedSearch): string | null {
  const cadence = (s.scan_cadence || 'manual') as Cadence;
  if (cadence === 'manual' || cadence === 'on_visit') return null;
  const intervalMs = CADENCE_INTERVAL_HRS[cadence] * 60 * 60 * 1000;
  const last = s.last_scanned_at ? Date.parse(s.last_scanned_at) : 0;
  if (!last) return 'now';
  const next = last + intervalMs;
  const ms = next - Date.now();
  if (ms <= 0) return 'now';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.ceil(min / 60);
  if (hr < 24) return `in ${hr} hr`;
  const d = Math.ceil(hr / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'never';
  const ms = Date.now() - t;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------- styles (matched to dashboard.tsx style language) ----------

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

const emptyDigestStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  fontStyle: 'italic',
  padding: '10px 0 2px',
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

const searchCardStyle: React.CSSProperties = {
  border: '1px solid #ececec',
  borderRadius: 12,
  padding: 16,
  background: '#fff',
};

const searchHeadStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginBottom: 6,
};

const searchNameStyle: React.CSSProperties = {
  fontSize: 14.5,
  fontWeight: 600,
  color: '#111',
  lineHeight: 1.3,
};

const searchUrlStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 2,
  fontSize: 11.5,
  color: '#888',
  textDecoration: 'none',
  wordBreak: 'break-all',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  fontSize: 11.5,
  color: '#888',
  margin: '4px 0 12px',
};

const topListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const topItemStyle: React.CSSProperties = {
  padding: '8px 0',
  borderTop: '1px solid #f3f2ef',
};

const candidateNameStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 500,
  color: '#111',
  textDecoration: 'none',
};

const reasoningStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12.5,
  color: '#555',
  lineHeight: 1.5,
};

function scorePillStyle(score: number): React.CSSProperties {
  // 0-39 muted, 40-69 amber, 70-100 green
  let bg = '#f3f0e8', color = '#666';
  if (score >= 70) { bg = '#e7f4ec'; color = '#1a7a48'; }
  else if (score >= 40) { bg = '#fff8eb'; color = '#6b4a14'; }
  return {
    display: 'inline-block',
    minWidth: 32,
    textAlign: 'center',
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 4,
  };
}

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

const prefsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  background: '#fafaf7',
  border: '1px solid #ececec',
  borderRadius: 8,
  marginBottom: 16,
  flexWrap: 'wrap',
};

const hourSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #ddd',
  borderRadius: 5,
  fontSize: 12.5,
  fontFamily: 'inherit',
  background: '#fff',
  cursor: 'pointer',
};

const inlineSelectStyle: React.CSSProperties = {
  padding: '2px 6px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 11.5,
  fontFamily: 'inherit',
  background: '#fff',
  cursor: 'pointer',
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

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: '#111',
  color: '#fff',
  borderRadius: 5,
  fontSize: 11.5,
  textDecoration: 'none',
  fontWeight: 500,
};

const smallGhostBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: '#888',
  border: '1px solid #ddd',
  borderRadius: 5,
  fontSize: 11.5,
  cursor: 'pointer',
};
