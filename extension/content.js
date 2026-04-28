// Riff content script.
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

    return {
      name: safeText(nameEl),
      headline,
      about,
      currentRole: currentRole || headline,
      currentCompany,
    };
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
      capturedAt: new Date().toISOString(),
    };
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
  });
})();
