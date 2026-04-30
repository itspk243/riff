// Riffly content script.
// Passive read of the candidate profile the user is viewing on LinkedIn,
// Sales Navigator, LinkedIn Recruiter, GitHub, or Wellfound (AngelList).
//
// Each surface has its own DOM. We route on URL and use semantic structure
// (heading levels, section text, aria roles, data attributes) instead of
// CSS classes — those get randomized on LinkedIn, and even on GitHub
// they're not reliable across releases.
//
// Triggered ONLY by an explicit RIFF_EXTRACT_PROFILE message from the popup.
// No background prefetching, no bulk traversal, no automation.

(function () {
  'use strict';

  // ---------- shared utilities ----------

  function safeText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function detectSurface(href) {
    href = href || window.location.href;
    if (/linkedin\.com\/sales\/lead\//.test(href)) return 'sales_navigator';
    if (/linkedin\.com\/talent\/profile\//.test(href)) return 'linkedin_recruiter';
    if (/linkedin\.com\/in\//.test(href)) return 'linkedin_profile';
    if (/(?:^|\/\/)(?:www\.)?wellfound\.com\/(?:u|profile|p)\//.test(href) ||
        /angel\.co\/u\//.test(href)) return 'wellfound';
    // GitHub: profile URL is github.com/<username>, repo is github.com/<username>/<repo>.
    // We match all of github.com in the manifest, but only treat single-segment paths as profiles.
    const ghMatch = href.match(/^https:\/\/github\.com\/([^\/?#]+)\/?(?:[?#].*)?$/);
    if (ghMatch && !/^(orgs|settings|features|pricing|enterprise|about|topics|trending|new|notifications|issues|pulls|search|marketplace|sponsors|explore|login|join|nonprofit)$/i.test(ghMatch[1])) {
      return 'github';
    }
    return 'unknown';
  }

  const SECTION_HEADERS = /^(activity|experience|education|skills|recommendations?|interests?|featured|about|posts|articles|contact\s+info|certifications?|volunteer(?:ing)?|languages?|honors?(?:\s+&\s+awards)?|awards|patents?|publications?|courses?|test\s+scores?|organizations?|causes?|projects?|services?|people\s+(also|you\s+may)\s+know|notifications?|messages?|0\s+notifications)$/i;

  function isSectionHeader(text) {
    if (!text) return true;
    return SECTION_HEADERS.test(text.replace(/\s+/g, ' ').trim());
  }

  function findSectionByHeading(text) {
    const sections = Array.from(document.querySelectorAll('section'));
    return sections.find(s => {
      const h = s.querySelector('h2, h3, [role="heading"]');
      return h && new RegExp('^' + text + '$', 'i').test(safeText(h));
    });
  }

  function visibleTextNodes(root, max) {
    if (!root) return [];
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && out.length < (max || 30)) {
      const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (t.length === 0 || t.length > 300) continue;
      if (/^[·•\-–—,.\s]+$/.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  // ---------- LinkedIn (regular profile) ----------

  function parseLinkedInProfile() {
    const main = document.querySelector('main') || document.body;
    const h2s = Array.from(main.querySelectorAll('h2'));
    let nameEl = h2s.find(h => !isSectionHeader(safeText(h)) && h.offsetWidth > 0);
    if (!nameEl) {
      nameEl = main.querySelector('h1.text-heading-xlarge, h1.inline.t-24, main h1, h1');
    }

    let card = null;
    if (nameEl) {
      card = nameEl.closest('section');
      if (!card) {
        let p = nameEl.parentElement;
        for (let i = 0; i < 6 && p && !card; i++) {
          if (p.tagName === 'SECTION' || p.querySelector('h2 + *')) card = p;
          p = p.parentElement;
        }
        card = card || nameEl.parentElement?.parentElement?.parentElement;
      }
    }

    let headline = '';
    let currentCompany = '';
    if (card) {
      const texts = visibleTextNodes(card);
      const nameText = safeText(nameEl);
      const filtered = texts.filter(t => t !== nameText && !/^(connect|follow|message|more|view|premium)$/i.test(t));
      if (filtered.length > 0) headline = filtered[0];
      if (filtered.length > 1) currentCompany = filtered[1];
    }

    let currentRole = '';
    const expSection = findSectionByHeading('Experience');
    if (expSection) {
      const firstLi = expSection.querySelector('li');
      if (firstLi) {
        const spans = firstLi.querySelectorAll('span[aria-hidden="true"]');
        if (spans[0]) currentRole = (spans[0].textContent || '').trim();
        if (spans[1] && !currentCompany) {
          currentCompany = (spans[1].textContent || '').trim().replace(/\s+·.+$/, '');
        }
      }
    }

    let about = '';
    const aboutSection = findSectionByHeading('About');
    if (aboutSection) {
      const aboutText = aboutSection.querySelector(
        'div.inline-show-more-text, .pv-shared-text-with-see-more, span[aria-hidden="true"]'
      );
      about = safeText(aboutText).slice(0, 2000);
      if (!about) {
        const nodes = visibleTextNodes(aboutSection, 50);
        const longest = nodes.reduce((a, b) => (b.length > a.length ? b : a), '');
        if (longest.length > 30) about = longest.slice(0, 2000);
      }
    }

    // Day 2 enrichment — pull recent posts, skills, past roles when visible
    // on the profile page. All best-effort: missing data is fine, never throw.

    const recentPosts = parseLinkedInRecentPosts();
    const skills = parseLinkedInSkills();
    const pastRoles = parseLinkedInPastRoles(expSection);

    return {
      name: safeText(nameEl),
      headline,
      about,
      currentRole: currentRole || headline,
      currentCompany,
      recentPosts,
      skills,
      pastRoles,
    };
  }

  // Pull up to 3 recent post snippets from the Activity / Posts section on a
  // public LinkedIn profile. The Activity section embeds the user's last few
  // posts as text inside [aria-hidden="true"] spans. Robust to mid-2025 DOM:
  // we look at the section labeled "Activity" or "Posts" (depending on how
  // LinkedIn renders the surface for the viewer).
  function parseLinkedInRecentPosts() {
    const sec =
      findSectionByHeading('Activity') ||
      findSectionByHeading('Posts') ||
      findSectionByHeading('Featured');
    if (!sec) return [];
    const out = [];
    const candidates = sec.querySelectorAll(
      '.feed-shared-update-v2 span[aria-hidden="true"], ' +
      '.update-components-text span[aria-hidden="true"], ' +
      '.profile-creator-shared-feed-update__container span[aria-hidden="true"], ' +
      'span[dir="ltr"]'
    );
    const seen = new Set();
    for (const el of candidates) {
      const t = safeText(el);
      if (!t || t.length < 40 || t.length > 600) continue;
      if (/^(see more|see less|like|comment|share|repost|reposted|liked by|commented on)/i.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 3) break;
    }
    return out;
  }

  // Pull top skills from the Skills section. LinkedIn lists skills with
  // 1 element per skill; we read the first 5-8.
  function parseLinkedInSkills() {
    const sec = findSectionByHeading('Skills');
    if (!sec) return [];
    const items = sec.querySelectorAll('li, .pvs-list__item');
    const out = [];
    const seen = new Set();
    for (const li of items) {
      const t = safeText(li.querySelector('span[aria-hidden="true"], a, span'));
      if (!t || t.length > 60) continue;
      if (/^(show all|endorsed|endorsement)/i.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 8) break;
    }
    return out;
  }

  // Pull the most recent 1-2 past roles from the Experience section,
  // skipping the current role (which is already in currentRole/currentCompany).
  function parseLinkedInPastRoles(expSection) {
    if (!expSection) return [];
    const items = expSection.querySelectorAll('li');
    const out = [];
    // Skip index 0 (current role) — it's already in the main snapshot.
    for (let i = 1; i < items.length && out.length < 2; i++) {
      const li = items[i];
      const spans = li.querySelectorAll('span[aria-hidden="true"]');
      const title = spans[0] ? (spans[0].textContent || '').trim() : '';
      const company = spans[1]
        ? (spans[1].textContent || '').trim().replace(/\s+·.+$/, '')
        : '';
      if (title) {
        out.push(company ? `${title} at ${company}` : title);
      }
    }
    return out;
  }

  // ---------- LinkedIn Sales Navigator ----------

  function parseSalesNavigator() {
    const nameEl =
      document.querySelector('h1[data-anonymize="person-name"]') ||
      document.querySelector('span[data-anonymize="person-name"]') ||
      document.querySelector('header h1') ||
      Array.from(document.querySelectorAll('h2')).find(h => !isSectionHeader(safeText(h)));

    const titleEl =
      document.querySelector('span[data-anonymize="title"]') ||
      document.querySelector('div[data-anonymize="headline"]');

    const companyEl =
      document.querySelector('a[data-anonymize="company-name"]') ||
      document.querySelector('span[data-anonymize="company-name"]');

    let about = '';
    const aboutHeading = Array.from(document.querySelectorAll('h2, h3')).find(h => /^about/i.test(safeText(h)));
    if (aboutHeading) {
      let p = aboutHeading.parentElement;
      for (let i = 0; i < 4 && p; i++) {
        const txt = p.querySelector('p, span[data-anonymize], div[data-anonymize]');
        if (txt) { about = safeText(txt).slice(0, 2000); break; }
        p = p.parentElement;
      }
    }

    return {
      name: safeText(nameEl),
      headline: safeText(titleEl),
      about,
      currentRole: safeText(titleEl),
      currentCompany: safeText(companyEl),
    };
  }

  // ---------- LinkedIn Recruiter ----------

  function parseLinkedInRecruiter() {
    const nameEl =
      document.querySelector('h1[data-test-id="profile-name"]') ||
      document.querySelector('h1[data-test-pinned-comment-id="profile-name"]') ||
      document.querySelector('.profile-info h1') ||
      document.querySelector('header h1') ||
      Array.from(document.querySelectorAll('h2')).find(h => !isSectionHeader(safeText(h)));

    const titleEl =
      document.querySelector('p[data-test-id="profile-headline"]') ||
      document.querySelector('[data-test-id="profile-headline"]') ||
      document.querySelector('.profile-headline');

    const companyEl =
      document.querySelector('[data-test-id="current-company-name"]') ||
      document.querySelector('.current-company');

    let about = '';
    const summaryEl =
      document.querySelector('[data-test-id="profile-summary"]') ||
      document.querySelector('.profile-summary') ||
      document.querySelector('section.summary');
    if (summaryEl) about = safeText(summaryEl).slice(0, 2000);

    return {
      name: safeText(nameEl),
      headline: safeText(titleEl),
      about,
      currentRole: safeText(titleEl),
      currentCompany: safeText(companyEl),
    };
  }

  // ---------- GitHub ----------
  //
  // GitHub profile pages have a stable DOM. The recruiter wedge here is reading
  // pinned-repo READMEs and recent activity — substance the LLM can ground in.
  // We populate the "recentPost" auto field with pinned-repo descriptions so the
  // model has context even if the user doesn't paste anything manually.

  function parseGithub() {
    // Name (display name)
    const nameEl =
      document.querySelector('span.p-name.vcard-fullname') ||
      document.querySelector('[itemprop="name"]') ||
      document.querySelector('h1.vcard-names span.p-name') ||
      document.querySelector('.h-card .p-name');

    // Username
    const usernameEl =
      document.querySelector('span.p-nickname.vcard-username') ||
      document.querySelector('[itemprop="additionalName"]') ||
      document.querySelector('.h-card .p-nickname');

    // Bio
    const bioEl =
      document.querySelector('.user-profile-bio') ||
      document.querySelector('[data-bio-text]') ||
      document.querySelector('div.js-user-profile-bio');

    // Company
    const companyEl =
      document.querySelector('[itemprop="worksFor"]') ||
      document.querySelector('.vcard-detail [aria-label*="Organization" i]');

    // Location
    const locationEl =
      document.querySelector('[itemprop="homeLocation"]') ||
      document.querySelector('.vcard-detail [aria-label*="Home location" i]');

    // Pinned repositories — extract name + description for each
    const pinnedRepos = [];
    const pinnedItems = document.querySelectorAll(
      '.pinned-item-list-item, .js-pinned-items-reorder-list .js-pinned-item, ol.js-pinned-items-reorder-list > li'
    );
    pinnedItems.forEach(item => {
      const repoNameEl = item.querySelector('a span.repo, .repo, [data-repository-hovercards-enabled] a');
      const descEl = item.querySelector('p.pinned-item-desc, .pinned-item-desc, p[itemprop="description"]') || item.querySelector('p');
      const langEl = item.querySelector('[itemprop="programmingLanguage"], span[itemprop="programmingLanguage"]');
      const name = safeText(repoNameEl);
      const desc = safeText(descEl);
      const lang = safeText(langEl);
      if (name) {
        pinnedRepos.push([
          name,
          lang ? `(${lang})` : '',
          desc ? `— ${desc}` : '',
        ].filter(Boolean).join(' '));
      }
    });

    // Top languages bar (language stats sidebar) — fallback signal if no pinned repos
    const langs = [];
    document.querySelectorAll('a[href*="?tab=repositories&language="] .Layout-main, span[aria-label*="of code"]').forEach(el => {
      const t = safeText(el);
      if (t && t.length < 30 && !langs.includes(t)) langs.push(t);
    });

    // Build a synthetic "headline" from bio, or fall back to "GitHub developer"
    const bioText = safeText(bioEl);
    const company = safeText(companyEl);
    const headline = bioText
      ? bioText.slice(0, 200)
      : (company ? `Developer at ${company}` : 'GitHub developer');

    // Build a synthetic "about" combining bio + pinned repo summary so the LLM
    // has substance to ground in even if the recruiter doesn't paste anything.
    const aboutParts = [];
    if (bioText) aboutParts.push(bioText);
    if (pinnedRepos.length > 0) {
      aboutParts.push('Pinned repos: ' + pinnedRepos.slice(0, 4).join('; '));
    }
    if (langs.length > 0) {
      aboutParts.push('Top languages: ' + langs.slice(0, 5).join(', '));
    }
    const about = aboutParts.join('\n\n').slice(0, 2000);

    return {
      name: safeText(nameEl) || safeText(usernameEl),
      headline,
      about,
      currentRole: '', // GitHub doesn't have a structured role field
      currentCompany: company,
    };
  }

  // ---------- Wellfound (formerly AngelList Talent) ----------
  //
  // Wellfound profile pages are auth-walled. When the user is logged in,
  // their session cookies make the content visible; we extract from rendered DOM.
  // Wellfound doesn't randomize class names but they do redesign frequently —
  // we use semantic structure (h1/h2 + role/text patterns) for resilience.

  function parseWellfound() {
    const main = document.querySelector('main') || document.body;

    // Name — first h1 in main that isn't navigation
    const nameEl =
      main.querySelector('h1[data-test="ProfileHeader-name"]') ||
      main.querySelector('h1.styles_name__') ||
      Array.from(main.querySelectorAll('h1')).find(h => h.offsetWidth > 0 && safeText(h).length < 100);

    // Headline / one-liner
    const headlineEl =
      main.querySelector('[data-test="ProfileHeader-tagline"]') ||
      main.querySelector('[data-test="ProfileHeader-oneLiner"]') ||
      // Fallback: text node right after the name
      (nameEl ? nameEl.nextElementSibling : null);

    // Bio / about
    const bioEl =
      main.querySelector('[data-test="ProfileSection-bio"]') ||
      main.querySelector('[data-test="ProfileBio"]') ||
      main.querySelector('div.styles_bio__');

    // Current role / company — Wellfound profiles have an "Experience" section
    let currentRole = '';
    let currentCompany = '';
    const expSection =
      Array.from(main.querySelectorAll('section, div')).find(s => {
        const h = s.querySelector('h2, h3, [role="heading"]');
        return h && /experience|work\s+history/i.test(safeText(h));
      });
    if (expSection) {
      const firstItem = expSection.querySelector('article, li, div[role="article"]');
      if (firstItem) {
        const itemTexts = visibleTextNodes(firstItem, 8);
        if (itemTexts[0]) currentRole = itemTexts[0];
        if (itemTexts[1]) currentCompany = itemTexts[1];
      }
    }

    let about = safeText(bioEl).slice(0, 2000);
    if (!about) {
      // Fallback: longest text node on the page that isn't the headline
      const nodes = visibleTextNodes(main, 80);
      const longest = nodes.filter(t => t.length > 60).reduce((a, b) => (b.length > a.length ? b : a), '');
      if (longest && longest !== safeText(headlineEl)) about = longest.slice(0, 2000);
    }

    return {
      name: safeText(nameEl),
      headline: safeText(headlineEl),
      about,
      currentRole: currentRole || safeText(headlineEl),
      currentCompany,
    };
  }

  // ---------- main extractor ----------

  function extractProfile() {
    const surface = detectSurface();
    let parsed;
    switch (surface) {
      case 'sales_navigator':
        parsed = parseSalesNavigator();
        break;
      case 'linkedin_recruiter':
        parsed = parseLinkedInRecruiter();
        break;
      case 'github':
        parsed = parseGithub();
        break;
      case 'wellfound':
        parsed = parseWellfound();
        break;
      case 'linkedin_profile':
      default:
        parsed = parseLinkedInProfile();
        break;
    }

    return {
      profileUrl: window.location.href,
      surface,
      name: parsed.name,
      headline: parsed.headline,
      about: parsed.about,
      currentRole: parsed.currentRole,
      currentCompany: parsed.currentCompany,
      // Day 2 enrichment — only LinkedIn parses these today, but the field
      // contract is consistent across surfaces so the backend prompt can ground
      // in whatever's available without per-surface branching.
      recentPosts: parsed.recentPosts || [],
      skills: parsed.skills || [],
      pastRoles: parsed.pastRoles || [],
      capturedAt: new Date().toISOString(),
    };
  }

  // ---------- LinkedIn search-results scraping (Plus tier — Saved-Search Daily Digest) ----------
  //
  // When the user is on a /search/results/people/* URL and asks the popup to
  // "scan visible profiles", we walk the visible search-result cards and
  // extract { profileUrl, name, headline, currentRole } for each.
  //
  // Strict capture limits:
  //   - Only currently rendered cards (no infinite-scroll trigger)
  //   - Cap at 25 to match backend's MAX_PROFILES_PER_SCAN
  //   - Skip ads, "Open profile" prompts, and entries without a /in/ URL
  //
  // No automation. Just like profile parsing, this requires explicit user click.
  function isLinkedInSearchResultsUrl(href) {
    href = href || window.location.href;
    return /^https:\/\/www\.linkedin\.com\/search\/results\/(people|all)\b/.test(href);
  }

  function extractLinkedInSearchResults() {
    const MAX = 25;
    const out = [];
    const seen = new Set();

    // LinkedIn renders search-result cards as <li> items in a UL inside the main
    // results container. The DOM classes change but structure is stable enough:
    // each card has an <a href="https://www.linkedin.com/in/..."> anchor with
    // the candidate name, plus 1–3 small text rows for headline / location /
    // current role context.
    const anchors = Array.from(
      document.querySelectorAll('a[href*="/in/"]')
    ).filter((a) => a.offsetParent !== null);

    for (const a of anchors) {
      if (out.length >= MAX) break;
      let href = a.href || '';
      // Strip query/fragment to dedupe anchors that point at the same profile
      // with different miniProfileUrn params.
      href = href.replace(/[?#].*$/, '').replace(/\/$/, '');
      if (!/\/in\/[^/]+$/.test(href)) continue;
      if (seen.has(href)) continue;

      // The visible name is usually inside this anchor — but the same profile
      // is also linked from the avatar (image-only). Prefer anchors with text.
      const aText = safeText(a);
      if (!aText) continue;
      // Skip "Open profile in a new tab" and other UI affordances.
      if (/^(open\s+profile|see\s+full|view\s+profile|status\s+is)/i.test(aText)) continue;
      // Skip your own profile if it sneaks in (Me menu).
      if (/^(me|home|premium)$/i.test(aText)) continue;

      // Walk up to the result-card container. LinkedIn nests deeply; cap at 8.
      let card = a;
      for (let i = 0; i < 8 && card; i++) {
        card = card.parentElement;
        if (!card) break;
        // A search card is roughly any LI/DIV that contains a heading + a
        // subtitle line. We stop as soon as we find the smallest such block.
        if (card.tagName === 'LI' || (card.querySelector('img') && card.offsetHeight > 60)) break;
      }
      if (!card) continue;

      const allText = visibleTextNodes(card, 12);
      const filtered = allText.filter(
        (t) => t !== aText && !/^(connect|follow|message|more|view\s+profile|·|\d+(?:st|nd|rd|th)\b)$/i.test(t)
      );

      // First non-name text is typically the headline; the second is current
      // role/company or location. Heuristic, but clean enough.
      const headline = filtered[0] || '';
      const currentRole = filtered[1] || '';

      seen.add(href);
      out.push({
        profileUrl: href,
        name: aText,
        headline,
        currentRole,
        currentCompany: '',
        about: '',
        capturedAt: new Date().toISOString(),
      });
    }

    return out;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'RIFF_EXTRACT_PROFILE') {
      try {
        const profile = extractProfile();
        sendResponse({ ok: true, profile });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return true;
    }
    if (msg && msg.type === 'RIFF_EXTRACT_SEARCH_RESULTS') {
      try {
        if (!isLinkedInSearchResultsUrl(window.location.href)) {
          sendResponse({ ok: false, error: 'Not on a LinkedIn search-results page.' });
          return true;
        }
        const profiles = extractLinkedInSearchResults();
        sendResponse({ ok: true, profiles, currentUrl: window.location.href });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return true;
    }
  });
})();
