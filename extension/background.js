// Riffly service worker.
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
const DEFAULT_BACKEND_URL = 'https://rifflylabs.com';

// PostHog public project key. Replace with the real key from
// posthog.com/project/settings/general before publishing. Public keys
// are designed to live on the client — no risk in committing.
// If left as the placeholder, all telemetry calls become no-ops.
const POSTHOG_KEY = 'phc_qGNvqYvTcMpLhKikzCmckAetNEKX9dLRv6YJEDXpR3h7';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Generate or retrieve a stable anonymous distinct_id for this install.
// PostHog uses this to stitch events across sessions. We generate once
// per extension install and stick with it for the lifetime of the
// install. Once the user signs in, we also send their riff user_id as
// the $set on each event so the install-level id can be aliased server-
// side to the authed account.
async function getInstallId() {
  const { riff_install_id } = await chrome.storage.local.get('riff_install_id');
  if (riff_install_id) return riff_install_id;
  // crypto.randomUUID is available in MV3 service workers.
  const id = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : `riff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await chrome.storage.local.set({ riff_install_id: id });
  return id;
}

// Fire-and-forget PostHog event. Never throws. Never blocks. The MV3
// CSP forbids loading their JS lib but we can POST directly to the
// /capture/ endpoint from the service worker. One event = one fetch.
async function riffTrackExt(event, properties) {
  if (!POSTHOG_KEY || POSTHOG_KEY === 'YOUR_POSTHOG_KEY_HERE') return;
  try {
    const distinct_id = await getInstallId();
    const { riff_user_id } = await chrome.storage.local.get('riff_user_id');
    const payload = {
      api_key: POSTHOG_KEY,
      event,
      distinct_id,
      properties: {
        $current_url: 'extension://riffly',
        $set: riff_user_id ? { riff_user_id } : undefined,
        ...(properties || {}),
      },
      timestamp: new Date().toISOString(),
    };
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch { /* analytics is never allowed to throw or log noise */ }
}

// Helper for "first time only" events. Stores a flag in chrome.storage
// after the first call so we never double-count installs / activations.
async function riffTrackOnce(flagName, event, properties) {
  const { [flagName]: already } = await chrome.storage.local.get(flagName);
  if (already) return;
  await chrome.storage.local.set({ [flagName]: true });
  await riffTrackExt(event, properties);
}

async function getBackendBase() {
  const { riff_backend_url } = await chrome.storage.local.get('riff_backend_url');
  return riff_backend_url || DEFAULT_BACKEND_URL;
}

async function getAuthToken() {
  const { riff_token } = await chrome.storage.local.get('riff_token');
  return riff_token || null;
}

async function getRefreshToken() {
  const { riff_refresh } = await chrome.storage.local.get('riff_refresh');
  return riff_refresh || null;
}

// Decode the JWT exp claim without verifying signature. Returns Unix seconds,
// or 0 if anything goes wrong.
function jwtExp(jwt) {
  try {
    const payload = JSON.parse(
      atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.exp || 0;
  } catch {
    return 0;
  }
}

// Mint a new access_token using the stored refresh_token. Updates storage on
// success, returns the new access token (or null on failure).
//
// We serialize concurrent refresh attempts via _refreshPromise — if multiple
// API calls discover the token is expired at the same time, they all wait on
// a single refresh round-trip instead of blowing up the rate limit.
let _refreshPromise = null;
async function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const refresh = await getRefreshToken();
      if (!refresh) return null;
      const base = await getBackendBase();
      const r = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      const j = await r.json();
      if (!j.ok || !j.access_token) {
        // Refresh token rejected — clear it so the popup nudges to sign in.
        if (j.needsReauth) {
          await chrome.storage.local.set({ riff_token: null, riff_refresh: null });
        }
        return null;
      }
      const newAccess = j.access_token;
      const newRefresh = j.refresh_token || refresh;
      await chrome.storage.local.set({
        riff_token: newAccess,
        riff_refresh: newRefresh,
      });
      return newAccess;
    } catch (e) {
      console.error('refresh failed', e);
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

// Get a usable access token: returns the cached one if it's still valid for
// at least 60s, otherwise refreshes it. Falls back to the cached token if
// refresh fails (so legacy bare-JWT users — no refresh_token — still work).
async function getValidAccessToken() {
  const access = await getAuthToken();
  if (!access) return null;
  const exp = jwtExp(access);
  const expiresInMs = exp * 1000 - Date.now();
  if (expiresInMs > 60_000) return access; // still good for >1 min
  const refresh = await getRefreshToken();
  if (!refresh) return access; // legacy mode — best effort, will 401 if expired
  return (await refreshAccessToken()) || access;
}

// ---------- Saved-search overdue badge ----------
//
// Plus tier: when a tracked LinkedIn search is past its scan cadence, surface
// it on the action icon as a small number badge ("3" → 3 searches need
// attention). Click → popup opens (existing behavior). When user is on the
// matching LinkedIn URL, the popup auto-fires a scan. Either way, the badge
// closes the loop without relying on email.
//
// Cadence intervals — must match backend CADENCE_INTERVAL_MS in
// /api/saved-searches/scan.ts.
const CADENCE_MS = {
  manual: Number.POSITIVE_INFINITY,   // never reminds — user opt-out
  on_visit: Number.POSITIVE_INFINITY, // visit triggers it; nothing to remind
  thrice_daily: 8 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

async function computeOverdueAndSetBadge() {
  try {
    const me = await apiCall('/api/me', { method: 'GET' });
    if (!me || !me.ok) {
      // Not signed in or backend unreachable — clear badge silently.
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    if (me.plan !== 'plus' && me.plan !== 'team') {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const saved = await apiCall('/api/saved-searches', { method: 'GET' });
    if (!saved || !saved.ok || !Array.isArray(saved.searches)) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    let overdue = 0;
    for (const s of saved.searches) {
      const cadence = s.scan_cadence || 'manual';
      const interval = CADENCE_MS[cadence];
      if (!isFinite(interval)) continue;
      const last = s.last_scanned_at ? new Date(s.last_scanned_at).getTime() : 0;
      const elapsed = Date.now() - last;
      if (elapsed >= interval) overdue++;
    }
    if (overdue > 0) {
      await chrome.action.setBadgeText({ text: String(overdue) });
      await chrome.action.setBadgeBackgroundColor({ color: '#b14a1a' }); // riffly accent
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // Best-effort; keep the previous badge (or none) on error.
  }
}

// Alarm-driven hourly refresh + on-startup refresh + surface-mode wiring.
//
// Surface mode (popup vs side-panel) is user-selectable in the footer of
// popup.html. The selection is stored at chrome.storage.local.riff_surface_mode
// = 'popup' | 'sidebar' (default 'sidebar'). On install/startup we re-assert
// the chosen behavior so it survives Chrome restarts.
//
//   sidebar mode: action.setPopup('') + sidePanel.setPanelBehavior({open:true})
//                 → icon click toggles the persistent side panel
//   popup mode:   action.setPopup('popup.html') + sidePanel.setPanelBehavior({open:false})
//                 → icon click opens classic transient popup
//
// The same popup.html/popup.js serves both surfaces — popup.css adapts the
// width based on what the script detects at load time.

async function applySurfaceMode() {
  const { riff_surface_mode } = await chrome.storage.local.get('riff_surface_mode');
  const mode = riff_surface_mode === 'popup' ? 'popup' : 'sidebar';
  try {
    if (mode === 'popup') {
      await chrome.action.setPopup({ popup: 'popup.html' });
      if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      }
    } else {
      // Empty popup string disables the popup so the icon click falls through
      // to whatever sidePanel.setPanelBehavior decided (open the panel).
      await chrome.action.setPopup({ popup: '' });
      if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    }
  } catch (e) {
    console.warn('applySurfaceMode failed:', e);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('riff_overdue_check', { periodInMinutes: 60, delayInMinutes: 1 });
  applySurfaceMode();
  // Funnel: track each lifetime first-install (not updates / browser_update).
  if (details && details.reason === 'install') {
    riffTrackOnce('riff_telemetry_first_install', 'ext_first_install', {
      version: chrome.runtime.getManifest().version,
    });
  }
});
chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create('riff_overdue_check', { periodInMinutes: 60, delayInMinutes: 1 });
  computeOverdueAndSetBadge();
  applySurfaceMode();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'riff_overdue_check') computeOverdueAndSetBadge();
});

// ---------- SPA navigation broadcaster ----------
//
// LinkedIn / Wellfound / GitHub all use client-side routing. Clicking from
// one profile to another doesn't trigger a full page load, so the popup's
// initial extract becomes stale. We listen for any URL change on a supported
// surface and broadcast a RIFF_PROFILE_NAV runtime message; the popup/sidebar
// listens for it and re-extracts. In popup mode this is a no-op (popup is
// closed on tab switch); in sidebar mode it's the whole point — the panel
// auto-updates as the recruiter clicks through profiles.
const PROFILE_URL_RE = new RegExp(
  '^https://(' +
    'www\\.linkedin\\.com/(in|sales/lead|talent/profile|search/results)/' +
    '|github\\.com/[^/?#]+/?(?:[?#].*)?$' +
    '|(?:www\\.)?wellfound\\.com/(?:u|profile|p)/' +
    '|angel\\.co/u/' +
  ')'
);

function broadcastProfileNav(tabId, url) {
  // Best-effort fan-out. Any surface (popup, side-panel, or both) that has
  // popup.js loaded receives this and re-extracts. We catch errors because
  // sendMessage rejects when no listeners are subscribed.
  try {
    chrome.runtime.sendMessage(
      { type: 'RIFF_PROFILE_NAV', payload: { tabId, url } },
      () => { void chrome.runtime.lastError; }
    );
  } catch {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only fire when the URL itself changed (covers pushState SPA nav) and
  // only for supported profile surfaces.
  if (!changeInfo.url) return;
  if (!PROFILE_URL_RE.test(changeInfo.url)) return;
  if (!tab || !tab.active) return; // Avoid waking the panel for background tabs.
  broadcastProfileNav(tabId, changeInfo.url);
});

// User switched tabs — also a profile-change event from the sidebar's POV.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) broadcastProfileNav(tabId, tab.url);
  } catch {}
});

const USE_STUB = false; // flip to true to bypass backend (offline UI testing)

async function callBackend(payload) {
  return apiCall('/api/generate', { method: 'POST', body: payload });
}

// Generic API caller — handles auth header, error mapping, and network failures
// the same way for /api/generate, /api/templates, /api/events.
//
// Auto-refresh: every call uses getValidAccessToken() which silently mints a
// fresh JWT when the cached one is near expiry. If we still get a 401 (e.g.
// the access was revoked), we attempt one refresh-and-retry before surfacing
// the auth error to the popup.
async function apiCall(path, opts) {
  const base = await getBackendBase();

  async function doFetch(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${base}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  let res;
  try {
    const token = await getValidAccessToken();
    res = await doFetch(token);

    // If the server still says 401 with a refresh-capable session, force a
    // refresh and retry once. Covers token rotation edge cases.
    if (res.status === 401 && (await getRefreshToken())) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        res = await doFetch(refreshed);
      }
    }

    // Single retry on transient 5xx (502/503/504 are common during Vercel
    // cold-starts or backend deploys). One extra attempt with 500ms backoff
    // turns a user-visible "Generation failed" toast into a one-second hiccup.
    if (res.status >= 500 && res.status < 600) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const token2 = await getValidAccessToken();
        res = await doFetch(token2);
      } catch {}
    }
  } catch (e) {
    return { ok: false, error: 'Network error — check connection.' };
  }

  let body;
  try { body = await res.json(); } catch { body = null; }

  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, error: 'Sign in to Riffly to keep going.', needsAuth: true };
    }
    if (res.status === 402) {
      // Surface the rich usage snapshot so the popup can render exact
      // remaining counts and reset dates instead of a generic "limit hit".
      // roastShareUsed lets the inline upgrade hint hide the bonus link
      // if the one-time +3 has already been claimed.
      return {
        ok: false,
        error: (body && body.error) || 'Monthly draft limit reached. Upgrade or wait for reset.',
        needsUpgrade: true,
        usage: body && body.usage,
        roastShareUsed: body && body.roastShareUsed,
      };
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
        text: `Hi ${firstName}, your work on ${hookFromHeadline} stood out, mostly because of how you've framed the ${role || 'role'} side. ${pitch} Worth a 15-minute conversation this week?`
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

  // Token hand-off from the dashboard content script. The dashboard posts
  // {access_token, refresh_token} via window.postMessage, the bridge content
  // script forwards it here, and we persist both. After this runs once,
  // the user is signed in — no popup paste needed.
  //
  // We trust the sender because the manifest only injects the bridge content
  // script on our own dashboard URLs; arbitrary pages can't reach this path.
  if (msg.type === 'RIFF_SET_TOKEN') {
    const access = msg.payload && msg.payload.access_token;
    const refresh = msg.payload && msg.payload.refresh_token;
    if (!access) {
      sendResponse({ ok: false, error: 'access_token missing' });
      return false;
    }
    chrome.storage.local
      .set({ riff_token: access, riff_refresh: refresh || null })
      .then(() => {
        // Funnel: token hand-off completed. Proxy for "user is signed
        // in within the extension." First-time-only so re-auth flows
        // don't double-count.
        riffTrackOnce('riff_telemetry_first_signin', 'ext_first_signin');
        sendResponse({ ok: true });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }

  // Generation
  if (msg.type === 'RIFF_GENERATE') {
    (USE_STUB ? Promise.resolve(stubResponse(msg.payload)) : callBackend(msg.payload))
      .then((resp) => {
        // Funnel: track every successful generation, plus a one-time
        // first_generate event so we can compute install→activation in
        // PostHog. We never block the response on the telemetry call.
        if (resp && resp.ok) {
          const surface = msg.payload && msg.payload.profile && msg.payload.profile.surface;
          riffTrackExt('ext_generate_success', { surface, plan: resp.plan });
          riffTrackOnce('riff_telemetry_first_generate', 'ext_first_generate', { surface, plan: resp.plan });
        } else if (resp && resp.needsAuth) {
          riffTrackExt('ext_generate_blocked', { reason: 'auth' });
        } else if (resp && resp.needsUpgrade) {
          riffTrackExt('ext_generate_blocked', { reason: 'quota' });
        }
        sendResponse(resp);
      })
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

  // /api/usage — popup's header usage chip ("X drafts left this month").
  // Cheap call, runs every popup open. Refreshed after every successful
  // generation via the `usage` field in the /api/generate response.
  if (msg.type === 'RIFF_GET_USAGE') {
    apiCall('/api/usage', { method: 'GET' }).then(sendResponse);
    return true;
  }

  // /api/parse-health — fire-and-forget telemetry from content.js. Lets us
  // see when LinkedIn ships a DOM change that breaks our parser, before the
  // first user complains via a Web Store review. Never blocks the popup.
  if (msg.type === 'RIFF_PARSE_HEALTH') {
    apiCall('/api/parse-health', { method: 'POST', body: msg.payload }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  // Active Profile Assist — score the profile against active job specs.
  // Plus-only on the backend; popup gates rendering separately.
  if (msg.type === 'RIFF_SCORE') {
    apiCall('/api/score', { method: 'POST', body: msg.payload }).then(sendResponse);
    return true;
  }
  // Job-specs CRUD passthroughs (used by the dashboard's spec manager and
  // — eventually — an inline spec editor in the popup).
  if (msg.type === 'RIFF_JOB_SPECS_LIST') {
    apiCall('/api/job-specs', { method: 'GET' }).then(sendResponse);
    return true;
  }
  if (msg.type === 'RIFF_JOB_SPECS_CREATE') {
    apiCall('/api/job-specs', { method: 'POST', body: msg.payload }).then(sendResponse);
    return true;
  }
  if (msg.type === 'RIFF_JOB_SPECS_DELETE') {
    apiCall(`/api/job-specs/${encodeURIComponent(msg.payload.id)}`, { method: 'DELETE' }).then(sendResponse);
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

  // Refresh the overdue-scan badge on demand. Popup pings this after a
  // successful scan so the badge decrements immediately.
  if (msg.type === 'RIFF_REFRESH_BADGE') {
    computeOverdueAndSetBadge().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Read or update the surface mode (popup vs sidebar). Footer toggle in
  // popup.html sends RIFF_SET_SURFACE_MODE, then immediately reflects the
  // new state. The change takes effect on the NEXT toolbar-icon click.
  if (msg.type === 'RIFF_GET_SURFACE_MODE') {
    chrome.storage.local.get('riff_surface_mode').then(({ riff_surface_mode }) => {
      sendResponse({ ok: true, mode: riff_surface_mode === 'popup' ? 'popup' : 'sidebar' });
    });
    return true;
  }
  if (msg.type === 'RIFF_SET_SURFACE_MODE') {
    const mode = msg.payload && msg.payload.mode === 'popup' ? 'popup' : 'sidebar';
    chrome.storage.local.set({ riff_surface_mode: mode })
      .then(() => applySurfaceMode())
      .then(() => sendResponse({ ok: true, mode }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }

  // Events (sent / replied tracking + follow-up detection)
  if (msg.type === 'RIFF_EVENTS_RECORD') {
    apiCall('/api/events', { method: 'POST', body: msg.payload }).then((resp) => {
      // Funnel: track first sent / first replied actions. These are
      // the truly meaningful activation moments — install + sign-in
      // + first-generate are all easy clicks; first Mark sent means
      // the user actually pasted the draft into a real LinkedIn DM.
      const kind = msg.payload && msg.payload.kind;
      if (kind === 'sent') {
        riffTrackOnce('riff_telemetry_first_sent', 'ext_first_sent');
        riffTrackExt('ext_mark_sent', { variant_type: msg.payload.variant_type });
      } else if (kind === 'replied') {
        riffTrackOnce('riff_telemetry_first_replied', 'ext_first_replied');
        riffTrackExt('ext_mark_replied', { variant_type: msg.payload.variant_type });
      }
      sendResponse(resp);
    });
    return true;
  }
  if (msg.type === 'RIFF_EVENTS_FOR_CANDIDATE') {
    const url = msg.payload && msg.payload.candidate;
    apiCall(`/api/events?candidate=${encodeURIComponent(url || '')}`, { method: 'GET' }).then(sendResponse);
    return true;
  }
  // Best-effort delete for the undo flow on Mark sent / Mark replied.
  // Backend may 404 if the endpoint isn't there yet — that's fine; the
  // local undo already removed the event from chrome.storage.local.
  if (msg.type === 'RIFF_EVENTS_DELETE') {
    const id = msg.payload && msg.payload.event_id;
    apiCall(`/api/events?event_id=${encodeURIComponent(id || '')}`, { method: 'DELETE' })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
