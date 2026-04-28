// Riff service worker.
// Routes generation requests to the backend.
//
// Configuration is stored in chrome.storage.local:
//   riff_backend_url — full https URL of deployed backend (or http://localhost:3000 in dev)
//   riff_token       — Supabase JWT (optional in ALLOW_ANON dev mode)
//
// To set them quickly during dev, paste this into the extension's service worker console:
//   chrome.storage.local.set({ riff_backend_url: 'http://localhost:3000' })

async function getBackendBase() {
  const { riff_backend_url } = await chrome.storage.local.get('riff_backend_url');
  return riff_backend_url || 'https://riff-backend.example.com';
}

async function getAuthToken() {
  const { riff_token } = await chrome.storage.local.get('riff_token');
  return riff_token || null;
}

const USE_STUB = false; // flip to true to bypass backend (offline UI testing)

async function callBackend(payload) {
  const base = await getBackendBase();
  const token = await getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { ok: false, error: 'Network error — check connection or backend URL.' };
  }

  let body;
  try { body = await res.json(); } catch { body = null; }

  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, error: 'Sign in to Riff to keep generating.', needsAuth: true };
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
  if (msg && msg.type === 'RIFF_GENERATE') {
    (USE_STUB ? Promise.resolve(stubResponse(msg.payload)) : callBackend(msg.payload))
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // async
  }
});
