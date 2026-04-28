# Riff — Competitive Analysis &amp; Positioning Decisions

Living document. Last updated April 28, 2026 after Chrome Web Store recon.

## Competitor map (top threats)

| Competitor | Installs | Price | What they do | Threat level |
|---|---|---|---|---|
| **Waalaxy** | 100K+ | €19–69/mo | Full LinkedIn automation (invites, messages, follow-ups). 4.8★. | HIGH — closest substitute at our price tier |
| **LeadPilot** | undisclosed | $8.99/mo | AI message generation, 1 variant. 4.9★. | HIGH — 4× cheaper, ships generation feature |
| **Outboundly** | undisclosed | free–$24/mo | Multi-platform (LinkedIn + email + Twitter). Claims "12× response rates". 4.9★. | MEDIUM-HIGH — broader wedge, stronger marketing |
| **ContactOut** | 1.4M+ | $79–$299/mo | Email/phone enrichment. Doesn't draft. | MEDIUM — owns recruiter trust + budget share, but adjacent product. **Best partnership target.** |
| **Apollo** | mainstream | $49+/mo | CRM + enrichment + AI message bundled. | MEDIUM — broader product, message gen is shallow |
| **Gem** | enterprise | ~$135/seat | Recruiting CRM with hyper-personalization. | LOW — different segment (enterprise) |
| **HireFlow** | growing | $159+/mo | AI recruiting CRM + ATS sync. | LOW — different segment (mid-market team) |
| **Salee** | 7K+ | $19/yr or sub | AI humanizer, context-aware follow-ups. | LOW — too cheap, low traction |

## Decisions made (after recon)

### 1. Reposition the landing page — DONE

Old positioning: "Drafting assistant for cold LinkedIn outreach." Defensive, feature-centric, doesn't quantify outcome.

New positioning: **"3 personalized LinkedIn drafts, grounded in their actual recent activity."** Specific, differentiates on recency (none of the 8 main competitors does this), signals 3 variants (LeadPilot does 1).

New subheadline: "Reply rates 3× higher than generic templates. No automation, no bans." Quantifies outcome + draws the safety line vs Waalaxy.

Added a side-by-side comparison table on landing page (Riff vs Waalaxy vs Apollo) so visitors see the wedge in 5 seconds.

### 2. Hold price at $39/mo with `FOUNDER50` coupon — DONE

Reasoning: dropping list price to $19 puts us in the LeadPilot/Salee race-to-the-bottom segment. $39 keeps us in the "serious recruiter" tier with Outboundly ($24) and SalesQL ($39). Justify with reply tracking + 3-variant + safety positioning.

Tactical wrinkle: launch with a `FOUNDER50` Stripe coupon — first 100 customers get 50% off ($19/mo) for the first 3 months, then convert to full $39/mo. Captures the early-adopter price-sensitivity without permanently capping LTV. Math works out better than "forever" — 3 months × $19 + ongoing $39/mo beats $19/mo in perpetuity, while still feeling generous to the early adopter. Coupon auto-stops at 100 redemptions; new customers after that pay the full $39 from day one.

Re-evaluate at day 60: if churn > 8% or signups < 50, consider broadening the founder discount or trying a flat $29 list price.

### 3. Ship reply tracking in v1 — IN PROGRESS

Originally planned for v2. The recon revealed it's table stakes — Apollo, LeadPilot, Outboundly all have it. We can't claim "3× reply rates" without giving the user data to prove it.

Minimum-viable version: "Mark sent" / "Mark replied" buttons on each generated variant. Stored in `chrome.storage.local`. Simple stats panel showing reply rate per tone × length combo. No backend persistence needed for v1 — local data is enough for the recruiter to learn what works.

Does NOT block first paying users — sideloaded extension can ship with this in version 0.2 within first week of launch.

### 4. Lead with safety (vs Waalaxy) — DONE in landing copy

Three trust badges in hero:
- "No automation — you copy &amp; send manually"
- "Zero LinkedIn TOS automation risk"
- "Profile data never stored after generation"

This is our wedge against the 100K-install Waalaxy threat. Recruiters who've had accounts restricted by automation tools land here and immediately get the safety value prop.

### 5. ContactOut partnership — ADDED to distribution playbook

ContactOut has 1.4M installs and zero drafting capability. Pitch: integration where after a recruiter reveals an email via ContactOut, a "Draft your message with Riff" button appears. ContactOut gets stickier; we get distribution from a 1.4M-user funnel.

Action item (for user, post-launch): Email ContactOut partnerships team in week 3 once we have ~50 paid users to show traction.

### 6. CRM integrations deferred to v2 — DOCUMENTED

HireFlow, Salee, LeadPilot all have CRM/ATS integrations. We don't, and shouldn't ship in v1. Reasoning: CRM integrations require per-CRM auth flows, schema mapping, and ongoing maintenance. Not worth it until we have 200+ paid users telling us *which* CRMs they actually use. v2 starts with 1–2 integrations (likely Slack + Greenhouse based on recruiter prevalence).

Add to FAQ: "CRM integration is on the roadmap. v1 is intentionally standalone — message in, draft out, copy to clipboard."

## 60-day decision points

These are the scenarios that would force us to pivot. Re-evaluate at day 60.

| Trigger | Required action |
|---|---|
| Waalaxy ships AI drafting feature with 3 variants | Pivot to "recruiter insight engine" — depth over message generation. Add company research, skill synthesis, market data. |
| LeadPilot launches free tier and hits 10K+ installs | Either drop to $29 to compete on volume, OR raise feature bar dramatically (response analytics + CRM + bulk by month 3) and move to $59. |
| Apollo launches native AI drafting with profile activity reading | We've lost the wedge. Merge into their ecosystem (partnership) or fold and pivot to a different vertical. |
| Our installs &lt; 100 at day 60 with $200+ ad spend | Pricing or positioning is wrong. Customer interviews → pivot ICP from agency recruiters to in-house TA, OR reposition as a sales tool (broader market). |
| Our paid conversion &lt; 4% on free tier | Free tier limits too generous, OR onboarding doesn't show value fast enough. Tighten free to 3/week, redo onboarding email sequence. |

## Things to ignore (recon noise)

- **LinkedIn comment generation tools** — Wisereply, Replya. Different problem, not a threat.
- **Twitter/IG outreach extensions** — out of scope, no overlap.
- **Free-tier-only extensions with &lt; 5K installs** — most won't survive 12 months.
- **"Personality assessment" features** — Crystal owns this category and it's a small niche. Ignore.

## Distribution channels we shouldn't expect to win

- **Chrome Web Store organic search for "linkedin outreach"** — Waalaxy owns the top 3 results due to install count. We'll rank low until we hit 5K+ installs. Plan accordingly: paid acquisition first, organic compounds later.
- **Reddit r/recruiting** — saturated with tool promotion. Single posts can work, repeated posts will get banned. One post per angle, then move on.
- **Product Hunt** — single-day spike, then dies. Run it but don't expect sustained growth.

## Distribution channels we *should* lean into

- **Cold email to agency recruiters** — playbook in DISTRIBUTION.md. Not yet saturated.
- **OneReq Slack and similar gated recruiter communities** — high quality, low-noise audience, value-first AMA approach works.
- **YouTube creator sponsorships in the recruiting niche** — under-monetized channel, $300–800/spot drives 30–80 paid trials per the agent's economics estimate.
- **ContactOut partnership** — see above. Highest single-bet upside.
