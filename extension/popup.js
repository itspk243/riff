// Riffly popup logic.
// Profile read, categorize, adapt templates, generate, render, reply tracking, stats.
// Auth is a paste-token model: user copies token from rifflylabs.com/dashboard.

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEYS = {
  token: 'riff_token',
  backend: 'riff_backend_url',
  events: 'riff_events',
};

// ---------- helpers ----------

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function setStorage(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupportedProfile(url) {
  if (!url) return false;
  if (/^https:\/\/www\.linkedin\.com\/(in|sales\/lead|talent\/profile)\//.test(url)) return true;
  const ghMatch = url.match(/^https:\/\/github\.com\/([^\/?#]+)\/?(?:[?#].*)?$/);
  if (ghMatch && !/^(orgs|settings|features|pricing|enterprise|about|topics|trending|new|notifications|issues|pulls|search|marketplace|sponsors|explore|login|join|nonprofit)$/i.test(ghMatch[1])) {
    return true;
  }
  if (/^https:\/\/(?:www\.)?wellfound\.com\/(?:u|profile|p)\//.test(url)) return true;
  if (/^https:\/\/angel\.co\/u\//.test(url)) return true;
  return false;
}

function surfaceLabel(surface) {
  switch (surface) {
    case 'sales_navigator': return 'Sales Navigator';
    case 'linkedin_recruiter': return 'LinkedIn Recruiter';
    case 'linkedin_profile': return 'LinkedIn profile';
    case 'github': return 'GitHub profile';
    case 'wellfound': return 'Wellfound profile';
    default: return 'Profile';
  }
}

// ---------- profile categorization ----------
//
// We bucket the candidate into one of seven categories from headline + role text.
// The purpose × category combo decides which pitch templates to surface.

function categorizeProfile(profile) {
  const text = [profile.headline, profile.currentRole, profile.about].join(' ').toLowerCase();
  if (!text.trim()) return 'other';
  // Multilingual: English plus DE / FR / ES / PT / IT / NL keywords for the
  // common roles in each category. Mirrors the language list the popup offers.
  if (/\b(co-?founder|founder|ceo|cto|chief executive|chief technology|chief product|chief operating|coo|fundador|fundadora|fondateur|fondatrice|gr[uü]nder|gr[uü]nderin|oprichter|oprichtster|fondatore|fondatrice)\b/.test(text)) return 'founder';
  if (/\b(designer|design lead|head of design|product design|ux|ui|brand designer|illustrator|art director|creative director|dise[ñn]ador|dise[ñn]adora|grafico|grafica|gestaltung)\b/.test(text)) return 'designer';
  if (/\b(product manager|head of product|director of product|group product|principal pm|senior pm|associate pm|\bpm\b|product owner|gestor de producto|chef de produit|cheffe de produit|produktmanager|produktmanagerin|product[\s-]?manager)\b/.test(text)) return 'pm';
  if (/\b(engineer|developer|programmer|swe|sde|sre|architect|tech lead|staff engineer|principal engineer|senior dev|backend|frontend|full[\s-]?stack|ios|android|ingeniero|ingeniera|ing[ée]nieur|ing[ée]nieure|ingenieur|ingenieurin|programador|programadora|sviluppatore|sviluppatrice|ontwikkelaar|ontwikkelaarster)\b/.test(text)) return 'engineer';
  if (/\b(account executive|sales|sdr|business development|\bbd\b|\bae\b|head of sales|chief revenue|cro|ventas|ventes|vertrieb|verkoop|vendite|comercial|commerciale|verkauf)\b/.test(text)) return 'sales';
  if (/\b(marketing|growth|seo|sem|content|brand|demand gen|mercadeo|mercadotecnia)\b/.test(text)) return 'marketing';
  return 'other';
}

// ---------- pitch template matrix ----------
//
// Templates pre-fill the pitch field. Brackets are placeholders for the user to fill in.
// Each entry: { label, template }

const TEMPLATES = {
  hire: {
    engineer: [
      { label: 'Senior engineer · Series A/B', template: 'Hiring a Senior/Staff [language] engineer at [Series A/B startup]. [Comp band] · [Remote/Hybrid] · scope is [area]. Reports to [the founding eng / CTO / Staff].' },
      { label: 'Open-source-friendly team', template: 'We\'re hiring at [Company], small infra team, OSS-friendly. Looking for someone who\'s shipped [language/area]. [Comp] + meaningful equity.' },
      { label: 'Tech lead (small team)', template: 'Tech Lead role at [Company]. Lead a [N]-person team. Stack: [stack]. [Comp band] · [Remote/Hybrid].' },
    ],
    designer: [
      { label: 'Senior product designer', template: 'Hiring a Senior Product Designer at [Series A/B startup]. [Comp band] · [Remote/Hybrid] · owns [surface]. Reports to [the founder / Head of Design].' },
      { label: 'Brand / marketing designer', template: 'Looking for a Brand Designer at [Company]. [Comp band] · [Remote/Hybrid]. Big scope across [website / brand system / launch assets].' },
      { label: 'Founding designer (early-stage)', template: 'Founding Designer role at [Company]. Pre-seed/Series A. [Equity range]. Direct line to founders. Owns [scope].' },
    ],
    pm: [
      { label: 'Senior PM', template: 'Hiring a Senior PM at [Series A/B startup]. Owns [area]. [Comp] · [Remote/Hybrid]. Reports to [the founder / VP Product].' },
      { label: 'Founding PM', template: 'Founding PM role at [Company]. [Stage]. [Equity range]. You\'d own [product surface] end-to-end.' },
      { label: 'Group PM / director', template: 'Director of Product / Group PM at [Company]. Manage [N] PMs, own [domain]. [Comp] · [Hybrid/Remote].' },
    ],
    founder: [
      { label: 'Co-founder / CTO ask', template: 'Looking for a [technical/business] co-founder for [domain]. I\'ve been building [progress so far]. [What I bring]. Want to chat about what you\'re working on?' },
      { label: 'Hiring you as exec', template: 'Considering bringing on a [VP X / Head of Y] at [Company]. [Stage] · [equity range]. Even a "no thanks" with a referral helps.' },
    ],
    sales: [
      { label: 'AE / Sr. AE', template: 'Hiring an AE / Senior AE at [Series A/B startup]. [Quota/comp]. [Industry/territory] · [Remote/Hybrid].' },
      { label: 'Head of Sales / VP', template: 'Head of Sales role at [Company]. [Stage]. Build the team from scratch. [Comp + equity].' },
      { label: 'SDR / BDR', template: 'SDR role at [Company]. [Quota/comp]. [Industry] · [Remote/Hybrid]. Path to AE in [N] months.' },
    ],
    marketing: [
      { label: 'Growth / demand gen lead', template: 'Hiring a Growth Lead at [Company]. [Series stage]. Own [paid / organic / lifecycle]. [Comp] · [Hybrid/Remote].' },
      { label: 'Senior content marketer', template: 'Senior Content role at [Company]. Own the [blog / SEO / brand voice]. [Comp band].' },
    ],
    other: [
      { label: 'Hiring (any role)', template: 'Hiring a [role] at [Company]. [Series stage]. [Comp] · [Remote/Hybrid].' },
    ],
  },
  refer: {
    _all: [
      { label: 'Casual referral · low stakes', template: 'Saw a [role] role at [Company] open — comp band looks like [X], [Remote/Hybrid]. Worth a peek? Not my role, just thought of you.' },
      { label: 'Referral with comp data', template: 'Came across a [role] opening at [Company]. [Comp band] · [Equity range] · [Remote/Hybrid]. Was on my radar so I\'m sharing — feel free to ignore.' },
    ],
  },
  network: {
    _all: [
      { label: 'Compare-notes / coffee', template: 'I work in similar territory ([brief context]). Open to a 20-min call to compare notes? No agenda.' },
      { label: 'Saw their work · curious', template: 'Saw your [post / project / work] on [topic] and have been thinking about [related angle]. Would love your read on it if you have 15 min.' },
      { label: 'Building in same space', template: 'Building something in [space] and your work on [X] keeps coming up in our research. Want to swap notes for 20 min?' },
    ],
  },
  ask: {
    _all: [
      { label: '15-min specific question', template: 'Stuck on [specific problem]. You\'ve shipped [related thing] — would value 15 minutes if you can spare it. One question, no agenda.' },
      { label: 'Pick their brain · context', template: 'Working through [problem / decision]. Read your [post / paper / talk] on [topic] and it\'s the closest take I\'ve seen. Could I pick your brain for 15 min?' },
    ],
  },
  advisor: {
    _all: [
      { label: 'Advisor ask · with equity', template: 'Looking for an advisor with deep [domain] experience. [Stage] · [equity grant range]. Specifically need help with [area]. Quick call to see if it\'s a fit?' },
      { label: 'Partnership intro', template: 'Building [thing]. We seem to overlap in [area]. Wondering if there\'s a partnership / mutual customer angle worth a 20-min call.' },
      { label: 'Advisor + intro request', template: 'I\'m starting [thing]. Could use an advisor connected to [domain / network]. [Equity range]. Even if it\'s not for you, would love an intro to someone who fits.' },
    ],
  },
};

function templatesFor(purpose, category) {
  const purposeMap = TEMPLATES[purpose] || TEMPLATES.hire;
  return purposeMap._all || purposeMap[category] || purposeMap.other || [];
}

function refreshTemplates(purpose, category) {
  const templates = templatesFor(purpose, category);
  const sel = $('#template');
  const hintEl = $('#template-hint');
  // Wipe existing options except the first
  sel.innerHTML = '<option value="">Custom — write your own</option>';
  templates.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.label;
    sel.appendChild(opt);
  });
  // Show category hint to help the user understand what's adapting
  hintEl.textContent = category && category !== 'other' ? `· detected: ${category}` : '';
}

// ---------- auth + plan ----------
//
// We hold a single in-memory snapshot of the user's plan so every UI surface
// (templates chip-row, reply-tracking buttons, quota label, plus-feature
// hints) can check capabilities without re-fetching. This is refreshed on
// popup open and after sign-in.

let currentPlan = null;        // 'free' | 'pro' | 'plus' | 'team' | null (signed out)
let currentEmail = null;
let freeWeeklyLimit = 3;       // Server-supplied; cached from /api/me response.

function isPaidPlan(plan) {
  return plan === 'pro' || plan === 'plus' || plan === 'team';
}
function hasSavedTemplates(plan) { return isPaidPlan(plan); }
function hasReplyAnalytics(plan) { return isPaidPlan(plan); }
function hasFollowUpLoop(plan)   { return isPaidPlan(plan); }
function hasPlusFeatures(plan)   { return plan === 'plus' || plan === 'team'; }

function refreshPlanBadge() {
  const badge = $('#plan-badge');
  if (!badge) return;
  if (!currentPlan) {
    badge.classList.add('hidden');
    return;
  }
  const labels = { free: 'Free', pro: 'Pro', plus: 'Plus', team: 'Team' };
  badge.textContent = labels[currentPlan] || currentPlan;
  badge.className = `plan-badge plan-${currentPlan}`;
  badge.classList.remove('hidden');
}

async function fetchMe() {
  // Fetch user plan + email + remaining quota. Returns null when signed out
  // or backend unreachable. Best-effort — UI degrades to "free" defaults
  // if this fails, and the next /api/generate call is the source of truth.
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'RIFF_ME' }, (resp) => {
      if (!resp || !resp.ok) return resolve(null);
      resolve(resp);
    });
  });
}

async function refreshAuthUI() {
  const { riff_token } = await getStorage(['riff_token']);
  if (riff_token) {
    $('#auth-section').classList.add('hidden');
    $('#auth-status').classList.remove('hidden');
    // Fetch plan + email. If the call fails (token expired, network), we
    // still show the status row but leave the badge hidden until the next
    // generation tells us the plan.
    const me = await fetchMe();
    if (me) {
      currentPlan = me.plan || 'free';
      currentEmail = me.email || null;
      if (typeof me.freeWeeklyLimit === 'number') freeWeeklyLimit = me.freeWeeklyLimit;
      $('#auth-email').textContent = currentEmail
        ? `${currentEmail.split('@')[0]}`
        : 'Signed in';
      // Show remaining-this-week up front (without waiting for a generation)
      // so free users see their limit before they spend a draft.
      if (currentPlan === 'free' && typeof me.remainingThisWeek === 'number') {
        const q = $('#quota');
        q.textContent = `${me.remainingThisWeek} / ${freeWeeklyLimit} free this week`;
        q.classList.toggle('urgent', me.remainingThisWeek <= 1);
      } else {
        $('#quota').textContent = '';
      }
    } else {
      // Signed in locally but server disagrees — could be expired token.
      $('#auth-email').textContent = 'Signed in';
      currentPlan = null;
    }
    refreshPlanBadge();
    refreshUsageChip(); // fire-and-forget; renders the "X drafts left" header pill
  } else {
    $('#auth-section').classList.remove('hidden');
    $('#auth-status').classList.add('hidden');
    currentPlan = null;
    currentEmail = null;
    refreshPlanBadge();
    const chip = $('#usage-chip');
    if (chip) { chip.classList.add('hidden'); chip.textContent = ''; }
  }
}

// Header usage chip — shows "X drafts left" with a color shift at 70%/90%.
// Sourced from /api/usage on every popup open. The /api/generate response
// also returns the same `usage` snapshot, so we update the chip after every
// generation without an extra round-trip — see updateUsageChipFromResponse.
function renderUsageChip(usage) {
  const chip = $('#usage-chip');
  if (!chip) return;
  if (!usage || usage.limit == null) {
    chip.classList.add('hidden');
    chip.textContent = '';
    return;
  }
  const pct = usage.limit > 0 ? usage.used / usage.limit : 0;
  const tier = pct >= 1 ? 'blocked' : pct >= 0.9 ? 'red' : pct >= 0.7 ? 'amber' : 'green';
  const colors = {
    green:   { bg: '#e3f0e9', fg: '#1a7a48', border: '#c1dfc9' },
    amber:   { bg: '#fbf0d9', fg: '#a05f15', border: '#e7d3a3' },
    red:     { bg: '#fdebd9', fg: '#b14a1a', border: '#e8c8a4' },
    blocked: { bg: '#fdebd9', fg: '#b14a1a', border: '#e8c8a4' },
  };
  const c = colors[tier];
  const remaining = usage.remaining ?? 0;
  const label = remaining === 0
    ? 'Limit reached'
    : `${remaining} draft${remaining === 1 ? '' : 's'} left`;
  chip.textContent = label;
  chip.title = `${usage.used} / ${usage.limit} used this ${usage.windowKind === 'weekly' ? 'week' : 'month'}` +
    (usage.resetsLabel ? ` · resets ${usage.resetsLabel}` : '');
  // amber/red/blocked tiers turn the chip into a one-click upgrade CTA.
  // Free → Pro, Pro → Plus, Plus → no upgrade target (just wait for reset).
  const upgradeTarget = (usage.plan === 'plus' || usage.plan === 'team')
    ? null
    : (usage.plan === 'pro' ? 'plus' : 'pro');
  const isUrgent = tier === 'amber' || tier === 'red' || tier === 'blocked';
  const clickable = isUrgent && !!upgradeTarget;
  chip.style.cssText = `display: inline-flex; align-items: center; padding: 2px 8px; margin-right: 6px; border-radius: 12px; font-size: 11px; font-weight: 600; background: ${c.bg}; color: ${c.fg}; border: 1px solid ${c.border}; cursor: ${clickable ? 'pointer' : 'help'};`;
  chip.onclick = clickable
    ? () => chrome.tabs.create({ url: `https://rifflylabs.com/dashboard?upgrade=${upgradeTarget}` })
    : null;
  chip.classList.remove('hidden');
}

async function refreshUsageChip() {
  try {
    const resp = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'RIFF_GET_USAGE' }, resolve)
    );
    if (resp && resp.ok && resp.usage) renderUsageChip(resp.usage);
  } catch {}
}

function updateUsageChipFromResponse(genResp) {
  if (genResp && genResp.usage) renderUsageChip(genResp.usage);
}

$('#auth-submit').addEventListener('click', async () => {
  const raw = $('#token-input').value.trim();
  if (!raw || raw.length < 20) {
    showToast("That doesn't look like a valid token. Copy it from your dashboard and try again.", 'error');
    return;
  }

  // Two accepted formats:
  //   riff_v1.<base64-json>   → bundle with access + refresh tokens (auto-refresh)
  //   eyJ…                     → bare JWT (legacy, expires in ~1hr)
  let access = raw;
  let refresh = null;
  if (raw.startsWith('riff_v1.')) {
    try {
      const b64 = raw.slice('riff_v1.'.length);
      const json = JSON.parse(atob(b64));
      if (json.a && json.r) {
        access = json.a;
        refresh = json.r;
      } else {
        showToast('Token bundle is missing fields. Copy a fresh one from your dashboard.', 'error');
        return;
      }
    } catch {
      showToast('Token bundle is corrupted. Copy a fresh one from your dashboard.', 'error');
      return;
    }
  }

  // Persist both tokens. The background worker uses riff_refresh to silently
  // mint new access tokens whenever the cached one expires — so the user
  // never has to re-paste again.
  await setStorage({ riff_token: access, riff_refresh: refresh });
  $('#token-input').value = '';
  await refreshAuthUI();
});

$('#signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  // Wipe both tokens so the next sign-in is clean.
  await setStorage({ riff_token: null, riff_refresh: null });
  await refreshAuthUI();
});

// Production backend URL. Override only for local dev:
//   chrome.storage.local.set({ riff_backend_url: 'http://localhost:3000' })
const DEFAULT_BACKEND_URL = 'https://rifflylabs.com';

$('#signup-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const { riff_backend_url } = await getStorage(['riff_backend_url']);
  const base = riff_backend_url || DEFAULT_BACKEND_URL;
  chrome.tabs.create({ url: `${base}/signup` });
});

// Primary sign-in path: open the dashboard in a new tab. The dashboard-bridge
// content script auto-handoffs the token back into the extension, so by the
// time the user re-opens this popup they're signed in. Friction-free for
// non-technical recruiters who don't know what a "token" is.
const signinBtn = $('#auth-signin-btn');
if (signinBtn) {
  signinBtn.addEventListener('click', async () => {
    const { riff_backend_url } = await getStorage(['riff_backend_url']);
    const base = riff_backend_url || DEFAULT_BACKEND_URL;
    chrome.tabs.create({ url: `${base}/dashboard?from=ext` });
    // Close the popup so the user's attention follows the new tab. Chrome
    // will reopen it next time they click the toolbar icon.
    window.close();
  });
}

// Dashboard / billing link — central place to upgrade, manage subscription,
// or copy a fresh token. Only wired when authed (the row is hidden otherwise).
const dashboardLink = $('#dashboard-link');
if (dashboardLink) {
  dashboardLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const { riff_backend_url } = await getStorage(['riff_backend_url']);
    const base = riff_backend_url || DEFAULT_BACKEND_URL;
    chrome.tabs.create({ url: `${base}/dashboard` });
  });
}

// ---------- profile load ----------

let currentProfile = null;
let currentCategory = 'other';

async function loadProfile() {
  const tab = await getActiveTab();
  const card = $('#profile-card');
  const stateBox = $('#profile-state');
  const generateBtn = $('#generate');

  if (!tab || !isSupportedProfile(tab.url)) {
    stateBox.querySelector('.hint').textContent =
      'Open a candidate profile (LinkedIn, GitHub, or Wellfound) and reopen Riffly.';
    card.classList.add('hidden');
    generateBtn.disabled = true;
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'RIFF_EXTRACT_PROFILE' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        stateBox.querySelector('.hint').textContent =
          'Could not read this profile. Refresh the page and reopen Riffly.';
        card.classList.add('hidden');
        generateBtn.disabled = true;
        return resolve(null);
      }
      const p = resp.profile;
      $('#p-name').textContent = p.name || '(name not detected)';
      $('#p-headline').textContent = p.headline || '';
      $('#p-role').textContent = [p.currentRole, p.currentCompany].filter(Boolean).join(' · ');
      $('#surface-label').textContent = surfaceLabel(p.surface);

      // Fire-and-forget parse-health telemetry. Lets the team see when
      // LinkedIn ships a DOM change that breaks our parser, before users
      // complain. No PII — just booleans for which fields populated.
      try {
        chrome.runtime.sendMessage({
          type: 'RIFF_PARSE_HEALTH',
          payload: {
            surface: p.surface || 'unknown',
            gotName: !!p.name,
            gotHeadline: !!p.headline,
            gotAbout: !!p.about,
            gotRecentPosts: !!(p.recentPost && String(p.recentPost).length > 0),
          },
        });
      } catch {}
      stateBox.classList.add('hidden');
      card.classList.remove('hidden');
      generateBtn.disabled = false;

      currentProfile = p;
      currentCategory = categorizeProfile(p);
      refreshTemplates($('#purpose').value, currentCategory);

      // Day 1: check if we've already drafted to this candidate. Surface a
      // follow-up nudge if there's a sent event with no reply yet.
      checkPriorThread(tab.url);

      // Plus tier: Active Profile Assist. Auto-fetch fit score against
      // the user's saved job specs. Free/Pro users get a small "Plus"
      // upsell chip in the same slot.
      renderFitScore(p);

      resolve(p);
    });
  });
}

// ---------- Active Profile Assist (Plus) ----------
//
// Renders the #fit-score section with one of three states:
//   - LOCKED (free/pro)     — small "Score this profile against your job specs · Plus" chip
//   - NO SPECS (plus, none) — "Add a job spec to start scoring"
//   - SCORING               — small spinner while we hit /api/score
//   - SCORED                — fit-score badge with reasoning + matched/missing
//
// We don't bombard /api/score on every popup open if nothing has changed —
// but for v1 we just always score (cheap with Haiku). Caching by candidate
// URL is a phase 2 nice-to-have.

function renderFitScore(profile) {
  const root = $('#fit-score');
  if (!root) return;
  root.innerHTML = '';
  root.classList.remove('hidden');

  if (!hasPlusFeatures(currentPlan)) {
    // Free/Pro users see a single locked chip nudging upgrade.
    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'fit-score-locked';
    lock.innerHTML = '<span class="lock-icon">🔒</span> Upgrade to Plus to start scoring profiles';
    lock.title = 'Active Profile Assist is a Plus feature. Click to upgrade.';
    lock.addEventListener('click', async () => {
      const { riff_backend_url } = await getStorage(['riff_backend_url']);
      const base = riff_backend_url || DEFAULT_BACKEND_URL;
      chrome.tabs.create({ url: `${base}/dashboard?upgrade=plus` });
    });
    root.appendChild(lock);
    return;
  }

  // Plus user — fetch score.
  const loading = document.createElement('div');
  loading.className = 'fit-score-loading';
  loading.textContent = 'Scoring against your job specs…';
  root.appendChild(loading);

  chrome.runtime.sendMessage(
    { type: 'RIFF_SCORE', payload: { profile } },
    (resp) => {
      root.innerHTML = '';

      // Empty-spec state — handled BEFORE the !resp.ok branch because the
      // backend returns ok:true with activeSpecsCount:0 when the user has
      // no specs yet (it's a successful "you have nothing to score against"
      // response, not an error). Render the inline composer prompt.
      if (resp && resp.activeSpecsCount === 0) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'fit-score-empty';
        empty.innerHTML = '<span class="lock-icon">＋</span> Add a job spec to start scoring';
        empty.addEventListener('click', openSpecsManager);
        root.appendChild(empty);
        return;
      }

      if (!resp || !resp.ok) {
        const err = document.createElement('div');
        err.className = 'fit-score-error';
        err.textContent = (resp && resp.error) || 'Could not score this profile.';
        root.appendChild(err);
        return;
      }

      // Render the best-match badge + reasoning.
      const best = resp.best;
      if (!best) {
        // Defensive — shouldn't happen since activeSpecsCount === 0 was
        // handled above, but if the model failed for every spec we
        // surface a clean error instead of a silent no-op.
        const err = document.createElement('div');
        err.className = 'fit-score-error';
        err.textContent = 'Scoring failed for all your job specs. Try again.';
        root.appendChild(err);
        return;
      }
      const card = document.createElement('div');
      card.className = `fit-score-card score-${scoreBucket(best.result.score)}`;
      const head = document.createElement('div');
      head.className = 'fit-score-head';
      head.innerHTML = `
        <div class="fit-score-num">${best.result.score}</div>
        <div class="fit-score-meta">
          <div class="fit-score-spec">${escapeHtml(best.jobSpecName)}</div>
          <div class="fit-score-reason">${escapeHtml(best.result.reasoning)}</div>
        </div>
      `;
      card.appendChild(head);

      // Matched + missing as compact chip rows.
      if (Array.isArray(best.result.matched) && best.result.matched.length > 0) {
        const m = document.createElement('div');
        m.className = 'fit-score-row';
        m.innerHTML = '<span class="fit-score-row-label">Matches</span>' +
          best.result.matched.map(x => `<span class="fit-pill fit-pill-match">${escapeHtml(x)}</span>`).join('');
        card.appendChild(m);
      }
      if (Array.isArray(best.result.missing) && best.result.missing.length > 0) {
        const m = document.createElement('div');
        m.className = 'fit-score-row';
        m.innerHTML = '<span class="fit-score-row-label">Gaps</span>' +
          best.result.missing.map(x => `<span class="fit-pill fit-pill-miss">${escapeHtml(x)}</span>`).join('');
        card.appendChild(m);
      }

      // If they have multiple specs, show "n more" toggle.
      if (Array.isArray(resp.all) && resp.all.length > 1) {
        const more = document.createElement('details');
        more.className = 'fit-score-more';
        const summary = document.createElement('summary');
        summary.textContent = `${resp.all.length - 1} other spec${resp.all.length - 1 === 1 ? '' : 's'} scored`;
        more.appendChild(summary);
        for (let i = 1; i < resp.all.length; i++) {
          const row = resp.all[i];
          const r = document.createElement('div');
          r.className = `fit-score-other score-${scoreBucket(row.result.score)}`;
          r.innerHTML = `<span class="fit-score-num-sm">${row.result.score}</span> <strong>${escapeHtml(row.jobSpecName)}</strong> — ${escapeHtml(row.result.reasoning)}`;
          more.appendChild(r);
        }
        card.appendChild(more);
      }

      // "Manage specs" footer link.
      const footer = document.createElement('a');
      footer.href = '#';
      footer.className = 'fit-score-footer';
      footer.textContent = `Manage job specs (${resp.activeSpecsCount}/${resp.maxActiveSpecs})`;
      footer.addEventListener('click', (e) => { e.preventDefault(); openSpecsManager(); });
      card.appendChild(footer);

      root.appendChild(card);
    }
  );
}

function scoreBucket(score) {
  if (score >= 75) return 'high';
  if (score >= 60) return 'mid';
  if (score >= 40) return 'low';
  return 'none';
}

// Inline composer to add a job spec without leaving the popup. Phase 1
// keeps spec management here; a richer dashboard view ships in phase 2.
function openSpecsManager() {
  const root = $('#fit-score');
  if (!root) return;
  // If a composer is already open, just focus it.
  const existing = root.querySelector('.spec-composer');
  if (existing) {
    const input = existing.querySelector('input');
    if (input) input.focus();
    return;
  }
  root.innerHTML = '';

  const composer = document.createElement('div');
  composer.className = 'spec-composer';

  const title = document.createElement('div');
  title.className = 'spec-composer-title';
  title.textContent = 'New job spec';
  composer.appendChild(title);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Spec name (e.g. "Staff backend, payments")';
  nameInput.maxLength = 80;
  nameInput.className = 'spec-composer-name';
  composer.appendChild(nameInput);

  const descInput = document.createElement('textarea');
  descInput.placeholder = 'What you\'re hiring for. Stack, seniority, comp band, location, must-haves, nice-to-haves. Plain language is fine.';
  descInput.maxLength = 5000;
  descInput.rows = 4;
  descInput.className = 'spec-composer-desc';
  composer.appendChild(descInput);

  const btnRow = document.createElement('div');
  btnRow.className = 'spec-composer-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'spec-composer-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    if (currentProfile) renderFitScore(currentProfile);
    else root.classList.add('hidden');
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'spec-composer-save';
  save.textContent = 'Save & score';
  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    if (!name || !description) {
      showToast('Both name and description are required.', 'error');
      return;
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    chrome.runtime.sendMessage(
      { type: 'RIFF_JOB_SPECS_CREATE', payload: { name, description } },
      (resp) => {
        if (!resp || !resp.ok) {
          save.disabled = false;
          save.textContent = 'Save & score';
          showToast(resp && resp.error ? resp.error : 'Could not save spec.', 'error');
          return;
        }
        // Re-render the fit-score with the new spec applied.
        if (currentProfile) renderFitScore(currentProfile);
      }
    );
  });

  btnRow.appendChild(cancel);
  btnRow.appendChild(save);
  composer.appendChild(btnRow);

  root.appendChild(composer);
  setTimeout(() => nameInput.focus(), 30);
}

// ---------- prior-thread detection (Day 1 follow-up loop) ----------

function checkPriorThread(candidateUrl) {
  if (!candidateUrl) return;
  // Plan gate: cross-machine follow-up loop is paid-only. Free users still
  // get LOCAL stats via chrome.storage.local — they just don't get the
  // "you sent here X days ago" nudge.
  if (!hasFollowUpLoop(currentPlan)) return;
  chrome.runtime.sendMessage(
    { type: 'RIFF_EVENTS_FOR_CANDIDATE', payload: { candidate: candidateUrl } },
    (resp) => {
      if (!resp || !resp.ok || !Array.isArray(resp.events) || resp.events.length === 0) return;

      const events = resp.events; // most recent first
      const replied = events.find(e => e.kind === 'replied');
      const sent = events.find(e => e.kind === 'sent');

      const notice = $('#thread-notice');
      if (!notice) return;

      if (replied) {
        const days = daysSince(replied.created_at);
        notice.innerHTML = `<strong>${days === 0 ? 'They replied today.' : `They replied ${days}d ago.`}</strong> Nice. Drafting another touch?`;
        notice.classList.remove('hidden');
        return;
      }
      if (sent) {
        const days = daysSince(sent.created_at);
        if (days >= 14) {
          // Long-stale — surface but don't push hard
          notice.innerHTML = `<strong>You sent a draft here ${days}d ago.</strong> No reply yet.`;
        } else if (days >= 2) {
          notice.innerHTML = `<strong>You sent a draft here ${days === 0 ? 'today' : `${days}d ago`}.</strong> No reply yet — want the follow-up?
            <div><button type="button" class="nudge-btn" id="thread-nudge">Draft the follow-up →</button></div>`;
        } else {
          notice.innerHTML = `<strong>Just sent here ${days === 0 ? 'today' : 'yesterday'}.</strong> Give it a few days before the follow-up.`;
        }
        notice.classList.remove('hidden');
        const btn = $('#thread-nudge');
        if (btn) {
          btn.addEventListener('click', () => {
            // Pre-fill: same pitch, same tone — but we'll let the model produce
            // the follow_up variant automatically. We just trigger generate.
            const profile = currentProfile;
            if (profile) generate(profile);
          });
        }
      }
    }
  );
}

function daysSince(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  } catch { return 0; }
}

// ---------- template + purpose interactions ----------

$('#purpose').addEventListener('change', () => {
  refreshTemplates($('#purpose').value, currentCategory);
});

// Show "Direct · Medium · EN" subtext on the advanced-options summary so the
// user knows the current style without expanding it.
function refreshAdvancedSummaryMeta() {
  const meta = $('#advanced-summary-meta');
  if (!meta) return;
  const tone = $('#tone').value;
  const length = $('#length').value;
  const lang = $('#language') ? $('#language').value.toUpperCase() : 'EN';
  const post = $('#post').value.trim();
  const pieces = [
    tone.charAt(0).toUpperCase() + tone.slice(1),
    length === 'short' ? 'Short' : 'Medium',
    lang,
  ];
  if (post) pieces.push('+ post');
  meta.textContent = pieces.join(' · ');
}
['tone', 'length', 'language', 'post'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', refreshAdvancedSummaryMeta);
  if (el && el.tagName === 'TEXTAREA') el.addEventListener('input', refreshAdvancedSummaryMeta);
});
// Also call once on load so it's filled from defaults.
setTimeout(refreshAdvancedSummaryMeta, 0);

$('#template').addEventListener('change', (e) => {
  const idx = parseInt(e.target.value, 10);
  if (Number.isNaN(idx)) return; // Custom — leave pitch alone
  const templates = templatesFor($('#purpose').value, currentCategory);
  const t = templates[idx];
  if (!t) return;
  // If user has typed something and it's not a previous template, confirm
  const pitchEl = $('#pitch');
  if (pitchEl.value.trim() && !pitchEl.dataset.fromTemplate) {
    if (!confirm('Replace your pitch with this template?')) {
      e.target.value = ''; // reset dropdown
      return;
    }
  }
  pitchEl.value = t.template;
  pitchEl.dataset.fromTemplate = '1';
});

// If user manually edits pitch, mark it as no-longer-from-template
$('#pitch').addEventListener('input', () => {
  delete $('#pitch').dataset.fromTemplate;
});

// ---------- generate ----------

function generate(profile) {
  const generateBtn = $('#generate');
  generateBtn.disabled = true;
  generateBtn.classList.add('loading');
  generateBtn.textContent = 'Drafting…';

  const tone = $('#tone').value;
  const length = $('#length').value;
  const purpose = $('#purpose').value;
  const language = ($('#language') && $('#language').value) || 'en';

  const payload = {
    profile,
    tone,
    length,
    purpose,
    language,
    pitch: $('#pitch').value.trim(),
    recentPost: $('#post').value.trim() || null,
  };

  chrome.runtime.sendMessage({ type: 'RIFF_GENERATE', payload }, async (resp) => {
    generateBtn.disabled = false;
    generateBtn.classList.remove('loading');
    generateBtn.textContent = 'Generate';
    // Even on error, the rich `usage` snapshot may be present (e.g. on 402
    // we still know exactly how many drafts the user has used / has left).
    updateUsageChipFromResponse(resp);
    if (!resp || !resp.ok) {
      if (resp && resp.needsAuth) {
        $('#auth-section').classList.remove('hidden');
      }
      showToast(resp && resp.error ? resp.error : 'Generation failed. Try again in a moment.', 'error');
      return;
    }
    // Free-tier weekly quota label (legacy /api/me field — still emitted for
    // back-compat). Paid plans now show the monthly count via the usage chip.
    if (typeof resp.remainingThisWeek === 'number') {
      const q = $('#quota');
      q.textContent = `${resp.remainingThisWeek} / ${freeWeeklyLimit} free this week`;
      q.classList.toggle('urgent', resp.remainingThisWeek <= 1);
    }
    // Plan may have changed since popup open (rare — upgrade-while-popup-open).
    // Keep the badge synced so reply-tracking buttons re-enable correctly.
    if (resp.plan && resp.plan !== currentPlan) {
      currentPlan = resp.plan;
      refreshPlanBadge();
    }
    renderVariants(resp.variants, { tone, length });
    if (resp.upgradeMessage) {
      showUpgradeHint(resp.upgradeMessage);
    }
  });
}

// ---------- inline toasts (replace alert popups) ----------

function showToast(message, kind) {
  const region = $('#toast-region');
  if (!region) return;
  region.innerHTML = '';
  const box = document.createElement('div');
  if (kind === 'error') box.className = 'error-toast';
  else if (kind === 'info') box.className = 'success-toast';
  else box.className = 'upgrade-hint';
  box.textContent = message;
  region.appendChild(box);
  const lifetime = kind === 'error' ? 5000 : 2400;
  setTimeout(() => box.remove(), lifetime);
}

function showUpgradeHint(message) {
  const results = $('#results');
  if (!results) return;
  // Insert as the last card-following node so it sits under the variants.
  const hint = document.createElement('div');
  hint.className = 'upgrade-hint';
  hint.innerHTML = `${escapeHtml(message)} <a href="https://rifflylabs.com/dashboard" target="_blank">Upgrade</a>`;
  results.appendChild(hint);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderVariants(variants, ctx) {
  const results = $('#results');
  results.innerHTML = '';
  results.classList.remove('hidden');

  variants.forEach((v, idx) => {
    const eventId = `${Date.now()}-${idx}`;
    const card = document.createElement('div');
    card.className = 'variant';

    const head = document.createElement('div');
    head.className = 'variant-header';
    const label = document.createElement('div');
    label.className = 'variant-label';
    // Numeric badge — pairs with the 1/2/3 keyboard shortcuts.
    const num = document.createElement('span');
    num.className = 'variant-num';
    num.textContent = String(idx + 1);
    label.appendChild(num);
    label.appendChild(document.createTextNode(v.type.replace(/_/g, ' ')));
    head.appendChild(label);
    card.appendChild(head);

    const text = document.createElement('div');
    text.className = 'variant-text';
    text.textContent = v.text;
    card.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'variant-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(v.text);
        copyBtn.classList.add('copied');
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.textContent = 'Copy';
        }, 1800);
      } catch (e) {
        showToast('Copy failed — try selecting and copying manually.', 'error');
      }
    });
    actions.appendChild(copyBtn);

    const sentBtn = document.createElement('button');
    sentBtn.textContent = 'Mark sent';
    sentBtn.addEventListener('click', async () => {
      await recordEvent({ id: eventId, kind: 'sent', tone: ctx.tone, length: ctx.length, type: v.type, t: Date.now() });
      // Mirror to server so follow-up loop works across machines.
      sendServerEvent('sent', v.type, ctx);
      sentBtn.classList.add('sent');
      sentBtn.textContent = 'Sent ✓';
    });
    actions.appendChild(sentBtn);

    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Mark replied';
    replyBtn.addEventListener('click', async () => {
      await recordEvent({ id: eventId, kind: 'replied', tone: ctx.tone, length: ctx.length, type: v.type, t: Date.now() });
      sendServerEvent('replied', v.type, ctx);
      replyBtn.classList.add('replied');
      replyBtn.textContent = 'Replied ✓';
      await renderStats();
    });
    actions.appendChild(replyBtn);

    card.appendChild(actions);
    results.appendChild(card);
  });
}

// ---------- reply tracking (local + server) ----------

async function recordEvent(ev) {
  const { riff_events } = await getStorage(['riff_events']);
  const events = Array.isArray(riff_events) ? riff_events : [];
  events.push(ev);
  await setStorage({ riff_events: events.slice(-1000) });
}

// Mirror sent / replied marks to the server so the follow-up loop and
// cross-machine stats work. Best-effort — local stats are still authoritative.
//
// Plan gate: paid-only. Free users keep working locally (no error toast,
// no console noise from a 402) — they just don't sync.
function sendServerEvent(kind, variantType, ctx) {
  if (!hasReplyAnalytics(currentPlan)) return;
  if (!currentProfile) return;
  const candidate_url = currentProfile.profileUrl || '';
  if (!candidate_url) return;
  chrome.runtime.sendMessage({
    type: 'RIFF_EVENTS_RECORD',
    payload: {
      candidate_url,
      candidate_name: currentProfile.name || null,
      variant_type: variantType,
      tone: (ctx && ctx.tone) || null,
      length_label: (ctx && ctx.length) || null,
      kind,
    },
  });
}

async function renderStats() {
  const { riff_events } = await getStorage(['riff_events']);
  const events = Array.isArray(riff_events) ? riff_events : [];
  if (events.length === 0) {
    $('#stats').classList.add('hidden');
    return;
  }

  const byTone = {};
  for (const e of events) {
    const k = e.tone || 'unknown';
    if (!byTone[k]) byTone[k] = { sent: 0, replied: 0 };
    if (e.kind === 'sent') byTone[k].sent++;
    else if (e.kind === 'replied') byTone[k].replied++;
  }

  const body = $('#stats-body');
  body.innerHTML = '';
  for (const tone of Object.keys(byTone)) {
    const { sent, replied } = byTone[tone];
    const rate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
    const cell = document.createElement('div');
    cell.className = 'stats-cell';
    cell.innerHTML = `<span class="label">${tone}</span><span class="value">${replied}/${sent} (${rate}%)</span>`;
    body.appendChild(cell);
  }
  $('#stats').classList.remove('hidden');
}

$('#stats-clear').addEventListener('click', async (e) => {
  e.preventDefault();
  if (confirm('Clear local reply tracking stats?')) {
    await setStorage({ riff_events: [] });
    await renderStats();
  }
});

// ---------- Saved-Search Scan (Plus tier — Daily Digest hookup) ----------
//
// When the active tab is a LinkedIn search-results URL that matches one of
// the user's saved searches, surface a "Scan visible profiles" button. Click
// → ask content.js for visible profile cards → POST to /api/saved-searches/scan
// → render top-N results with score + reasoning.
//
// Free/Pro users on a search URL see a locked upgrade chip in the same slot.

function isLinkedInSearchUrl(url) {
  return !!url && /^https:\/\/www\.linkedin\.com\/search\/results\/(people|all)\b/.test(url);
}

// Cadence intervals in ms — must match backend CADENCE_INTERVAL_MS.
const POPUP_CADENCE_MS = {
  manual: Number.POSITIVE_INFINITY,
  on_visit: 0,
  thrice_daily: 8 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};
const POPUP_CADENCE_LABEL = {
  manual: 'Manual only',
  on_visit: 'Every visit',
  thrice_daily: '3× daily',
  daily: 'Daily',
  weekly: 'Weekly',
};

// Returns either null (eligible to scan now) or a short string describing
// when the next scan is allowed (e.g. "in 4 hr").
function nextScanWaitLabel(search) {
  const cadence = search.scan_cadence || 'manual';
  if (cadence === 'on_visit') return null;
  if (cadence === 'manual') return 'manual only';
  const interval = POPUP_CADENCE_MS[cadence];
  const last = search.last_scanned_at ? new Date(search.last_scanned_at).getTime() : 0;
  if (!last) return null;
  const elapsed = Date.now() - last;
  if (elapsed >= interval) return null;
  const remaining = interval - elapsed;
  const min = Math.ceil(remaining / 60000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.ceil(min / 60);
  if (hr < 24) return `in ${hr} hr`;
  const d = Math.ceil(hr / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

// Match the active tab URL against the list of saved searches. We compare
// origin + path (ignoring query/hash) — LinkedIn appends session-specific
// query params that we don't want to cause false misses.
function findMatchingSavedSearch(currentUrl, searches) {
  if (!searches || searches.length === 0) return null;
  let curPath = '';
  try { curPath = new URL(currentUrl).pathname; } catch { return null; }
  // Exact path match wins; otherwise prefix-match (so a saved
  // /search/results/people/ matches any specific keyword variant).
  const exact = searches.find((s) => {
    try { return new URL(s.search_url).pathname === curPath; } catch { return false; }
  });
  if (exact) return exact;
  return searches.find((s) => {
    try {
      const sp = new URL(s.search_url).pathname;
      return sp && curPath.startsWith(sp);
    } catch { return false; }
  }) || null;
}

async function renderSavedSearchScan() {
  const root = $('#search-scan');
  if (!root) return;
  const tab = await getActiveTab();
  if (!tab || !isLinkedInSearchUrl(tab.url)) {
    root.classList.add('hidden');
    return;
  }

  // Free/Pro: locked upgrade chip.
  if (!hasPlusFeatures(currentPlan)) {
    root.classList.remove('hidden');
    root.innerHTML = '';
    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'fit-score-locked';
    lock.innerHTML = '<span class="lock-icon">🔒</span> Upgrade to Plus to scan saved searches';
    lock.title = 'Saved-Search Daily Digest is a Plus feature. Click to upgrade.';
    lock.addEventListener('click', async () => {
      const { riff_backend_url } = await getStorage(['riff_backend_url']);
      const base = riff_backend_url || DEFAULT_BACKEND_URL;
      chrome.tabs.create({ url: `${base}/dashboard?upgrade=plus` });
    });
    root.appendChild(lock);
    return;
  }

  // Plus: fetch saved searches, look for a match.
  const { riff_token } = await getStorage(['riff_token']);
  if (!riff_token) {
    root.classList.add('hidden');
    return;
  }
  const { riff_backend_url } = await getStorage(['riff_backend_url']);
  const base = riff_backend_url || DEFAULT_BACKEND_URL;

  let searches = [];
  try {
    const res = await fetch(`${base}/api/saved-searches`, {
      headers: { Authorization: `Bearer ${riff_token}` },
    });
    const data = await res.json();
    if (data && data.ok) searches = data.searches || [];
  } catch {
    root.classList.add('hidden');
    return;
  }

  const match = findMatchingSavedSearch(tab.url, searches);

  root.classList.remove('hidden');
  root.innerHTML = '';

  if (!match) {
    // No saved search for this URL — inline name+cadence form, URL auto-detected.
    renderAddSearchForm(root, tab.url, base, riff_token, async () => {
      // After successful add, re-render with the now-tracked match.
      await renderSavedSearchScan();
    });
    return;
  }

  // Match found — render the cadence-aware scan card.
  const cadence = match.scan_cadence || 'manual';
  const waitLabel = nextScanWaitLabel(match);
  const eligible = waitLabel === null;

  const wrap = document.createElement('div');
  wrap.className = 'search-scan-card';
  wrap.innerHTML = `
    <div class="search-scan-title">Tracking: ${escapeHtml(match.name)}</div>
    <div class="search-scan-sub">
      Cadence: <strong>${escapeHtml(POPUP_CADENCE_LABEL[cadence] || cadence)}</strong>
      ${waitLabel ? ` · next auto-scan ${escapeHtml(waitLabel)}` : ''}
    </div>
  `;

  // Cadence picker chip row.
  const cadenceRow = document.createElement('div');
  cadenceRow.className = 'search-scan-cadence-row';
  const cadenceLabel = document.createElement('label');
  cadenceLabel.className = 'search-scan-cadence-label';
  cadenceLabel.textContent = 'Auto-scan:';
  const cadenceSel = document.createElement('select');
  cadenceSel.className = 'search-scan-cadence-select';
  for (const key of Object.keys(POPUP_CADENCE_LABEL)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = POPUP_CADENCE_LABEL[key];
    if (key === cadence) opt.selected = true;
    cadenceSel.appendChild(opt);
  }
  cadenceSel.addEventListener('change', async () => {
    const newCadence = cadenceSel.value;
    cadenceSel.disabled = true;
    try {
      const res = await fetch(`${base}/api/saved-searches/${match.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${riff_token}`,
        },
        body: JSON.stringify({ scan_cadence: newCadence }),
      });
      const data = await res.json();
      if (!data || !data.ok) {
        showToast((data && data.error) || 'Could not update cadence.', 'error');
        cadenceSel.value = cadence;
      } else {
        // Re-render the card so the "next auto-scan" sublabel updates.
        await renderSavedSearchScan();
      }
    } catch {
      showToast('Network error updating cadence.', 'error');
      cadenceSel.value = cadence;
    } finally {
      cadenceSel.disabled = false;
    }
  });
  cadenceLabel.appendChild(cadenceSel);
  cadenceRow.appendChild(cadenceLabel);
  wrap.appendChild(cadenceRow);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-scan-primary';
  btn.textContent = match.last_scanned_at ? 'Scan again now' : 'Scan visible profiles';
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'search-scan-results';
  wrap.appendChild(btn);
  wrap.appendChild(resultsDiv);
  root.appendChild(wrap);

  btn.addEventListener('click', () => runScan({ tab, base, token: riff_token, match, btn, resultsDiv, force: true }));

  // Auto-trigger if cadence is on_visit OR if we're past the interval AND not manual.
  if (cadence === 'on_visit' || (eligible && cadence !== 'manual')) {
    runScan({ tab, base, token: riff_token, match, btn, resultsDiv, force: false });
  }
}

// Inline name-only "Add this search" form for untracked LinkedIn search URLs.
// URL is auto-detected from the active tab.
function renderAddSearchForm(root, currentUrl, base, token, onAdded) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'search-scan-card';
  wrap.innerHTML = `
    <div class="search-scan-title">Track this LinkedIn search?</div>
    <div class="search-scan-sub">Riffly will rank everyone in this search against your active job specs.</div>
  `;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'search-scan-name-input';
  nameInput.placeholder = 'Name this search (e.g. "Bay Area staff backend")';
  nameInput.maxLength = 80;
  wrap.appendChild(nameInput);

  const cadenceLabel = document.createElement('label');
  cadenceLabel.className = 'search-scan-cadence-label';
  cadenceLabel.textContent = 'Auto-scan:';
  const cadenceSel = document.createElement('select');
  cadenceSel.className = 'search-scan-cadence-select';
  for (const key of Object.keys(POPUP_CADENCE_LABEL)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = POPUP_CADENCE_LABEL[key];
    if (key === 'manual') opt.selected = true;
    cadenceSel.appendChild(opt);
  }
  cadenceLabel.appendChild(cadenceSel);
  wrap.appendChild(cadenceLabel);

  const btnRow = document.createElement('div');
  btnRow.className = 'search-scan-btn-row';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'search-scan-primary';
  addBtn.textContent = 'Track this search';
  const dashBtn = document.createElement('button');
  dashBtn.type = 'button';
  dashBtn.className = 'search-scan-secondary';
  dashBtn.textContent = 'Open dashboard';
  dashBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: `${base}/dashboard` });
  });
  btnRow.appendChild(addBtn);
  btnRow.appendChild(dashBtn);
  wrap.appendChild(btnRow);

  addBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      showToast('Give this search a name first.', 'error');
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    try {
      const res = await fetch(`${base}/api/saved-searches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          search_url: currentUrl,
          scan_cadence: cadenceSel.value,
        }),
      });
      const data = await res.json();
      if (!data || !data.ok) {
        addBtn.disabled = false;
        addBtn.textContent = 'Track this search';
        showToast((data && data.error) || 'Could not add this search.', 'error');
        return;
      }
      showToast(`Tracking "${name}"`, 'info');
      if (typeof onAdded === 'function') await onAdded();
    } catch (e) {
      addBtn.disabled = false;
      addBtn.textContent = 'Track this search';
      showToast('Network error contacting Riffly. Try again.', 'error');
    }
  });

  root.appendChild(wrap);
  setTimeout(() => nameInput.focus(), 30);
}

// Performs the actual scrape + scan POST. Used by both the "Scan again" button
// (force=true → bypass cadence rate-limit) and the cadence auto-trigger
// (force=false → backend may 429 if interval not yet elapsed).
async function runScan({ tab, base, token, match, btn, resultsDiv, force }) {
  btn.disabled = true;
  btn.textContent = 'Reading profiles…';
  resultsDiv.innerHTML = '';

  let extracted;
  try {
    extracted = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'RIFF_EXTRACT_SEARCH_RESULTS' }, (resp) => {
        resolve(resp);
      });
    });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Scan visible profiles';
    resultsDiv.textContent = 'Could not read this page. Refresh and try again.';
    return;
  }
  if (!extracted || !extracted.ok || !Array.isArray(extracted.profiles) || extracted.profiles.length === 0) {
    btn.disabled = false;
    btn.textContent = 'Scan visible profiles';
    resultsDiv.textContent = (extracted && extracted.error) || 'No profile cards detected. Scroll the search results into view, then try again.';
    return;
  }

  btn.textContent = `Scoring ${extracted.profiles.length} profiles…`;
  let scanData;
  try {
    const res = await fetch(`${base}/api/saved-searches/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        saved_search_id: match.id,
        profiles: extracted.profiles,
        force: !!force,
      }),
    });
    scanData = await res.json();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Scan visible profiles';
    resultsDiv.textContent = 'Network error contacting Riffly. Try again in a moment.';
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Scan again';

  // Refresh the overdue badge — this scan likely just decremented the count.
  // Best-effort; we don't await or surface failures.
  try { chrome.runtime.sendMessage({ type: 'RIFF_REFRESH_BADGE' }); } catch {}

  // Cadence rate limit — silent for auto-triggers, surfaced for manual.
  if (scanData && scanData.rateLimited) {
    if (force) {
      resultsDiv.textContent = scanData.error || 'Rate limited. Try again later.';
    } else {
      resultsDiv.innerHTML = `<div class="search-scan-summary">Auto-scan throttled by cadence. Click "Scan again now" to force a fresh scan.</div>`;
    }
    return;
  }

  if (!scanData || !scanData.ok) {
    resultsDiv.textContent = (scanData && scanData.error) || 'Scan failed. Try again.';
    return;
  }

  if (!scanData.results || scanData.results.length === 0) {
    resultsDiv.textContent = `Scored ${scanData.scanned || 0} profiles but none returned a match. Try scrolling for more results, then scan again.`;
    return;
  }

  const topN = scanData.results.slice(0, 5);
  const list = document.createElement('ol');
  list.className = 'search-scan-list';
  for (const r of topN) {
    const li = document.createElement('li');
    const score = r.best ? r.best.result.score : 0;
    const reasoning = r.best ? r.best.result.reasoning : '';
    const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low';
    li.innerHTML = `
      <div class="search-scan-row">
        <span class="search-scan-score ${scoreClass}">${score}</span>
        ${r.profileUrl ? `<a href="${escapeAttr(r.profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.candidateName || 'Unnamed')}</a>` : `<span>${escapeHtml(r.candidateName || 'Unnamed')}</span>`}
      </div>
      ${reasoning ? `<div class="search-scan-reason">${escapeHtml(reasoning)}</div>` : ''}
    `;
    list.appendChild(li);
  }
  resultsDiv.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'search-scan-summary';
  summary.textContent = `Top ${topN.length} of ${scanData.scored || topN.length} matches · also visible in your dashboard digest.`;
  resultsDiv.appendChild(summary);
  resultsDiv.appendChild(list);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

// ---------- init ----------

document.addEventListener('DOMContentLoaded', async () => {
  await refreshAuthUI();
  await renderStats();
  // Initialize templates list with default purpose + 'other' category
  refreshTemplates('hire', 'other');

  let profile = await loadProfile();
  // Plus tier — surface saved-search scan UI when on a tracked search URL.
  // Runs independently of profile load (different active-tab branch).
  renderSavedSearchScan();

  // ---------- Surface detection (popup vs sidebar) ----------
  // Sidebar panels are typically wider than the 380px popup width. We use
  // that to set data-surface on body so popup.css can switch to the
  // responsive layout. Re-check on resize because the user can drag the
  // sidebar narrower or wider.
  function detectSurface() {
    const isSidebar = window.innerWidth >= 410; // popup body = 380; sidebar always wider
    document.body.dataset.surface = isSidebar ? 'sidebar' : 'popup';
  }
  detectSurface();
  window.addEventListener('resize', detectSurface);

  // ---------- SPA auto-update ----------
  // Three triggers cause us to re-extract the profile from the active tab:
  //   1. visibilitychange — sidebar becomes visible after a tab switch
  //      (popup mode: no-op, popup closes on tab switch)
  //   2. RIFF_PROFILE_NAV runtime message — background.js broadcasts when
  //      the active tab navigates to a new profile (covers LinkedIn's SPA
  //      pushState navigation, where no full page load happens)
  //   3. URL polling fallback — every 2s, compare active tab URL to the
  //      last URL we extracted from. Catches edge cases where neither
  //      visibilitychange nor onUpdated fire (rare, but cheap insurance).
  // Seed with the current URL so the very first poll tick after init does
  // NOT double-extract what loadProfile() already extracted at line 1450.
  let lastExtractedUrl = null;
  {
    const _seedTab = await getActiveTab();
    if (_seedTab && _seedTab.url) lastExtractedUrl = _seedTab.url;
  }

  async function reExtractIfNeeded(reason) {
    const tab = await getActiveTab();
    if (!tab || !tab.url) return;
    if (tab.url === lastExtractedUrl) return; // unchanged — skip
    if (!isSupportedProfile(tab.url)) {
      // Navigated AWAY from a profile (e.g., to LinkedIn feed). Reset to hint state.
      const stateBox = $('#profile-state');
      const card = $('#profile-card');
      if (stateBox && card) {
        stateBox.classList.remove('hidden');
        stateBox.querySelector('.hint').textContent =
          'Open a candidate profile (LinkedIn, GitHub, or Wellfound) and reopen Riffly.';
        card.classList.add('hidden');
        $('#generate').disabled = true;
      }
      lastExtractedUrl = tab.url;
      return;
    }
    // Small delay so LinkedIn's React tree has time to render the new profile
    // (otherwise we extract the previous candidate's name on top of the new
    // candidate's photo). 600ms is conservative — trial-and-error suggested 350ms
    // is enough for LinkedIn but Wellfound is slower.
    if (reason === 'nav') await new Promise(r => setTimeout(r, 600));
    profile = await loadProfile();
    if (profile) lastExtractedUrl = tab.url;
    renderSavedSearchScan();
    refreshUsageChip();
  }

  // (1) visibilitychange — sidebar becomes visible
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    await reExtractIfNeeded('visibility');
  });

  // (2) Runtime message from background's chrome.tabs.onUpdated listener.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'RIFF_PROFILE_NAV') return false;
    reExtractIfNeeded('nav');
    return false;
  });

  // (3) Polling fallback. 2.5s cadence is invisible to the user but cheap
  // (just one tabs.query). Stop polling if the page is hidden — saves CPU
  // when the sidebar is collapsed or the popup is closed.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    reExtractIfNeeded('poll');
  }, 2500);

  // ---------- Surface-mode footer toggle ----------
  // Reflect current mode in the toggle pills, and let the user switch.
  // The change persists in chrome.storage and applies on the NEXT toolbar
  // click (background.js calls action.setPopup + sidePanel.setPanelBehavior).
  (async () => {
    const sidebarBtn = $('#surface-btn-sidebar');
    const popupBtn = $('#surface-btn-popup');
    if (!sidebarBtn || !popupBtn) return;
    chrome.runtime.sendMessage({ type: 'RIFF_GET_SURFACE_MODE' }, (resp) => {
      const mode = (resp && resp.mode) || 'sidebar';
      sidebarBtn.classList.toggle('active', mode === 'sidebar');
      popupBtn.classList.toggle('active', mode === 'popup');
    });
    function setMode(mode) {
      chrome.runtime.sendMessage({ type: 'RIFF_SET_SURFACE_MODE', payload: { mode } }, (resp) => {
        if (!resp || !resp.ok) return;
        sidebarBtn.classList.toggle('active', mode === 'sidebar');
        popupBtn.classList.toggle('active', mode === 'popup');
        showToast(
          mode === 'sidebar'
            ? 'Switched to sidebar. Click the Riffly icon to open the side panel.'
            : 'Switched to popup. Click the Riffly icon to open the popup.',
          'info'
        );
      });
    }
    sidebarBtn.addEventListener('click', () => setMode('sidebar'));
    popupBtn.addEventListener('click', () => setMode('popup'));
  })();

  $('#generate').addEventListener('click', () => {
    if (!profile) return;
    if (!$('#pitch').value.trim()) {
      showToast('Add your pitch (1-2 sentences) so the message has something to say.', 'error');
      return;
    }
    generate(profile);
  });

  // ---------- Day 1: keyboard shortcuts ----------
  // ⌘↵ / Ctrl+Enter — Generate
  // 1 / 2 / 3 — Copy variant N (when results visible and focus is not in a textarea)
  document.addEventListener('keydown', (e) => {
    const isCmdEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    if (isCmdEnter) {
      e.preventDefault();
      const generateBtn = $('#generate');
      if (generateBtn && !generateBtn.disabled) generateBtn.click();
      return;
    }
    // Number shortcuts only when not typing in a text field
    const activeTag = (document.activeElement && document.activeElement.tagName) || '';
    const isInField = activeTag === 'TEXTAREA' || activeTag === 'INPUT' || activeTag === 'SELECT';
    if (isInField) return;

    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const idx = parseInt(e.key, 10) - 1;
      const variants = document.querySelectorAll('.variant');
      const target = variants[idx];
      if (target) {
        const copyBtn = target.querySelector('button');
        if (copyBtn) {
          e.preventDefault();
          copyBtn.click();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  });

  // ---------- Day 1 (revised): saved pitch chips ----------
  // Auto-loads on popup open. Each saved pitch is a clickable chip.
  // "+ Save this" reveals an inline composer — no system prompt() dialog.

  let templatesCache = null;

  function renderTemplatesBar() {
    const bar = $('#templates-bar');
    if (!bar) return;
    bar.innerHTML = '';

    // Plan gate: Saved pitches are paid-only. Free users see a single
    // "lock chip" that opens /dashboard?upgrade=pro instead of the save UX.
    if (!hasSavedTemplates(currentPlan)) {
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'tpl-chip-locked';
      lock.innerHTML = '<span class="lock-icon">🔒</span> Save reusable pitches — Pro';
      lock.title = 'Saved pitches are a Pro feature. Click to upgrade.';
      lock.addEventListener('click', async () => {
        const { riff_backend_url } = await getStorage(['riff_backend_url']);
        const base = riff_backend_url || DEFAULT_BACKEND_URL;
        chrome.tabs.create({ url: `${base}/dashboard?upgrade=pro` });
      });
      bar.appendChild(lock);
      return;
    }

    // Render chips for each saved template
    if (Array.isArray(templatesCache)) {
      for (const t of templatesCache) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tpl-chip';
        chip.title = t.pitch;
        chip.textContent = t.name;
        chip.addEventListener('click', () => loadTemplate(t));

        const x = document.createElement('span');
        x.className = 'tpl-x';
        x.textContent = '×';
        x.title = 'Delete';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteTemplate(t);
        });
        chip.appendChild(x);

        bar.appendChild(chip);
      }
    }

    // Save-this chip — last in the row.
    const saveChip = document.createElement('button');
    saveChip.type = 'button';
    saveChip.className = 'tpl-chip-save';
    saveChip.id = 'tpl-save-trigger';
    saveChip.textContent = '+ Save this pitch';
    saveChip.addEventListener('click', openSaveComposer);
    bar.appendChild(saveChip);

    // Disable save chip if pitch is empty
    refreshSaveChipState();
  }

  function refreshSaveChipState() {
    const chip = $('#tpl-save-trigger');
    if (!chip) return;
    const pitch = $('#pitch').value.trim();
    if (!pitch) {
      chip.disabled = true;
      chip.title = 'Write a pitch first';
    } else {
      chip.disabled = false;
      chip.title = 'Save this pitch as a template';
    }
  }

  function loadTemplate(t) {
    const pitchEl = $('#pitch');
    pitchEl.value = t.pitch;
    if (t.purpose) $('#purpose').value = t.purpose;
    pitchEl.dataset.fromTemplate = '1';
    refreshSaveChipState();
    showToast(`Loaded "${t.name}"`, 'info');
  }

  function deleteTemplate(t) {
    chrome.runtime.sendMessage({ type: 'RIFF_TEMPLATES_DELETE', payload: { id: t.id } }, (resp) => {
      if (!resp || !resp.ok) {
        showToast('Could not delete that template.', 'error');
        return;
      }
      templatesCache = (templatesCache || []).filter(x => x.id !== t.id);
      renderTemplatesBar();
    });
  }

  function suggestName(pitch) {
    // Auto-suggest a short name from first 3-5 meaningful words.
    return pitch
      .replace(/[^\w\s.-·•]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !/^(the|a|an|and|or|for|of|to|in|on|at|with|is|are)$/i.test(w))
      .slice(0, 4)
      .join(' ')
      .slice(0, 60);
  }

  function openSaveComposer() {
    const pitch = $('#pitch').value.trim();
    if (!pitch) return;

    const bar = $('#templates-bar');
    if (!bar || bar.querySelector('.tpl-save-composer')) return;

    const composer = document.createElement('div');
    composer.className = 'tpl-save-composer';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name this pitch';
    input.value = suggestName(pitch);
    input.maxLength = 80;

    const goBtn = document.createElement('button');
    goBtn.className = 'save-go';
    goBtn.type = 'button';
    goBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'save-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '×';
    cancelBtn.title = 'Cancel';

    function close() { composer.remove(); }
    function commit() {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      goBtn.disabled = true;
      goBtn.textContent = 'Saving…';
      const purpose = $('#purpose').value || 'hire';
      chrome.runtime.sendMessage(
        { type: 'RIFF_TEMPLATES_CREATE', payload: { name, pitch, purpose } },
        (resp) => {
          if (!resp || !resp.ok) {
            goBtn.disabled = false;
            goBtn.textContent = 'Save';
            showToast(resp && resp.error ? resp.error : 'Could not save.', 'error');
            return;
          }
          // Optimistically update cache + re-render bar with new chip + a brief check toast.
          templatesCache = [resp.template, ...(templatesCache || [])];
          renderTemplatesBar();
          // Brief inline confirmation chip
          const bar = $('#templates-bar');
          const ok = document.createElement('span');
          ok.className = 'tpl-saved-toast';
          ok.textContent = `✓ Saved "${name}"`;
          bar.prepend(ok);
          setTimeout(() => ok.remove(), 1800);
        }
      );
    }

    cancelBtn.addEventListener('click', close);
    goBtn.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    composer.appendChild(input);
    composer.appendChild(goBtn);
    composer.appendChild(cancelBtn);
    bar.appendChild(composer);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  // Live-update the save chip's enabled state when pitch changes.
  $('#pitch').addEventListener('input', refreshSaveChipState);

  // Auto-load templates on popup open. We always render the bar (even for
  // free users) — the renderer decides whether to show real chips or the
  // single "lock" chip based on currentPlan. We still hit the GET endpoint
  // for paid users; the backend short-circuits free users to an empty list
  // with `locked: true`, so this is one extra round-trip we can afford.
  if (hasSavedTemplates(currentPlan)) {
    chrome.runtime.sendMessage({ type: 'RIFF_TEMPLATES_LIST' }, (resp) => {
      templatesCache = (resp && resp.ok) ? (resp.templates || []) : [];
      renderTemplatesBar();
    });
  } else {
    templatesCache = [];
    renderTemplatesBar();
  }
});
