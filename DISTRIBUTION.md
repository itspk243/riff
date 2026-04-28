# Riff — 30-Day Distribution Playbook

The product is the easy part. This document is the hard part. It's a concrete, day-by-day execution plan for getting from $0 to $5K MRR (or as close as we get) in 30 days, given the constraints we have:

- No LinkedIn presence (can't run personal LinkedIn DM campaigns)
- No existing audience
- ~$300–500 ad budget
- Solo dev with some coding experience

Honest baseline odds at $5K MRR in 30 days: ~10–13%. Each lever in this playbook moves that needle. The goal of running every channel below isn't to do all of them at 100% — it's to find the one or two that work for *us* and pour gas on those.

---

## Channel mix

| Channel | Cost | Effort | Expected hit rate | Why it fits us |
|---|---|---|---|---|
| Cold email to agency recruiters | ~$50 (tools) | High | Highest for B2B with no audience | Agency recruiter emails are publicly listed on firm websites. No LinkedIn needed. |
| Google Search ads (high-intent keywords) | $50–150/day | Medium | Real but expensive at our budget | Direct intent capture: "linkedin outreach tool", "ai cold message" |
| Reddit posts (r/recruiting, r/recruitinghell, r/sales) | $0 | Medium | High variance, but free | Receptive to genuinely useful tools if positioned right |
| Product Hunt launch | $0 | High | One-shot spike | Launch day can drive 200–800 trials if assets are tight |
| TikTok / YouTube short demos | $0 (organic) or $200 sponsored | High | Hit-or-miss but huge upside | Recruiters watch "recruiter life" content; demo videos go viral |
| OneReq Slack + recruiter Slack/Discord | $0 (gated entry) | Medium | High quality if accepted | Tight pro community; AMA + tool sharing welcomed |
| Web Store ASO | $0 | Low | Compounding over months | Listing optimization for "linkedin outreach", "recruiter ai" |
| YouTube creator sponsorships | $300–800/spot | Low (one email) | Highest cost-per-trial but unmatched conversion | A "Recruiting Insights" channel mention drives 30–80 paid trials |

We do all of these. We measure CAC per channel weekly. By day 14, we know which 1–2 to scale.

---

## Week 0 (build week — backend + landing page deploy)

This isn't really week 0 in the sales sense, it's the launch ramp. While you're shipping code, do these in parallel:

### Day -7 to -1 (pre-launch)

- [ ] **Build the cold email list.** Goal: 500 agency recruiter contacts.
  - Source: Google "[city] recruiting agency" + "boutique recruiting firm". For each firm, the team page typically lists email addresses. Manually collect or use a lightweight scraper.
  - Better source: Recruiter directories on [recruitingagencies.com](https://recruitingagencies.com), [topclassactions.com], state recruiter associations.
  - Better still: **Apollo.io free tier** gives you 50–100 contact credits/month. Search for "Recruiter" or "Talent Acquisition" titles at firms <50 employees. Export.
  - **Do not include in-house recruiters at FAANG-tier companies.** They use enterprise tools and can't approve a $39/mo purchase.
- [ ] **Set up your sending domain.** Buy `riff.app` (or alternative — `riff.tools`, `getriff.io`, `tryriff.com`). Set up email forwarding for `hello@` and `support@`. Set up SPF, DKIM, DMARC for whatever domain you'll send cold emails from. **Do not send cold email from your main domain** — use a separate domain (e.g. `riff-mail.com`) so any deliverability damage doesn't poison your main inbox.
- [ ] **Pre-launch waitlist.** The landing page already has a `/signup` CTA. Wire it to capture email + a single field "tell me your biggest cold-outreach pain in one sentence" → goes to your inbox + a Notion doc. This both builds an audience to email at launch AND gives you market research.
- [ ] **Build a 60-second demo video.** Show a real LinkedIn profile → click Riff → type pitch → see three drafts → copy. Voiceover or captioned. This goes on the landing page, in your Product Hunt assets, and as the TikTok organic content.

### Day 0 (extension live in Web Store + ads turn on)

- [ ] Submit extension to Chrome Web Store. Review takes 3–7 days; submit early.
- [ ] Deploy backend to Vercel.
- [ ] Deploy landing page (can be a single static HTML on Vercel or Cloudflare Pages).
- [ ] Wire extension `riff_backend_url` to production URL.
- [ ] Run Google Ads with $30/day for first 3 days. Keywords below.

---

## Week 1 — turn on every channel, measure, kill what's dead

### Cold email — the highest-leverage channel for our constraints

**Target list:** 500 agency recruiter contacts (built in week 0).

**Cadence:** 4-touch sequence over 14 days.

**Volume:** 50/day max. Higher than that and deliverability tanks.

**Tooling:** Use [Instantly.ai](https://instantly.ai) ($37/mo) or [Smartlead](https://smartlead.ai) ($39/mo) — both handle warmup, rotation across 2–3 sending mailboxes, and reply detection. **Do NOT use Gmail directly** — your account will get flagged.

**Sequence:**

```
EMAIL 1 (Day 0)
Subject: cold-outreach prompt (recruiting)

Hey {first_name} — saw {firm_name} works on {industry/role} placements. 

I built a Chrome extension that drafts cold-outreach LinkedIn messages 
that don't sound like cold outreach. It reads the candidate's profile 
(including a recent post if you paste one) and writes an opener that 
references something specific they actually did — not "I came across 
your impressive background."

5 free generations a week, no card required: riff.app

Worth a 60-second test on your next sourcing batch?

— [Your name]
```

```
EMAIL 2 (Day 4 — only if no reply)
Subject: re: cold-outreach prompt

{first_name} — quick follow-up. Two recruiters I shared this with 
last week said the same thing: their first reaction was "this sounds 
like the GPT wrappers I've already tried." It's not — we built a 
phrase blacklist that bans every dead template line ("great fit," 
"impressive background," "scaling challenges").

Free trial is at riff.app. Takes 30 seconds to install.

— [Your name]
```

```
EMAIL 3 (Day 9 — only if no reply)
Subject: last note from me

{first_name} — last note. If outreach personalization isn't a sore 
spot for {firm_name} right now, I'll stop crowding your inbox. 
If you ever want to peek: riff.app.

— [Your name]
```

```
EMAIL 4 (Day 14 — only if no reply, and only to high-fit leads)
Subject: a Loom of Riff in 90 seconds

{first_name} — figured I'd just send you the demo instead of 
asking you to find time. 90 seconds: [loom link]. If it solves a 
real problem, the install link is in the description.

— [Your name]
```

**Expected math:** 500 contacts × 4-touch sequence × 30-day window. Open rate ~35–45% if your subject lines work. Reply rate ~3–6% (high for cold). Trial install rate from replies ~30%. Trial-to-paid ~10–15%. **Honest projection: ~$400–800 MRR from cold email alone if executed cleanly.** Not enough on its own, but a real chunk.

### Reddit — the free organic channel

**Don't post promotional. Post useful.**

Three angles, posted across r/recruiting, r/recruitinghell, r/sales (sales reps share outreach tactics), r/SDR, r/TalentAcquisition, r/Entrepreneur:

**Angle 1: "I analyzed 50 recruiter cold messages and 49 used the same opener"**

A genuine post (you actually do this analysis — pick 50 outreach messages from your inbox or recruiters you know). List the 5 most common dead phrases. Mention you got tired of seeing them so you built a tool with a phrase blacklist (link in last sentence, very softly).

**Angle 2: "Why your LinkedIn cold messages get a 3% response rate (and what to do about it)"**

Educational post. Real value. Cover: specific recent reference, conversation-starter framing, length, anti-patterns. Mention Riff in a single sentence at the end as the way you've automated this for yourself.

**Angle 3: "Made a Chrome extension that drafts personalized recruiter outreach — would love brutal feedback"**

Direct "Show HN"-style post in r/SideProject, r/SaaS, r/Entrepreneur, r/IndieHackers. Be honest about what it is. Ask for criticism. This converts surprisingly well because the audience is builders who appreciate other builders.

**Cadence:** One angle per week. Don't blast all three at once — Reddit kills accounts that look like marketers.

**Account hygiene:** Use a real account with comment history. If you don't have one, spend 1 week commenting genuinely in r/recruiting before posting anything.

### Google Ads

**Starter budget:** $30/day for first week, scale based on CAC.

**Starter keyword list (exact and phrase match):**

```
linkedin outreach tool
linkedin cold message
ai linkedin message
recruiter outreach tool
linkedin message generator
ai cold outreach
linkedin sourcing tool
personalized linkedin message
linkedin cold dm
recruiter cold email
ai recruiter assistant
```

**Negative keywords (exclude):**

```
free
template
download
dating
tinder
job hunt
candidate side
how to write
```

**Ad copy starter (3 variants — let Google rotate):**

1. **Cold outreach that doesn't sound like cold outreach** — Ai-drafted LinkedIn messages personalized to each candidate's actual recent activity. 3x reply rates. Try free.

2. **Stop sending "I came across your impressive background"** — Riff drafts personalized LinkedIn outreach in one click. Tone control. No automation. From $39/mo. Free trial.

3. **The Chrome extension recruiters use to draft 30 messages in 30 minutes** — Reads profiles. Drafts openers, follow-ups, breakups. Banned from saying "great fit." Free trial.

**Landing page:** Direct ads to `/?utm_source=google&utm_campaign={kw}`. Same hero, same CTA. Track conversion rate per keyword.

**Kill rule:** If a keyword has spent $40 with no signup at the end of week 1, kill it. Aggressive pruning is the difference between $0 and $1K MRR from ads.

### TikTok / YouTube Shorts (organic)

Record 4 demo videos in week 1. Each is 30–60 seconds. Format:

1. **"How recruiters write cold outreach in 2024" (parody)** — show a recruiter typing the dead-phrase template. Cut to Riff doing it in 5 seconds. Voiceover: "or you could just use Riff."
2. **"Watch me write 10 personalized LinkedIn messages in 4 minutes"** — speed demo. Real profiles (or real-looking mockups). Caption: link in bio.
3. **"The phrase recruiters need to stop using"** — talking head. "I came across your impressive background" / why it's dead / what to do instead / "I built a tool that bans this phrase from its own output."
4. **"Apollo vs Riff side-by-side"** — competitive comparison. Show Apollo's output and Riff's output for the same profile. Direct.

Post 1/day. Riff bio link goes to landing page.

**This is high-variance, low-cost.** Most videos die at 200–500 views. One in 10 hits 50K+. Keep posting.

### Product Hunt launch

**Schedule:** Day 18–22 (after Web Store live + at least 50 trials in the door). Aim for a Tuesday or Wednesday launch.

**Assets needed:**
- 1280x800 product image (the demo screenshot side-by-side)
- 240x240 logo
- Tagline: "Cold outreach that doesn't sound like cold outreach"
- Description: 260 chars, hooks the differentiation in first sentence
- Embedded gallery: 5 screenshots, 1 demo GIF
- First-comment post (you write it 5min after launch): your founder story + what makes Riff different + a discount code for PH ("RIFFPH" → 30% off first 3 months)

**Pre-launch:** Build a "hunter list" by commenting genuinely on 30 PH launches in your category over the 2 weeks before launch. That earns you reciprocal upvotes. Apply to be hunted by an established hunter (saves you the effort of building maker rep).

---

## Week 2 — double down on what's working

By end of week 1, you have CAC numbers per channel. Kill the bottom half. Pour the next $200–300 of ad budget into whichever channel converted at the lowest CAC.

Likely outcomes:
- If cold email is converting → buy more sending warmup, expand the list to 1,000 contacts.
- If Google ads have ROAS > 1.5 → scale budget to $80–120/day.
- If Reddit hit → write a longer-form companion post with more depth, link Riff in the comments.
- If TikTok hit → boost the winning video with $50–100 in TikTok ads, repost on Reels and Shorts.

### Recurring weekly tasks

- [ ] Review last week's conversion data per channel
- [ ] One Reddit post (a fresh angle)
- [ ] 4–5 TikTok/YouTube short demos
- [ ] One outreach to a recruiter influencer (sponsorship pitch — $300–500 sponsored mention)
- [ ] Cold email warmup check + reply triage daily

---

## Week 3 — Product Hunt launch + first paid users in production

Goals:
- Web Store extension live (review should be done)
- $1.5–2.5K MRR by end of week from compounded ad/email/Reddit traction
- Product Hunt launch on Tuesday
- 5–10 customer interviews (15-min calls with paid users to learn what to build next)

### Customer interviews

**This is non-negotiable.** Within 48 hours of someone going Pro, send them a personal email:

> "Thanks for going Pro. I'm building Riff solo — would love a 15-min call this week to hear what's working and what isn't. Free month of Pro on the house if we chat."

Three of these calls in week 3 will tell you exactly what to build in week 4 to drive churn down and price up.

---

## Week 4 — push to target, kill churn, iterate prompt

Final week. By now you're either trending toward $5K MRR or you're not. The math:

- If you're at $3K+ MRR by day 25, push hard on whatever's working. Spend the last $200 of budget on the winning channel.
- If you're at $1.5–2.5K MRR by day 25, you're on track for a great 60-day outcome. Don't burn out trying to hit the arbitrary 30-day target — the 60-day version is real.
- If you're at <$500 MRR by day 25, slow down. The product needs work, the prompt needs iteration, or the wedge is wrong. Spend the last 5 days on customer interviews and prompt iteration, not ads.

### Prompt iteration

The single highest-leverage thing you can do in week 4 is improve the prompt. After 50–100 paid users have generated 1,000+ messages, you have data. Look at:

- Which generations got copied to clipboard? (Add a copy-tracking pixel.)
- Which got regenerated? (Bad output signal.)
- Spot-check 50 random outputs for blacklisted phrases that slipped through.
- Add new entries to the blacklist. Add new few-shot examples in `prompt.ts`.

Every prompt iteration that lifts copy-rate by 5% is worth more than $1,000 in ad spend.

---

## Metrics to track every day

```
Day | Trials | New Pro | New Team | MRR | Cum cold emails sent | Reddit upvotes | Ad spend | Ad ROAS | Top channel
```

Spreadsheet in Notion or Google Sheets. Check every morning at 9am. Adjust by 9:30am.

---

## When to quit / when to double down

| Signal at day 30 | What it means | What to do |
|---|---|---|
| <$500 MRR, <50 trials | Wedge is wrong or product is broken | Customer interviews, consider pivoting wedge |
| $500–1.5K MRR, growing weekly | On track for $5K MRR by day 90 | Keep building, don't change strategy |
| $1.5–3K MRR, growing weekly | Strong indie outcome trajectory | Hire a part-time content/marketing person |
| $3–5K MRR | Excellent. Scale ads, raise price | Test $49 and $59 price points |
| $5K+ MRR | We did it | Take a victory lap, then start week 5 |

---

## What I'm not including in this playbook (deliberately)

- **LinkedIn DMs.** You have no profile. Building one credibly takes 2 weeks of activity that doesn't drive revenue. Skip.
- **Paid Twitter ads.** B2B conversion from Twitter ads is poor.
- **Generic SEO content.** Domain has zero authority, ranking takes 3–6 months. Worth investing in for the 90-day version, not the 30-day.
- **Influencer marketing at scale.** One $500 sponsorship is fine; scaling that channel requires more capital than we have.
- **Building features from feedback before paid users exist.** Ship. Get usage. Then iterate. Customer interviews matter, but don't pre-build.

---

## A note on what "as if our existences depended on it" means in practice

The hard truth: $5K MRR in 30 days from a cold start is a 10–15% probability event. Doing every channel above gets us to maybe 18–25%. The biggest lever — manual founder-led DMs to first 50 customers — is off the table by your constraint. We work with what we have.

But $5K MRR by day 60 is a 30–40% probability event with this playbook. $5K MRR by day 90 is 45–55%. The math gets significantly friendlier as we extend timeline. Don't let the 30-day stretch goal make you quit at day 30 if you're at $1.5K MRR climbing — that's a real business in motion.

The best version of this is: hit our targets every week, learn fast, kill what doesn't work, and on day 30, look at the trajectory honestly. If we're trending up, we keep going. If we're flat, we change something specific. We don't rage-quit because of an arbitrary timeline.
