# Riff — Deployment Guide

End-to-end steps to take this from a folder of files to a live, paying-customer-accepting product.

## Prerequisites

- Node 18.17+
- A credit card for Vercel (free tier is fine), Stripe, Anthropic, and a domain registrar
- ~30 minutes if everything goes right, ~2 hours if anything goes wrong (it will)

## 1. Create accounts and get keys (~15 min)

**Default for the launch period: Gemini free tier.** Costs nothing during pre-revenue. Flip to Claude (one env var change) once paid users cover the API spend.

| Service | What to grab | Where |
|---|---|---|
| [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | One-click sign-in with Google. No card. ~1500 req/day free. |
| [Supabase](https://supabase.com) | Project URL, anon key, service-role key | Project Settings → API |
| [Stripe](https://dashboard.stripe.com) | Secret key, webhook signing secret, price IDs | Developers → API keys; Products → create Pro $39/mo + Team $99/mo |
| [Vercel](https://vercel.com) | (no key needed, just an account) | Connect to your GitHub |
| Domain registrar | A domain — `riff.app`, `getriff.io`, etc. | Namecheap, Cloudflare Registrar |

**When you have revenue and want to switch to Claude:**
- Sign up at [console.anthropic.com](https://console.anthropic.com) for `ANTHROPIC_API_KEY`
- In Vercel env vars, change `LLM_PROVIDER=gemini` to `LLM_PROVIDER=claude` and add the Anthropic key
- Redeploy. That's it. No code change.

## 2. Set up Supabase (~5 min)

1. Create a new Supabase project. Pick the closest region.
2. SQL editor → paste contents of `backend/supabase/schema.sql` → run.
3. Auth → URL configuration → set Site URL to `https://YOURDOMAIN`. Add `https://YOURDOMAIN/auth/callback` as a redirect URL.
4. Auth → Email templates → tweak the magic link template to mention Riff (optional but converts better).

## 3. Set up Stripe products (~5 min)

1. Products → Add product → "Riff Pro" → recurring monthly $39 → save price ID.
2. Products → Add product → "Riff Team" → recurring monthly $99 → save price ID.
3. Developers → Webhooks → Add endpoint → `https://YOURDOMAIN/api/billing/webhook` → events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` → save signing secret.

## 4. Deploy backend to Vercel (~5 min)

```bash
cd outputs/riff/backend
npm install
# Optional local smoke test:
cp .env.example .env.local
# fill in .env.local with real keys, set ALLOW_ANON=true for the smoke test
npm run dev
# Visit http://localhost:3000/api/generate (POST) with curl to test

# Deploy:
npx vercel --prod
# When prompted, link to a new project named "riff-backend"
# Then copy your env vars into the Vercel project settings:
#   Project Settings → Environment Variables → paste each from .env.example
# Set RIFF_PUBLIC_URL to your Vercel domain (or custom domain if attached)
# Set ALLOW_ANON to false in production
```

Verify with:
```bash
curl https://YOURDOMAIN/api/generate \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"profile":{"name":"Test","headline":"Eng"},"pitch":"Hiring a Staff Engineer","tone":"direct","length":"medium"}'
```

## 5. Deploy landing page (~3 min)

```bash
cd outputs/riff/landing
# It's a single static HTML file. Easiest: drag-and-drop into a new Vercel project,
# or push to a GitHub repo and connect.
# Custom domain: point YOURDOMAIN.com at this Vercel project.
# The /api/* routes can live on the same domain via Vercel rewrites — see below.
```

If you want backend + landing on the same domain (cleaner URLs), put both in a monorepo with the landing page as a single `public/index.html` inside the Next.js project's `public/` folder.

## 6. Wire the extension to production (~2 min)

1. Open `chrome://extensions/`, click the Riff service worker's "Inspect" link to open its console.
2. Run:
   ```js
   chrome.storage.local.set({ riff_backend_url: 'https://YOURDOMAIN' })
   ```
3. Reload the extension.
4. Visit a LinkedIn profile and test the full flow.

## 7. Submit to Chrome Web Store (~30 min, then 3–7 day review)

1. Sign up as a Chrome Web Store developer ($5 one-time fee).
2. Zip the `extension/` folder (NOT including `README.md`).
3. Create a new item in the dev dashboard, upload the zip.
4. Fill in:
   - Title: "Riff — Personalized LinkedIn Outreach Drafts"
   - Summary: "AI-drafted LinkedIn messages that don't sound like cold outreach. Reads the profile you're viewing and writes a personalized opener."
   - Detailed description: paste from `landing/index.html` body copy
   - Category: Productivity
   - Screenshots: 5 × 1280×800 — capture the popup in action
   - Promo tile: 440×280
   - Privacy practices: declare what data you collect (email, anonymized usage), declare you do not sell data
5. Submit. Wait 3–7 days for review.

While waiting: distribution playbook can run on the sideloaded version (Reddit, cold email, Product Hunt — Web Store listing is the long-tail, not the launch lever).

## 8. Set up analytics + error tracking (~5 min)

- [PostHog free tier](https://posthog.com): drop their snippet into the landing page `<head>`. Track event `signup_clicked`, `pricing_viewed`.
- [Sentry free tier](https://sentry.io): wrap Next.js with `@sentry/nextjs`. Catch every `/api/generate` failure.

## 9. Day-of-launch checklist

- [ ] Backend deployed, env vars set, ALLOW_ANON=false
- [ ] Landing page live, all CTAs go to working `/signup`
- [ ] Stripe webhooks delivering to `/api/billing/webhook` (test mode first, then flip to live)
- [ ] Extension installed (sideload OK; Web Store listing pending)
- [ ] First Google Ads campaign running ($30/day budget)
- [ ] Cold email sequence loaded into Instantly with 100-contact test batch
- [ ] One Reddit post drafted and ready for Tuesday morning
- [ ] Demo video recorded and uploaded
- [ ] Notion doc set up for daily metrics

## Common gotchas

- **Supabase magic link goes to spam:** add SPF/DKIM for the Supabase sender domain or hook up a custom SMTP via Resend.
- **Stripe webhook signature errors:** common cause is body parser eating the raw body. We disabled bodyParser in `webhook.ts` for this reason — don't add Next.js middleware that touches the body.
- **Extension can't reach backend on localhost:** add `http://localhost:3000/*` to `host_permissions` in `manifest.json` during dev. Remove before Web Store submission.
- **CORS errors when extension calls API:** confirmed `next.config.js` headers block is in place. If still failing, add the chrome-extension origin explicitly.
- **Claude returns occasional bad JSON:** the `claude.ts` retry handles one retry. If you see this happen >5% of calls, lower temperature in the API call (currently default).
