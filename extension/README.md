# Riffly — Chrome Extension v0.1 (sideload)

This is the v0.1 scaffold. Backend is stubbed — generation returns a deterministic mock so the full UI flow is testable end to end before we wire Claude.

## How to sideload and test

1. Open Chrome → `chrome://extensions/`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this `extension/` folder.
5. Pin the Riffly icon to the toolbar (puzzle icon → pin Riffly).
6. Visit any `linkedin.com/in/<someone>` profile.
7. Click the Riffly icon. The popup should show the detected name, headline, and current role.
8. Type a pitch, click **Generate** — three stub variants render.

If profile detection misses fields, that means LinkedIn changed their DOM (which they do regularly). Selectors live in `content.js` and are intentionally loose with multiple fallbacks — easy to patch.

## Switching the stub off

In `background.js`, flip:

```js
const USE_STUB = false;
```

…and point `RIFF_BACKEND` to the real backend URL once it's deployed (next milestone).

## What's missing in v0.1

- Real backend (`/api/generate` calling Claude).
- Auth (Supabase magic link).
- Stripe checkout + free-tier quota enforcement.
- Icons (manifest currently uses Chrome's default).
- Sales Navigator and LinkedIn Recruiter URL parsing (selectors in `content.js` cover the URL match but the DOM differs — needs separate parser per surface).

## Files

- `manifest.json` — Manifest V3, scoped to LinkedIn profile/sales/recruiter URLs only.
- `content.js` — Passive DOM read of the visible profile. No bulk traversal. Triggered only by an explicit popup message.
- `background.js` — Service worker that routes generation requests. Stubbed.
- `popup.html` / `popup.css` / `popup.js` — Single-window UI with tone, length, pitch, optional recent-post paste.

## TOS-compliance notes

The extension never:

- prefetches profiles in the background
- traverses connections, search results, or the activity feed in bulk
- types into LinkedIn's message UI
- clicks send

It only reads the visible profile when the user explicitly clicks Riffly, then hands the user a draft to copy manually. This keeps Riffly in the same operating zone as Apollo/Crystal/ContactOut — detected by LinkedIn but not subject to action because there's no automated behavior.
