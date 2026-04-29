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
  if (!token || token.length < 20) { showToast("That doesn't look like a valid token. Copy it from your dashboard and try again.", 'error'); return; }
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

      // Day 1: check if we've already drafted to this candidate. Surface a
      // follow-up nudge if there's a sent event with no reply yet.
      checkPriorThread(tab.url);

      resolve(p);
    });
  });
}

// ---------- prior-thread detection (Day 1 follow-up loop) ----------

function checkPriorThread(candidateUrl) {
  if (!candidateUrl) return;
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
    if (!resp || !resp.ok) {
      if (resp && resp.needsAuth) {
        $('#auth-section').classList.remove('hidden');
      }
      showToast(resp && resp.error ? resp.error : 'Generation failed. Try again in a moment.', 'error');
      return;
    }
    // Quota label — uses 3/wk now (free tier was tightened from 5).
    if (typeof resp.remainingThisWeek === 'number') {
      const q = $('#quota');
      q.textContent = `${resp.remainingThisWeek} / 3 free this week`;
      q.classList.toggle('urgent', resp.remainingThisWeek <= 1);
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
  hint.innerHTML = `${escapeHtml(message)} <a href="https://riff-sandy.vercel.app/dashboard" target="_blank">Upgrade →</a>`;
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
function sendServerEvent(kind, variantType, ctx) {
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

  // ---------- Day 1: saved templates panel ----------

  let templatesCache = null;

  $('#templates-toggle').addEventListener('click', async () => {
    const panel = $('#templates-panel');
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="templates-empty">Loading…</div>';
    chrome.runtime.sendMessage({ type: 'RIFF_TEMPLATES_LIST' }, (resp) => {
      if (!resp || !resp.ok) {
        panel.innerHTML = `<div class="templates-empty">${resp && resp.needsAuth ? 'Sign in to use templates.' : 'Could not load templates.'}</div>`;
        return;
      }
      templatesCache = resp.templates || [];
      renderTemplatesPanel(panel, templatesCache);
    });
  });

  function renderTemplatesPanel(panel, templates) {
    panel.innerHTML = '';
    if (templates.length === 0) {
      panel.innerHTML = '<div class="templates-empty">No saved templates yet. Click <strong>Save…</strong> after writing a pitch.</div>';
      return;
    }
    for (const t of templates) {
      const row = document.createElement('div');
      row.className = 'template-row';
      const main = document.createElement('div');
      main.style.flex = '1';
      main.innerHTML = `
        <div class="tname"></div>
        <div class="tmeta"></div>
      `;
      main.querySelector('.tname').textContent = t.name;
      main.querySelector('.tmeta').textContent = `${t.purpose || 'hire'} · ${t.pitch.slice(0, 60)}${t.pitch.length > 60 ? '…' : ''}`;
      main.addEventListener('click', () => {
        const pitchEl = $('#pitch');
        if (pitchEl.value.trim() && !confirm('Replace your current pitch?')) return;
        pitchEl.value = t.pitch;
        if (t.purpose) $('#purpose').value = t.purpose;
        panel.classList.add('hidden');
      });
      row.appendChild(main);

      const del = document.createElement('button');
      del.className = 'tdel';
      del.title = 'Delete this template';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${t.name}"?`)) return;
        chrome.runtime.sendMessage({ type: 'RIFF_TEMPLATES_DELETE', payload: { id: t.id } }, (resp) => {
          if (resp && resp.ok) {
            templatesCache = templatesCache.filter(x => x.id !== t.id);
            renderTemplatesPanel(panel, templatesCache);
          } else {
            showToast('Could not delete template.', 'error');
          }
        });
      });
      row.appendChild(del);

      panel.appendChild(row);
    }
  }

  $('#template-save').addEventListener('click', () => {
    const pitch = $('#pitch').value.trim();
    if (!pitch) {
      showToast('Write a pitch first, then save it.', 'error');
      return;
    }
    const name = prompt('Name this pitch (e.g. "Senior Eng · Series A · $250K"):');
    if (!name || !name.trim()) return;
    const purpose = $('#purpose').value || 'hire';
    chrome.runtime.sendMessage(
      { type: 'RIFF_TEMPLATES_CREATE', payload: { name: name.trim(), pitch, purpose } },
      (resp) => {
        if (!resp || !resp.ok) {
          showToast(resp && resp.error ? resp.error : 'Could not save template.', 'error');
          return;
        }
        showToast(`Saved "${name.trim()}".`, 'info');
        // invalidate cache so next open re-fetches
        templatesCache = null;
      }
    );
  });
});
