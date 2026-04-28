# Riff — One-Page MVP Spec

*Working title. Renameable. Riff = "improvise on a candidate's actual content."*

## Elevator pitch

A Chrome extension that turns a LinkedIn profile into a personalized cold-outreach opener in one click. Recruiter is on a candidate's profile, clicks Riff, gets a 60–90 word message that references something specific from the candidate's headline, current role, or a recent post — not generic "I came across your impressive background" filler. Recruiter edits if needed, copies, sends manually.

## Target user

Independent and small-agency technical recruiters. They send 30–80 cold outreach messages a day, they currently use either (a) manual templates, (b) ChatGPT in another tab, or (c) Apollo/Crystal whose personalization is shallow. They don't have an enterprise budget but can swipe a card for $39/mo.

## Core user flow

1. Recruiter installs extension from Chrome Web Store, signs up with email (magic link).
2. Recruiter visits a LinkedIn profile (`linkedin.com/in/*`, Sales Nav, or LinkedIn Recruiter).
3. Riff button appears in the profile sidebar (or Riff popup is opened from toolbar).
4. Recruiter selects: tone (warm / direct / cheeky), length (short / medium), and pastes a 1–2 sentence pitch ("I'm hiring a Staff Engineer for a payments infra team, $250K + equity, fully remote").
5. Optional: paste a URL or text snippet of a recent post the candidate wrote (deeper personalization).
6. Click Generate. Backend calls Claude with a tuned recruiter-outreach prompt + extracted profile context.
7. Returns 3 message variants (cold opener, short follow-up, breakup). Side-by-side.
8. Recruiter picks one, lightly edits inline, clicks Copy. Pastes into LinkedIn message box manually.

## Pricing

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 5 generations / week, 1 variant per gen |
| Pro | $39/mo | Unlimited generations, 3 variants, tone + length controls, post-paste deeper personalization |
| Team | $99/mo for 3 seats | Pro + shared message library + team analytics (later) |

Annual: 20% discount.

## TOS-compliance principles (non-negotiable)

1. **Passive read only** — content script extracts only the profile content the user is *already viewing*. No background prefetching. No bulk traversal of search results, connections, or the activity feed.
2. **No automated send** — extension never types into LinkedIn's message UI, never clicks send. User copy-pastes manually.
3. **No bulk operations** — one profile at a time, triggered by explicit user click.
4. **Deeper personalization is opt-in via paste** — user pastes a post URL or text. We don't crawl the activity feed.
5. **Marketing language** — "drafting assistant," "message helper." Never "automation," "auto-outreach," "auto-send."
6. **Backend never logs profile content longer than the request** — profile text is sent to Claude, used for that one generation, not stored. Only stored: the generated outputs, anonymized counts, and billing data.

These rules keep us in the same operating grey zone as Apollo, Crystal, ContactOut — tools that LinkedIn detects but doesn't ban because they don't auto-act.

## Architecture

```
[Chrome Extension]                    [Backend on Vercel]                [Services]
  ├ content.js  ──── reads profile ──┐
  ├ popup.html ──── UI               ├─► /api/generate ──► Claude Sonnet
  ├ popup.js   ──── state            │                  ─► Postgres (Supabase)
  └ background.js ─ messaging        ├─► /api/auth     ──► Supabase Auth
                                     └─► /api/billing  ──► Stripe
```

**Extension:** Manifest V3. Content script injected only on `linkedin.com/in/*`, `linkedin.com/sales/lead/*`, `linkedin.com/talent/profile/*`. Reads visible DOM (name, headline, current role, About, top of experience, pinned post if present). Sends to background worker → backend.

**Backend:** Next.js API routes on Vercel (free tier handles MVP scale). Auth via Supabase email magic links. Postgres via Supabase. Stripe Checkout for upgrades, customer portal for cancellations.

**LLM:** Claude Sonnet 4.6 for output quality. Cost per generation ~$0.005 at 500 input + 200 output tokens. At $39/mo, 200 generations/user/month = ~$1 in LLM cost = healthy margin even with infra overhead.

**Prompt design:** System prompt with explicit anti-pattern blacklist ("never use 'impressive background', 'hope you're doing well', 'scaling challenges'"), recency-weighted ranking when post data is provided, conversation-starter framing instead of pitch framing. Three output variants per call.

## What ships in v1 (week 1–2)

- Extension reads profile DOM on linkedin.com/in/*
- Popup UI with tone, length, your-pitch input, optional post-paste field
- Backend `/api/generate` calling Claude with tuned prompt
- Returns 3 variants, copy-to-clipboard
- Free tier rate limit (5/week, tracked in Postgres)
- Stripe Checkout for Pro upgrade
- Supabase auth (magic link)
- Landing page at riff.[domain] with demo video, pricing, install button

## What waits for v2 (after first paying users)

- Sales Navigator + LinkedIn Recruiter URL support
- Team plan + shared library
- Analytics dashboard (which messages got responses — manual user input)
- Tone fine-tuning per user
- Browser-side history of past generations
- Multi-language support

## 30-day milestone plan

| Week | Goal | Output |
|---|---|---|
| 1 | Spec + extension scaffold + backend skeleton | Working `/api/generate` endpoint + extension that reads profile + popup UI mockup |
| 2 | Stripe + auth + landing page + Web Store submission | End-to-end paid flow works, Web Store review pending |
| 3 | Web Store live + first paid users + ads launch | $50–100/day Google ads, first 10–30 paid users |
| 4 | Iterate on output quality + scale ad spend | Push to $5K MRR target |

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| LinkedIn detects extension and warns users | Stay passive-read + manual-send. Position as drafting tool. Apollo lives here, so can we. |
| Output quality plateau (LLM sounds generic) | Heavy prompt iteration in week 1, A/B test tones, allow user to provide example messages they like. |
| CAC > LTV via Google ads | Start with $30–50/day, kill keywords with > $40 CAC, lean into Reddit + content if ads don't pencil. |
| Churn (recruiter cancels after first month) | Annual plan discount, recruiter-specific message library that grows with usage = lock-in. |
| LinkedIn bans extensions broadly | Web app fallback already in scope — same backend, user pastes profile URL into our site. |

## Tech stack decisions (committed)

- **Extension:** Vanilla JS + Manifest V3. No framework — overhead not worth it at this scale.
- **Backend:** Next.js (TS) on Vercel free tier.
- **DB + Auth:** Supabase free tier.
- **Payments:** Stripe (Checkout + Customer Portal).
- **LLM:** Claude Sonnet 4.6 via Anthropic API.
- **Analytics:** PostHog free tier.
- **Errors:** Sentry free tier.

Total monthly cost at zero users: ~$0. At 100 paid users (~$3.9K MRR): ~$50/mo (Vercel + Supabase tiers + Sentry).

## File layout

```
riff/
├── SPEC.md                  ← this file
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── icons/
├── backend/                 (next turn)
│   └── ...
└── landing/                 (next turn)
    └── ...
```
