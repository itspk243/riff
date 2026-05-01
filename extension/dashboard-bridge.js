// Riffly dashboard bridge.
// Runs as a content script on the Riffly dashboard. Two jobs:
//
//   1. Announce presence — post a `riff:extension-ready` message to the page
//      so the dashboard can swap "Paste this token" for a one-click "Connect
//      extension" button.
//
//   2. Receive a token bundle — when the dashboard posts
//      `riff:set-token` with `{access_token, refresh_token}`, forward it
//      to the background worker which writes it to chrome.storage.local.
//
// Security: every postMessage is scoped to window.location.origin (NOT '*')
// so a malicious iframe on the page cannot eavesdrop. Every received message
// is validated against ALLOWED_ORIGINS so a malicious iframe cannot inject
// a fake token. The version string is read from manifest.json so it never
// drifts from the manifest.

(function () {
  'use strict';

  const ALLOWED_ORIGINS = new Set([
    'https://rifflylabs.com',
    'https://www.rifflylabs.com',
  ]);

  // Read the extension version from the manifest so it stays in sync.
  const VERSION = (chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version
    : 'unknown';

  // Heartbeat: tell the page we exist, so the "Connect extension" button
  // can become active. Scoped to our own origin so no other iframe sees it.
  // We resend after DOM ready in case the dashboard's React listener mounts
  // a beat after we inject.
  function announce() {
    try {
      window.postMessage(
        { type: 'riff:extension-ready', version: VERSION },
        window.location.origin
      );
    } catch {}
  }
  announce();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  }
  setTimeout(announce, 200);
  setTimeout(announce, 1000);

  // Listen for the dashboard handing off a token bundle.
  window.addEventListener('message', (event) => {
    // Reject anything not from our own window AND not from one of our
    // allowed origins. Belt-and-suspenders against malicious iframes.
    if (event.source !== window) return;
    if (!ALLOWED_ORIGINS.has(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'riff:set-token') {
      const { access_token, refresh_token } = data;
      if (!access_token || typeof access_token !== 'string') return;
      // refresh_token is optional but strongly recommended (without it the
      // user gets the legacy 1hr-and-out behavior).
      chrome.runtime.sendMessage(
        {
          type: 'RIFF_SET_TOKEN',
          payload: { access_token, refresh_token: refresh_token || null },
        },
        (resp) => {
          // Echo back to the page so the dashboard can show "Connected ✓"
          // (or surface an error). chrome.runtime.lastError can fire if the
          // background worker reloaded mid-handoff. Reply scoped to origin.
          const ok = !chrome.runtime.lastError && resp && resp.ok;
          window.postMessage(
            { type: 'riff:set-token-result', ok, error: ok ? null : 'Could not save token in extension.' },
            window.location.origin
          );
        }
      );
    }
  });
})();
