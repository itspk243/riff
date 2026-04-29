// Riff popup logic.
// Profile read → categorize → adapt templates → generate → render → reply tracking → stats.
// Auth is a paste-token model: user copies token from riff.app/dashboard.

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
  if (/\b(co-?founder|founder|ceo|cto|chief executive|chief technology|chief product|chief operating|coo)\b/.test(text)) return 'founder';
  if (/\b(designer|design lead|head of design|product design|ux|ui|brand designer|illustrator|art director|creative director)\b/.test(text)) return 'designer';
  if (/\b(product manager|head of product|director of product|group product|principal pm|senior pm|associate pm|\bpm\b)\b/.test(text)) return 'pm';
  if (/\b(engineer|developer|programmer|swe|sde|sre|architect|tech lead|staff engineer|principal engineer|senior dev|backend|frontend|full[\s-]?stack|ios|android)\b/.test(text)) return 'engineer';
  if (/\b(account executive|sales|sdr|business development|\bbd\b|\bae\b|head of sales|chief revenue|cro)\b/.test(text)) return 'sales';
  if (/\b(marketing|growth|seo|sem|content|brand|demand gen)\b/.test(text)) return 'marketing';
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

// ---------- auth ----------

async function refreshAuthUI() {
  const { riff_token } = await getStorage(['riff_token']);
  if (riff_token) {
    $('#auth-section').classList.add('hidden');
    $('#auth-status').classList.remove('hidden');
    $('#auth-email').textContent = 'Signed in';
  } else {
    $('#auth-section').classList.remove('hidden');
    $('#auth-status').classList.add('hidden');
  }
}

$('#auth-submit').addEventListener('click', async () => {
  const token = $('#token-input').value.trim();
  if (!token || token.length < 20) { alert('That doesn\'t look like a valid token.'); return; }
  await setStorage({ riff_token: token });
  $('#token-input').value = '';
  await refreshAuthUI();
});

$('#signout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await setStorage({ riff_token: null });
  await refreshAuthUI();
});

// Production backend URL. Override only for local dev:
//   chrome.storage.local.set({ riff_backend_url: 'http://localhost:3000' })
const DEFAULT_BACKEND_URL = 'https://riff-sandy.vercel.app';

$('#signup-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const { riff_backend_url } = await getStorage(['riff_backend_url']);
  const base = riff_backend_url || DEFAULT_BACKEND_URL;
  chrome.tabs.create({ url: `${base}/signup` });
});

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
      'Open a candidate profile (LinkedIn, GitHub, or Wellfound) and reopen Riff.';
    card.classList.add('hidden');
    generateBtn.disabled = true;
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'RIFF_EXTRACT_PROFILE' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        stateBox.querySelector('.hint').textContent =
          'Could not read this profile. Refresh the page and reopen Riff.';
        card.classList.add('hidden');
        generateBtn.disabled = true;
        return resolve(null);
      }
      const p = resp.profile;
      $('#p-name').textContent = p.name || '(name not detected)';
      $('#p-headline').textContent = p.headline || '';
      $('#p-role').textContent = [p.currentRole, p.currentCompany].filter(Boolean).join(' · ');
      $('#surface-label').textContent = surfaceLabel(p.surface);
      stateBox.classList.add('hidden');
      card.classList.remove('hidden');
      generateBtn.disabled = false;

      currentProfile = p;
      currentCategory = categorizeProfile(p);
      refreshTemplates($('#purpose').value, currentCategory);

      resolve(p);
    });
  });
}

// ---------- template + purpose interactions ----------

$('#purpose').addEventListener('change', () => {
  refreshTemplates($('#purpose').value, currentCategory);
});

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
  generateBtn.textContent = 'Generating…';

  const tone = $('#tone').value;
  const length = $('#length').value;
  const purpose = $('#purpose').value;

  const payload = {
    profile,
    tone,
    length,
    purpose,
    pitch: $('#pitch').value.trim(),
    recentPost: $('#post').value.trim() || null,
  };

  chrome.runtime.sendMessage({ type: 'RIFF_GENERATE', payload }, async (resp) => {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
    if (!resp || !resp.ok) {
      if (resp && resp.needsAuth) {
        $('#auth-section').classList.remove('hidden');
      }
      alert('Generation failed. ' + (resp && resp.error ? resp.error : ''));
      return;
    }
    if (typeof resp.remainingThisWeek === 'number') {
      $('#quota').textContent = `${resp.remainingThisWeek} / 5 free this week`;
    }
    renderVariants(resp.variants, { tone, length });
  });
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
    label.textContent = v.type.replace(/_/g, ' ');
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
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
      } catch (e) { copyBtn.textContent = 'Copy failed'; }
    });
    actions.appendChild(copyBtn);

    const sentBtn = document.createElement('button');
    sentBtn.textContent = 'Mark sent';
    sentBtn.addEventListener('click', async () => {
      await recordEvent({ id: eventId, kind: 'sent', tone: ctx.tone, length: ctx.length, type: v.type, t: Date.now() });
      sentBtn.classList.add('sent');
      sentBtn.textContent = 'Sent ✓';
    });
    actions.appendChild(sentBtn);

    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Mark replied';
    replyBtn.addEventListener('click', async () => {
      await recordEvent({ id: eventId, kind: 'replied', tone: ctx.tone, length: ctx.length, type: v.type, t: Date.now() });
      replyBtn.classList.add('replied');
      replyBtn.textContent = 'Replied ✓';
      await renderStats();
    });
    actions.appendChild(replyBtn);

    card.appendChild(actions);
    results.appendChild(card);
  });
}

// ---------- reply tracking (local only) ----------

async function recordEvent(ev) {
  const { riff_events } = await getStorage(['riff_events']);
  const events = Array.isArray(riff_events) ? riff_events : [];
  events.push(ev);
  await setStorage({ riff_events: events.slice(-1000) });
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

// ---------- init ----------

document.addEventListener('DOMContentLoaded', async () => {
  await refreshAuthUI();
  await renderStats();
  // Initialize templates list with default purpose + 'other' category
  refreshTemplates('hire', 'other');

  const profile = await loadProfile();

  $('#generate').addEventListener('click', () => {
    if (!profile) return;
    if (!$('#pitch').value.trim()) {
      alert('Add your pitch (1-2 sentences) so the message has something to say.');
      return;
    }
    generate(profile);
  });
});
