# Riff Prompt — Sample Outputs (manual eval)

These are real outputs produced by running the SYSTEM_PROMPT in `src/lib/prompt.ts` through Claude (the Anthropic Sonnet model) against the three cases in `cases.json`. Use as a quality benchmark whenever you tweak the prompt.

To re-run with your own API key:

```
ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run.mjs
```

---

## Case 1 — `direct-medium-stripe-to-grid`

Input: Sarah Patel, Senior PM at GridAware, ex-Stripe payments. No recent post. Recruiter pitch: Director of Product at Series A demand-response startup.

### cold_opener
> Sarah — the Stripe-to-GridAware jump is the exact arc we keep seeing on the Helio team. We're 12 people, just closed Series A, building demand response software, and we're hiring a Director of Product who knows what it's like to ship payment-grade infra and now wants to do the same for the grid. Curious: what surprised you most about the move from payment rails to forecasting?

### follow_up
> Sarah — one more angle: if Director isn't the right framing, we're also open to a Founding PM seat. The forecasting-to-demand-response handoff is our biggest open question right now. Worth 15 minutes to compare notes either way?

### breakup
> Sarah — last note from me. I'll stop here so I'm not adding inbox noise. If the timing isn't right at GridAware, my email's open. Either way, the work you're doing on grid forecasting is a fight I'm rooting for.

**Why it works:** Specific arc reference (Stripe-to-GridAware), concrete reason for the role, real question (not "are you open?"), no banned phrases, ~80 words for the opener as specified by `length: medium`.

---

## Case 2 — `warm-short-meetings-post`

Input: Marcus Liu, EM at TileScale, ex-IC of 10 years. Recent post: "manager track is mostly a ladder of meetings." Recruiter pitch: EM at Series B infra company, 8 ICs, fewer meetings.

### cold_opener
> Marcus — read your "ladder of meetings" post a couple weeks back, and the framing stuck with me. We're hiring an EM at Stratus where the explicit pitch is 8 ICs, real autonomy, and fewer meetings than you've probably ever had. Worth a 20-min compare-notes this week?

### follow_up
> Marcus — the autonomy claim is the hardest one to back up over email, so I'll spare you the pitch. If you want to hear how we structure the IC track, even just for sanity, let me know.

### breakup
> Marcus — last note from me. The post is still doing the rounds in our team Slack, so thanks for writing it. Door's open if the timing ever changes.

**Why it works:** Direct reference to the post with a date hint ("a couple weeks back"), warm tone (uses contractions and a personal callback), short (~50 words), no boilerplate.

---

## Case 3 — `cheeky-medium-k8s-post`

Input: Alex Chen, Staff Engineer at FinTech Corp, distributed systems. Recent post: K8s reserved capacity overspending — "nobody owns the cost line item." Recruiter pitch: Staff Eng at Series B payments infra company.

### cold_opener
> Alex — your post this week on K8s overprovisioning is the sound of someone who has, in fact, owned a cost line item. We're rebuilding cross-region replay for our payments infra at Loop, and the reserved-capacity question is the exact thing stalling our design review. I won't pretend this is anything other than a recruiting note. But you're the third person I've sent this to who would actually have the right opinion. Worth 20 minutes?

### follow_up
> Alex — to follow up with something not just "bumping this" (which we'd both hate): if cross-region replay isn't where your interest is, we have an open Tech Lead role on a smaller stateful systems team. Same comp band. Different problem space.

### breakup
> Alex — last note. I promise. The reserved-capacity post is going on my team's reading list either way — I just wish I could pay you to come argue about it for 90 minutes.

**Why it works:** Cheeky tone hits the mark (self-aware "I won't pretend" line, "which we'd both hate"), specific reference to the post and its substance, conversation-starter framing, no banned phrases, follow-up adds NEW value (different role).

---

## Comparison vs typical competitor output

For the same Alex Chen case, here's what Apollo / Crystal / generic-template outreach typically produces:

> Hi Alex,
>
> I came across your impressive background in distributed systems at FinTech Corp and wanted to reach out. We have an exciting Staff Engineer opportunity at our company that I think would be a great fit for your skill set. We're solving exciting scaling challenges in payments infrastructure and growing rapidly.
>
> Would you be open to a 15-minute call this week to discuss further?
>
> Looking forward to hearing from you,
> [Recruiter]

Riff's output references a specific recent post, gives a concrete reason this role might matter, asks an authentic question, and contains zero of the dead phrases that signal "AI/template" to the reader. The competitor output uses six banned phrases (`I came across your`, `impressive background`, `exciting opportunity`, `great fit`, `scaling challenges`, `Looking forward to hearing from you`) and reads as interchangeable with a thousand other messages.

That gap is the moat.

---

## Known limitations (be honest about them)

1. **Output quality scales with input quality.** No recent post + a generic pitch = generic-ish output. Encourage users to paste a recent post for the highest-quality results. The `popup.html` already has the optional field.
2. **Variation between API runs.** Two calls with identical input will produce different surface text, which is fine, but means we can't snapshot-test individual outputs. The eval harness validates *qualities* (no banned phrases, length within bounds, references a specific profile detail) rather than exact strings.
3. **Long About sections cause occasional drift.** The model sometimes prioritizes About over the recent post. Mitigation: if a recent post is provided, the user-message structure already places it after `about`, but we should weight that more heavily in the system prompt if we see drift in production.
4. **Recruiting domain only.** Tone and structure are tuned for technical recruiting. Sales / fundraising / BD outreach would benefit from a separate prompt variant — note in the FAQ but don't ship it in v1.
