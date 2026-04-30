# Chrome Web Store submission — Riffly v1.0.0

Everything you need to copy-paste into chrome.google.com/webstore/devconsole. Read top-to-bottom while submitting.

---

## Step 1 — Sign in & pay $5 (one-time)

1. Open https://chrome.google.com/webstore/devconsole/?authuser=2 (signed in as **contactus@rifflylabs.com**).
2. If this is the first time on a Google account, Google charges a **one-time $5 developer fee**. Pay it.
3. Accept the Developer Program Policies.

> If contactus@ doesn't already have a dev account and you don't want to pay $5 again, you can use bassdevil87@gmail.com instead — the listing's *displayed* publisher is set separately and will still say "Riffly Labs."

---

## Step 2 — Upload the package

1. Click **+ Add new item**
2. Drag-drop this file:
   ```
   /Users/srulypikarsky/Library/Application Support/Claude/local-agent-mode-sessions/c5d3e72f-4128-4455-83db-7a63d2d5137f/2b9c6cb2-ad91-4933-b2ad-87f14f87e4e6/local_1eb4b77c-5296-415c-9154-cc2ebf0da1dd/outputs/riff/riffly-extension-1.0.0.zip
   ```
3. Wait for the manifest validation (should pass — we patched it).

---

## Step 3 — Fill in the Store listing tab

### Name (75 char max)

```
Riffly — Personalized Outreach Drafts
```

### Summary (132 char max)

```
Turn any LinkedIn, GitHub, or Wellfound profile into a personalized cold-message draft. Drafting assistant — never automated.
```

### Description (16,000 char max — paste the whole block below)

```
Riffly drafts cold outreach that doesn't read like every other "I came across your profile" message in their inbox.

Open a candidate's LinkedIn, GitHub, or Wellfound profile, click the Riffly icon, and get three personalized message variants grounded in what they actually wrote — not a Mad Lib of "great fit" and "exciting opportunity."

You review every draft before you send it. Riffly never auto-sends, never connects to your LinkedIn account, and never queues messages in the background. It's a writing assistant — the keyboard is still yours.

WHO IT'S FOR
Technical recruiters at startups who refuse to send templates. Founders who hate the cold-email tone. Anyone tired of getting back the same generic pitch they got from the last fifteen recruiters.

WHAT IT DOES
• Reads the profile in front of you (only the profile you're currently viewing — never crawls in the background)
• Generates 3 message variants tuned to your pitch, tone (warm / direct / playful), and length
• Refuses to use the cliché phrases that get cold messages archived ("leverage," "great fit," "circle back," "world-class," and ~30 more)
• Saves your job specs so it knows what you're hiring for across visits
• Optional: train it on 5–10 of your past messages so drafts come out in your own voice (Pro)
• Optional: track saved searches and get a daily email digest of new high-fit candidates (Plus)

WHAT IT DOESN'T DO
• No automation. Riffly never sends, queues, or schedules messages.
• No LinkedIn login. Riffly doesn't store your credentials or run as your account.
• No background scraping. We only read the profile page you've actively opened.
• No selling your data. Profile snapshots and drafts are kept for 30 days for debugging only, then deleted.

PRICING
• Free — 5 drafts a week, all features unlocked. No credit card.
• Pro ($14.99/mo) — Unlimited drafts, voice fingerprint, draft history.
• Plus ($19.99/mo) — Everything in Pro plus saved-search tracking, daily candidate digest, active profile fit-scoring.

PRIVACY
We use Anthropic's Claude API to generate drafts. Your profile snapshot and pitch are sent there, processed, and returned. Full privacy policy at rifflylabs.com/privacy. Sub-processors, retention, and your rights all listed.

QUESTIONS
contactus@rifflylabs.com — usually replied within a day.
```

### Category

**Productivity**

(Alternative: "Social & Communication" — Productivity is the better fit because the buyer thinks of this as a writing tool, not a social tool.)

### Language

**English**

---

## Step 4 — Privacy practices tab

This is where most extensions get rejected. Be honest and specific.

### Single purpose

```
Generate personalized outreach message drafts from a viewed candidate profile.
```

### Permissions justification

| Permission | Justification |
|------------|---------------|
| `activeTab` | Read the currently open profile page when the user clicks the Riffly icon. Required for the core drafting feature. |
| `storage` | Save user preferences (tone, length, language, signature) and cache job specs locally so the user doesn't re-enter them every visit. |
| `alarms` | Power the background "overdue saved-search" badge that shows on the toolbar when tracked candidate searches need to be re-scanned. |
| Host permissions on linkedin.com, github.com, wellfound.com, angel.co | Read the profile content when the user is viewing one of these sites and clicks the Riffly icon. Riffly does NOT crawl or scrape in the background — it only runs when invoked by the user on the active tab. |
| Host permission on rifflylabs.com | Allow the dashboard at rifflylabs.com/dashboard to communicate with the extension (e.g., to push job-spec updates from the web dashboard back to the extension). |

### Data collection disclosure

Tick these and explain in the text box:

- ☑ **Personally identifiable information** — "Email address used to identify the user's account."
- ☑ **Authentication information** — "Supabase JWT, used only to authorize API calls back to Riffly's backend."
- ☑ **Personal communications** — "The contents of generated draft messages are stored for 30 days for debugging."
- ☑ **User activity** — "Counts of generations and feature usage are logged for billing."
- ☑ **Website content** — "The profile snapshot from the page the user is actively viewing is sent to Riffly's backend for draft generation."

Then check the three certifications:

- ☑ I do not sell or transfer user data to third parties for purposes unrelated to the item's single purpose.
- ☑ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ☑ I do not use or transfer user data for the purpose of determining creditworthiness or for lending purposes.

### Privacy policy URL

```
https://rifflylabs.com/privacy
```

---

## Step 5 — Visibility & distribution

- **Visibility:** Public
- **Distribution:** All regions (default)

You can change this later. For first launch, go public — the whole point is people can find and install it.

---

## Step 6 — Graphic assets you still need to create

The Web Store will block submission until you upload screenshots. There's no way around this and I can't create them — they need to be real screenshots of the extension in action.

**Required:**
- **At least 1 screenshot** at **1280 × 800** OR **640 × 400** (PNG / JPG)
- Recommended: 3–5 screenshots so the listing looks legit

**Optional but recommended:**
- Small promo tile: **440 × 280** (boosts placement in Web Store search)
- Marquee promo tile: **1400 × 560** (only used if Google features your extension)

### How to take the screenshots

1. Load the extension locally first to verify it works:
   - Chrome → chrome://extensions
   - Toggle "Developer mode" on (top right)
   - Click "Load unpacked" → select the `riff/extension/` folder
2. Visit a real LinkedIn profile (your own works fine — pick one with a recent post).
3. Click the Riffly icon to open the popup.
4. Take screenshots of:
   - **Screenshot 1** — popup open, draft generated, with the candidate's profile visible behind it
   - **Screenshot 2** — three variants visible, showing tone/length pills
   - **Screenshot 3** — saved searches panel (or job specs panel)
   - **Screenshot 4** — the dashboard at rifflylabs.com/dashboard
   - **Screenshot 5** — a specific cliché-flagged moment if you can stage one
5. Crop / resize each to exactly 1280 × 800. macOS Preview can do this: Tools → Adjust Size.

For the **promo tile (440 × 280)**, take an existing screenshot, add the Riffly wordmark from `/brand/riffly-wordmark.svg` overlaid in the corner, save as PNG.

---

## Step 7 — Submit for review

1. Click **Submit for review** (top right)
2. Estimated review time: 1–3 days for first submission, sometimes hours for accounts with prior approvals.
3. Google will email you when it's approved or rejected.

If rejected, the email tells you why. The most common reasons are:
- Permission justifications too vague
- Privacy policy doesn't address something the manifest declares
- Screenshots show test data / placeholder text

---

## Pre-submission checklist

- [ ] $5 dev fee paid
- [ ] Extension zip uploaded, manifest validated
- [ ] Name, summary, description filled in
- [ ] Category set to Productivity
- [ ] Privacy practices tab fully filled
- [ ] Privacy policy URL set to https://rifflylabs.com/privacy
- [ ] At least 1 screenshot uploaded
- [ ] Visibility set to Public
- [ ] Submit for review clicked

---

## What happens after approval

- Listing goes live at `chrome.google.com/webstore/detail/[your-extension-id]`
- Update `/signup` banner from "in review" to "live" (small Edit on `backend/src/pages/signup.tsx` or wherever that string lives)
- Update landing page "Add to Chrome" button to point at the live URL
- Tweet / LinkedIn post the launch
