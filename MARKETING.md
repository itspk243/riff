# Riff — Marketing Kit

All copy artifacts for the 30-day distribution push, ready to copy-paste with light personalization. Adjust voice to match your own — the structures and angles are what matter.

---

## 1. Reddit post drafts (3 angles)

Post one per week. Don't blast all three at once — Reddit kills accounts that look like marketers. Each is meant to be useful first, promotional last. Read the subreddit's rules before posting; some require a "[Tool]" or similar tag.

### Angle 1 — Analysis post (week 1)

**Subreddit:** r/recruiting (260K), cross-post to r/sales after 24 hours
**Title:** I read 50 cold-outreach LinkedIn messages from my inbox this week. 47 used the exact same opener.
**Body:**

> Pulled them out and looked side by side. Here's what they had in common:
>
> 1. **"I came across your..."** — 31 of 50 messages started with this exact phrase or a near-clone ("I noticed your", "Saw your"). It's become the "Hope this email finds you well" of LinkedIn.
> 2. **"Impressive background"** — 24 of 50. Said about people whose headlines were public for ten seconds.
> 3. **"Would be a great fit"** — 19 of 50. Almost always before any specific reason given.
> 4. **"Quick question"** — 17 of 50. Followed by a paragraph, never a question.
> 5. **"Looking forward to hearing from you"** — 38 of 50. Closed the same way as your bank's marketing emails.
>
> The three that didn't follow this pattern referenced something specific I'd posted about in the last few weeks — *what* I'd argued, not just that I'd posted. Two of them I actually replied to.
>
> The fix isn't subtle: stop opening with a compliment. Open with a specific observation tied to *what they're working on or what they've said publicly*, then connect it to your role in one sentence, then ask one specific question that isn't "are you open to opportunities?".
>
> I got tired of seeing the pattern, so I built a Chrome extension that has these phrases hard-banned in its prompt. Free tier on riff.app if you want to compare its output to whatever you're sending now. Mostly though I just wanted to see if I'm alone in being annoyed by this — anyone else's inbox look like mine?

**Why it works:** Useful before promotional. The list is the post; the link is the footnote. Invites discussion, doesn't demand engagement.

### Angle 2 — Educational post (week 2)

**Subreddit:** r/recruiting, cross-post to r/SDR
**Title:** A 3% reply rate isn't a candidate problem. It's a message problem. Five fixes that actually move the number.
**Body:**

> Sourcers and recruiters I talk to keep blaming the candidate side — "they're not open", "the market's flooded", "everyone's getting hammered with InMails." Some of that's true. But when I look at the messages people are sending, the bigger reason is the messages.
>
> Five things that meaningfully change reply rates, ranked by how much they actually move the number based on what I've seen:
>
> **1. Reference something specific from the last 90 days, not "your background."**
> The single biggest lift. Recent posts, role transitions, projects mentioned in their About — anything that proves you actually read their profile, not just their job title. ~2-3x reply rate vs generic openers in my data.
>
> **2. Ask one specific question, not a yes/no trap.**
> "Are you open to new opportunities?" is the recruiter equivalent of "Hope you're well" — it triggers an instant skim-and-delete. "How are you thinking about [specific challenge they mentioned]?" gets engagement because it invites a real answer.
>
> **3. Keep the opener under 90 words.**
> Not "as short as possible" — short enough to read on mobile in one screen. ~80 words is the sweet spot in everything I've tested.
>
> **4. Don't pitch in the first message.**
> Save the role/company specifics for the second sentence at the earliest. Open with the specific observation. Most outbound is "Hi [Name], we're hiring [Role]. You'd be a great fit. Want to chat?" — the ask comes too early and the personalization is too shallow.
>
> **5. Send the follow-up 2-3 days later, not 7.**
> By day 7 the original message is dead context. Three days is "I haven't gotten to it yet, this nudge is fine." Seven days reads as a sequence.
>
> I built a tool that bakes most of this into a prompt (riff.app — first 5 messages a week free) but honestly the ideas matter more than the tool. What's worked for you that isn't on this list?

**Why it works:** Pure value, single soft mention. Solicits feedback rather than commands a click.

### Angle 3 — Build-in-public post (week 3)

**Subreddit:** r/SaaS, r/SideProject, r/IndieHackers, r/Entrepreneur
**Title:** [Show] I built a Chrome extension that drafts personalized LinkedIn outreach. Looking for brutal feedback before launch.
**Body:**

> Hi all — solo founder, no audience, no LinkedIn presence. I've spent the last few weeks building a Chrome extension called Riff that drafts personalized cold-outreach messages for recruiters by reading the LinkedIn profile they're already viewing. Three variants per call (cold opener, follow-up, breakup). Free tier is 5 messages a week.
>
> The wedge is supposed to be that incumbents (Apollo, Crystal, ContactOut, LinkedIn's native AI) all do shallow personalization — they pull job title and company and sprinkle them into a template. I've baked an anti-template phrase blacklist into the prompt and three few-shot examples that anchor the model toward conversation-starter framing.
>
> Honest assessment of what I'm worried about:
>
> 1. **Crowded category** — Waalaxy has 100K installs at €19. LeadPilot is $9 with similar feature. Am I priced out at $39?
> 2. **Output drift** — even with the blacklist, I'm sure the model occasionally produces template-y output. How would I notice?
> 3. **TOS surface** — I'm passive-read only (no automation, no auto-send) which I think keeps me safe, but LinkedIn's enforcement landscape has me jumpy.
> 4. **Distribution** — no audience. Cold email + Reddit + paid ads. Is that enough for $5K MRR in 90 days, or am I delusional?
>
> Free tier is at riff.app if you want to actually try it. More interested in your read on the strategy though — what would you do differently?

**Why it works:** Honest builder voice. Asks real questions instead of pitching. Indie/SaaS subreddits eat this up if you stay genuine.

---

## 2. Product Hunt launch kit

### Tagline (60 char max)
> Drafts LinkedIn outreach that doesn't read like a template.

### Description (260 char)
> 3 personalized message variants per LinkedIn profile, grounded in the candidate's actual recent activity. Cold opener, follow-up, breakup — all in 15 seconds. No automation. No bans. Anti-template guardrails baked into the prompt. From $39/mo.

### Topics
> AI Productivity, Sales, Recruiting Tools, Chrome Extensions, Marketing Automation

### First-comment template (post 5min after launch goes live)
> Hi everyone — Riff's solo founder here.
>
> A bit of context on why this exists: I kept getting LinkedIn messages from recruiters that all sounded the same — "I came across your impressive background... would be a great fit... looking forward to hearing from you." Same five sentences, slightly shuffled. Apollo, Crystal, ContactOut, even LinkedIn's own AI all produce the same pattern because they pull static profile fields and sprinkle them into a template.
>
> Riff goes after the actual problem: it reads the profile you're viewing (including a recent post you can paste), and uses Claude with a prompt that has every dead phrase hard-banned and conversation-starter framing baked in. You get three variants per call (cold + follow-up + breakup) so your whole sequence is ready in 15 seconds.
>
> Two things that make me nervous to launch:
>
> 1. The category is crowded (Waalaxy, Apollo, LeadPilot all in this space). My bet is that recruiters care more about output quality than feature breadth — that's the wedge.
> 2. I'm passive-read only. No automation. That keeps me TOS-safe, but means I can't do the auto-send tricks the bigger tools do. Tradeoff I'm comfortable with.
>
> **For PH community: 30% off Pro for 3 months with code RIFFPH.** Free tier is 5 messages a week, no card.
>
> I'd love brutal feedback. Especially: if your messages have ever read like spam to *you*, what made you stop and rewrite?

### Image gallery (5 screenshots needed)
1. **Hero shot** — popup with detected profile + pitch input + 3 generated variants (1280×800)
2. **Side-by-side** — generic template message vs Riff's output, identical input (1280×800)
3. **Tone selector** — popup showing the warm/direct/cheeky dropdown, with one example output for each (1280×800)
4. **Reply tracking panel** — the stats grid showing per-tone reply rates after a few weeks of use (1280×800)
5. **Sales Nav variant** — popup running on a Sales Navigator profile (proves multi-surface) (1280×800)

### Hunter list (build in 2 weeks before launch)
- Comment genuinely on 30 PH launches in the AI/Productivity/Sales categories
- Reach out to 3 hunters with 50+ launches who hunt B2B tools, ask if they'd hunt Riff
- Apply to be hunted via PH's hunter network

---

## 3. Cold email A/B variants (beyond the 4-touch sequence)

The four-touch sequence in DISTRIBUTION.md is the baseline. A/B test these subject lines and openers in week 2-3 once you have ~150 messages out and can measure differences.

### Subject line variants
Test each against the baseline ("cold-outreach prompt (recruiting)"):

| Variant | Why |
|---|---|
| `quick recruiter Q: what's your reply rate looking like?` | Question-form, opens-rate spike |
| `the LinkedIn opener you keep using is dead` | Bold/contrarian, polarizes (good for testing) |
| `built this for {firm_name}-type agencies` | Personalized firm name — pure curiosity |
| `5 free InMail rewrites for {first_name}` | Concrete value-first |
| `replacing "I came across your impressive background"` | Specific phrase the recipient knows |

### Opener variants for Email 1 (test against baseline)

**Variant A — Founder voice (recommend testing first):**
> Hey {first_name} — saw {firm_name} on a recruiter directory and wanted to send this directly: I built a Chrome extension that drafts personalized cold-outreach LinkedIn messages by reading the candidate's actual profile + recent posts. It's $39/mo, 5 free a week to try, and the prompt has every "I came across your impressive background"-style phrase hard-banned.
>
> Riff.app if you want to test it on a candidate today. Even if it's not the right fit — what's the most painful part of your sourcing workflow right now?

**Variant B — Question-first:**
> {first_name} — quick recruiter question: when you write a cold message, do you have a personal template you reuse, or do you start from scratch every time?
>
> I ask because I've been talking to agency recruiters in your space and the answer splits ~50/50, with the template-reusers reporting much lower reply rates. I built a tool that lets you skip the tradeoff (riff.app — free trial). Curious to hear how you do it.

**Variant C — Pattern-recognition / contrarian:**
> {first_name} — every recruiter cold message I've gotten in the last 6 months opens with one of: "I came across your", "Saw your impressive background", or "Hope you're doing well". I assume yours don't, but I'm curious.
>
> I built a Chrome extension that bans these phrases at the prompt level and references something specific from the candidate's recent posts instead. Free trial at riff.app — would love your read on the output if you have 60 seconds.

### What to measure per variant
- **Open rate** (subject line lift)
- **Reply rate** (opener lift)
- **Trial install rate** (CTA strength)
- **Trial-to-paid rate** (whether the right ICP showed up)

Run each variant with a 50-recipient sample. Pick the winner after 100+ sent across both. Don't run all variants at once — change one variable at a time.

---

## 4. Loom voiceover script (60 seconds)

Record once, use as: landing page hero, Web Store gallery, Product Hunt embedded video, TikTok organic, cold email Touch 4.

**Setup:** screen capture of LinkedIn → Riff popup → generated message. Voice over the whole thing, then trim.

**Script (~150 words, ~60 seconds at 150 wpm):**

> Most cold outreach on LinkedIn reads the same. *I came across your impressive background.* *Would be a great fit.* *Looking forward to hearing from you.* Same five sentences, slightly shuffled. Candidates clock it in two seconds.
>
> [Cursor on a real LinkedIn profile]
> Riff is a Chrome extension that draft messages that *don't* read like a template.
>
> [Click Riff icon → popup opens, profile auto-detects]
> It reads the profile you're already viewing — name, headline, current role. You can paste a recent post for deeper personalization.
>
> [Type a one-sentence pitch]
> One sentence about what you're hiring for. Pick a tone — warm, direct, cheeky.
>
> [Click Generate, three variants render]
> In about ten seconds you get three drafts: cold opener, follow-up, breakup. Each one is grounded in something specific from the profile, with a phrase blacklist that bans the dead corporate template language.
>
> [Click "Mark sent"]
> Track replies right in the extension to see which tones actually convert.
>
> Five free messages a week. Riff dot app. No card.

**Production notes:**
- Cut between voice and screen capture — never both at full volume
- Add captions auto-generated from the script (TikTok and Web Store viewers watch on mute)
- Keep cuts under 1.5 seconds — short attention span on every channel this video lands

---

## 5. Onboarding email sequence (5 emails over 14 days)

Triggered when a user signs up for the free tier. Goal: 12-18% trial-to-paid conversion. Send via Postmark, Resend, or Loops.so once configured in production.

### Email 1 — Welcome (sent immediately on signup)
**Subject:** Your Riff token (and the one thing to remember)
**From:** [your name] from Riff
**Body:**
> Hi {first_name},
>
> Your Riff account is live. Three things to know:
>
> 1. **Install the extension:** [Chrome Web Store link]
> 2. **Sign in:** Open Riff, paste this token: [their token]. (Always available in your dashboard at riff.app/dashboard.)
> 3. **The one thing to remember:** Riff is best when you paste a recent post the candidate wrote into the optional field. Profile alone gets you decent output. Profile + recent post gets you output that sounds like you actually read their work.
>
> You have 5 free generations this week. Reply to this email if you hit a snag — I read every reply.
>
> [Your name]
> Solo founder, Riff

### Email 2 — Use it once (sent 24h later if no generation yet)
**Subject:** A profile to test Riff on
**Body:**
> {first_name} — you signed up yesterday but haven't generated a message yet. Two minutes to try it:
>
> 1. Open any LinkedIn profile of a candidate you'd actually want to reach
> 2. Click the Riff icon in your toolbar
> 3. Type a one-sentence pitch ("Hiring an X for our Y team, comp Z")
> 4. Click Generate
>
> If it doesn't work or the output is bad, reply to this email and tell me what you put in. I want to know — output quality is the whole product.

### Email 3 — Power tip (sent day 4 if 2+ generations completed)
**Subject:** The biggest output-quality lever you're missing
**Body:**
> {first_name} — you've generated a few messages. If the output feels close-but-not-quite, try this:
>
> When you're on the candidate's profile, click their **Activity** tab and find the most recent post they wrote (within the last 60 days, ideally). Copy a sentence or two of the SUBSTANCE of what they argued. Paste it into the "Optional: paste a recent post" field in Riff before clicking Generate.
>
> The model goes from generic-but-personalized to specific-and-grounded. The before/after on the same candidate is visible in one read.
>
> Quick demo: [Loom link]

### Email 4 — Upgrade nudge (sent day 9, only to users at 3+ generations of free quota)
**Subject:** You're at {n}/5 this week
**Body:**
> {first_name} — you've used {n} of your 5 free generations this week. Two reasons to consider Pro:
>
> 1. **Unlimited generations** — most active users land between 30-80 messages a week. The free tier resets weekly but caps you fast.
> 2. **3 variants per call** instead of 1 — cold opener, follow-up, breakup, all in one generation. The follow-up alone usually pays for the month (most recruiters skip follow-ups because writing them feels like a chore).
>
> $39/mo, cancel any time, no annual commitment: [upgrade link]
>
> If $39 doesn't pencil out for your usage, reply and tell me what would.

### Email 5 — Office hours (sent day 14 to all free users still on free)
**Subject:** Office hours — 15 minutes, your sourcing workflow, nothing pushy
**Body:**
> {first_name} — I do 15-min calls with anyone who's tried Riff and wants to talk through what worked or didn't. The selfish reason is I learn what to build next. The unselfish reason is I'll tell you what's working for other recruiters using the tool.
>
> No demo, no pitch. Pick a time: [Calendly link]
>
> If now's not a good moment, the dashboard has your usage stats and a Pro upgrade if it makes sense — riff.app/dashboard.

### Conversion mechanics

| Email | Goal | Expected open / click |
|---|---|---|
| 1 (welcome) | First generation | 60% open / 40% click extension link |
| 2 (use it once) | Activate | 35% open / 12% generate first time |
| 3 (power tip) | Improve quality + retention | 45% open / 8% click loom |
| 4 (upgrade) | Trial-to-paid conversion | 40% open / 5-8% upgrade |
| 5 (office hours) | Customer interview pipeline | 30% open / 2-4% book a call |

Send via Resend ($0.10 per 1000 emails free up to 3K/mo). Tag every email with UTM params so you can trace conversion in PostHog.

---

## 6. ContactOut partnership pitch (separate from cold email — to send post-launch)

To send to: ContactOut's partnerships team email (typically `partners@contactout.com` or similar; check their contact page)

**Subject:** Recruiter integration: Riff drafts message after ContactOut finds the email

**Body:**
> Hi [partnerships team],
>
> Quick note from a builder in your category. I run Riff (riff.app), a $39/mo Chrome extension that drafts personalized LinkedIn cold-outreach messages for recruiters. We're at [N] paying users / $K MRR, growing through Reddit + paid + cold email.
>
> The natural integration: ContactOut finds the email. Riff drafts the message. Your users hit the same dead-end every time — "great, I have their email, now what do I write?" — and we're the layer that solves that.
>
> Concrete proposal:
>
> 1. After a ContactOut email reveal, optionally show a "Draft your message with Riff" CTA in your extension
> 2. Click → opens a Riff popup with the candidate context pre-filled
> 3. Revenue share: 20% of any Riff subscription that originates from ContactOut for life of the customer
>
> No upfront cost to ContactOut. No engineering ask except the CTA. We do the integration work on our side.
>
> If this is interesting, I'm happy to do a 20-min call. Worst case you tell me to go away — I'll respect that. Best case we both get a stickier product.
>
> Founder, Riff
> [your email] · riff.app

**Why ContactOut, specifically:** 1.4M installs vs our 0. They have the budget-share with recruiters. They don't draft. The integration is a single button on their side, a few hours of work for both teams. Highest-leverage single bet in the playbook.
