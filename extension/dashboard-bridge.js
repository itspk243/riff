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
// Security: we only accept messages from the same origin (window === source),
// and we ignore any message that doesn't have our exact `type`. This is
// belt-and-suspenders — content scripts only run on the dashboard URL anyway.

(function () {
  'use strict';

  // Heartbeat: tell the page we exist, so the "Connect extension" button
  // can become active. We resend on visibility changes in case the dashboard
  // was opened in a background tab and the listener hasn't attached yet.
  function announce() {
    try {
      window.postMessage({ type: 'riff:extension-ready', version: '0.5.0' }, '*');
    } catch {}
  }
  announce();
  // Re-announce after DOM ready and on a couple of intervals — the React app
  // might mount its listener slightly after we run.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  }
  setTimeout(announce, 200);
  setTimeout(announce, 1000);

  // Listen for the dashboard handing off a token bundle.
  window.addEventListener('message', (event) => {
    // Only accept messages from this same window (our own page).
    if (event.source !== window) return;
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
          // background worker reloaded mid-handoff.
          const ok = !chrome.runtime.lastError && resp && resp.ok;
          window.postMessage(
            { type: 'riff:set-token-result', ok, error: ok ? null : 'Could not save token in extension.' },
            '*'
          );
        }
      );
    }
  });
})();
