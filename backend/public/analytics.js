// Riffly funnel telemetry — PostHog wrapper.
//
// How it's wired:
//   1. The page includes a <meta name="riff-posthog-key" content="..."> tag.
//      The content is the public PostHog project API key (NEXT_PUBLIC_POSTHOG_KEY
//      injected at build time, OR pasted directly during initial setup).
//   2. This file reads the meta tag, lazy-loads PostHog from the CDN, and
//      exposes window.riffTrack(eventName, props) for app code to call.
//   3. If the meta is missing or empty, riffTrack becomes a no-op. No errors,
//      no console noise — analytics is a polish layer, never block the page.
//
// Why a meta tag instead of inline script: keeps the key out of HTML files
// in source control, easy to swap per-environment via a build step or
// reverse-proxy header rewrite. For now you can just edit the meta tag in
// each public/*.html file once you have the key from PostHog.
//
// Event names follow snake_case for consistency with PostHog conventions.

(function () {
  'use strict';

  function getKey() {
    const m = document.querySelector('meta[name="riff-posthog-key"]');
    if (!m) return '';
    const v = (m.getAttribute('content') || '').trim();
    if (!v || v.startsWith('{{') || v === 'YOUR_POSTHOG_KEY_HERE') return '';
    return v;
  }

  function getHost() {
    const m = document.querySelector('meta[name="riff-posthog-host"]');
    const v = m ? (m.getAttribute('content') || '').trim() : '';
    return v || 'https://us.i.posthog.com';
  }

  const apiKey = getKey();

  if (!apiKey) {
    // No-op stub. Apps can call riffTrack() without checking for it.
    window.riffTrack = function () {};
    window.riffIdentify = function () {};
    return;
  }

  // PostHog snippet (verbatim from posthog.com/docs/libraries/js, trimmed).
  // Loads posthog-js asynchronously; queues calls before it's ready.
  !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; } (p = t.createElement("script")).type = "text/javascript", p.crossOrigin = "anonymous", p.async = !0, p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js", (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e; }, u.people.toString = function () { return u.toString(1) + ".people (stub)"; }, o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]); }, e.__SV = 1); }(document, window.posthog || []);

  window.posthog.init(apiKey, {
    api_host: getHost(),
    person_profiles: 'identified_only', // anonymous visitors don't create profiles until they identify
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // we'll explicitly fire events; auto is too noisy
  });

  // Public helpers for app code to call.
  window.riffTrack = function (event, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(event, props || {});
      }
    } catch { /* never let analytics throw */ }
  };
  window.riffIdentify = function (userId, props) {
    try {
      if (window.posthog && typeof window.posthog.identify === 'function') {
        window.posthog.identify(userId, props || {});
      }
    } catch { /* silent */ }
  };
})();
