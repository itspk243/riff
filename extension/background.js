// Riff service worker.
// Routes generation requests to the backend.
//
// Configuration is stored in chrome.storage.local:
//   riff_backend_url — full https URL of deployed backend (or http://localhost:3000 in dev)
//   riff_token       — Supabase JWT (optional in ALLOW_ANON dev mode)
//
// To set them quickly during dev, paste this into the extension's service worker console:
//   chrome.storage.local.set({ riff_backend_url: 'http://localhost:3000' })

// Production backend. Override only for local dev:
//   chrome.storage.local.set({ riff_backend_url: 'http://localhost:3000' })
const DEFAULT_BACKEND_URL = 'https://riff-sandy.vercel.app';

async function getBackendBase() {
  const { riff_backend_url } = await chrome.storage.local.get('riff_backend_url');
  return riff_backend_url || DEFAULT_BACKEND_URL;
}

async function getAuthToken() {
  const { riff_token } = await chrome.storage.local.get('riff_token');
  return riff_token || null;
}

const USE_STUB = false; // flip to true to bypass backend (offline UI testing)

async function callBackend(payload) {
  return apiCall('/api/generate', { method: 'POST', body: payload });
}

// Generic API caller — handles auth header, error mapping, and network failures
// the same way for /api/generate, /api/templates, /api/events.
async function apiCall(path, opts) {
  const base = await getBackendBase();
  const token = await getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return { ok: false, error: 'Network error — check connection.' };
  }

  let body;
  try { body = await res.json(); } catch { body = null; }

  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, error: 'Sign in to Riff to keep going.', needsAuth: true };
    }
    if (res.status === 402) {
      return { ok: false, error: (body && body.error) || 'Free limit hit. Upgrade for unlimited.', needsUpgrade: true };
    }
    return { ok: false, error: (body && body.error) || `Backend ${res.status}` };
  }
  return body;
}

function stubResponse(payload) {
  // Mock variants so the UI is testable end-to-end before backend is wired.
  const name = (payload.profile && payload.profile.name) || 'there';
  const firstName = name.split(' ')[0];
  const role = payload.profile && payload.profile.currentRole;
  const company = payload.profile && payload.profile.currentCompany;
  const headline = payload.profile && payload.profile.headline;

  const hookFromHeadline = headline ? headline.split(/[|•·-]/)[0].trim().slice(0, 80) : 'your work';
  const pitch = payload.pitch || '[your pitch]';

  return {
    ok: true,
    variants: [
      {
        type: 'cold_opener',
        text: `Hi ${firstName}, your work on ${hookFromHeadline} caught my attention — particularly given the angle on ${role || 'your current role'}. ${pitch} Curious if it'd be worth a 15-minute conversation this week?`
      },
      {
        type: 'follow_up',
        text: `${firstName} — circling back on the note from earlier this week. Still keen to hear your take on the ${role || 'work'} side, even if the timing isn't right. Worth a quick reply?`
      },
      {
        type: 'breakup',
        text: `Last note from me, ${firstName}. I'll stop here — but if the ${company || 'current'} chapter ever feels like the right time to look around, I'd love to be the first call. Either way, appreciate the read.`
      }
    ]
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  // Generation
  if (msg.type === 'RIFF_GENERATE') {
    (USE_STUB ? Promise.resolve(stubResponse(msg.payload)) : callBackend(msg.payload))
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  // /api/me — used by the popup on open to fetch plan, email, remaining quota
  // BEFORE any generation. Lets us render the plan badge + locked chips up
  // front instead of waiting for the user's first generation to learn the plan.
  if (msg.type === 'RIFF_ME') {
    apiCall('/api/me', { method: 'GET' }).then(sendResponse);
    return true;
  }

  // Saved templates
  if (msg.type === 'RIFF_TEMPLATES_LIST') {
    apiCall('/api/templates', { method: 'GET' }).then(sendResponse);
    return true;
  }
  if (msg.type === 'RIFF_TEMPLATES_CREATE') {
    apiCall('/api/templates', { method: 'POST', body: msg.payload }).then(sendResponse);
    return true;
  }
  if (msg.type === 'RIFF_TEMPLATES_DELETE') {
    apiCall(`/api/templates/${encodeURIComponent(msg.payload.id)}`, { method: 'DELETE' }).then(sendResponse);
    return true;
  }

  // Events (sent / replied tracking + follow-up detection)
  if (msg.type === 'RIFF_EVENTS_RECORD') {
    apiCall('/api/events', { method: 'POST', body: msg.payload }).then(sendResponse);
    return true;
  }
  if (msg.type === 'RIFF_EVENTS_FOR_CANDIDATE') {
    const url = msg.payload && msg.payload.candidate;
    apiCall(`/api/events?candidate=${encodeURIComponent(url || '')}`, { method: 'GET' }).then(sendResponse);
    return true;
  }
});
