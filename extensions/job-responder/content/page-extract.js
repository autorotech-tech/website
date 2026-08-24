(function () {
  if (window.__JR_PAGE_EXTRACT_READY__) return;
  window.__JR_PAGE_EXTRACT_READY__ = true;

  const HH_HOSTS = {
    ru: /(^|\.)hh\.ru$/i,
    kz: /(^|\.)hh\.kz$/i,
    uz: /(^|\.)hh\.uz$/i,
  };

  const JOB_SITE_HINTS = [
    'remote.co',
    'getmatch.ru',
    'finder.work',
    'relocate.me',
    'cryptojobslist.com',
    'web3.career',
    'workingnomads.com',
    'aijobs.net',
    'simplyhired.com',
    'jobgether.com',
    'flexjobs.com',
    'powertofly.com',
    'crossover.com',
    'justremote.co',
    'foorilla.com',
    'instahyre.com',
    'hh.ru',
    'hh.kz',
    'hh.uz',
  ];

  function detectHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    for (const [key, pattern] of Object.entries(HH_HOSTS)) {
      if (pattern.test(host)) return key;
    }
    return 'web';
  }

  function textOf(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isHhPage() {
    return detectHost(location.hostname) !== 'web';
  }

  function siteHost() {
    return String(location.hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function extractQuestions() {
    const questions = [];
    const blocks = document.querySelectorAll(
      '[data-qa="vacancy-response-popup-form-field"], .vacancy-response-popup-form-field, label, legend'
    );
    blocks.forEach((block) => {
      const label = textOf(block.querySelector('[data-qa="label"], .label, label, span'));
      const q = label || textOf(block);
      if (q && q.length > 3 && q.length < 500 && !questions.includes(q)) {
        questions.push(q);
      }
    });
    return questions.slice(0, 20);
  }

  function siteSpecificSelectors() {
    const host = siteHost();
    const map = {
      'remote.co': ['.job_description', '.job-description', 'article.job'],
      'getmatch.ru': ['.vacancy-description', '[class*="Vacancy"]', 'article'],
      'finder.work': ['.job-description', '[data-testid*="description"]', 'article'],
      'relocate.me': ['.job-description', '.vacancy-content', 'article'],
      'cryptojobslist.com': ['.job-description', '.description', 'article'],
      'web3.career': ['.job-description', '#job-description', 'article'],
      'workingnomads.com': ['.job-description', '.description', 'article'],
      'aijobs.net': ['.job-description', '.description', 'article'],
      'simplyhired.com': ['[data-testid="viewJobBodyDescriptionSection"]', '.jobposting-description'],
      'jobgether.com': ['.job-description', '[class*="description"]', 'article'],
      'flexjobs.com': ['.job-description', '#job-description', 'article'],
      'powertofly.com': ['.job-description', '[class*="Description"]', 'article'],
      'crossover.com': ['.job-description', '[class*="description"]', 'article'],
      'justremote.co': ['.job-description', 'article'],
      'foorilla.com': ['.job-description', 'article'],
      'instahyre.com': ['.job-description', '#job-description', 'article'],
    };
    for (const key of Object.keys(map)) {
      if (host === key || host.endsWith('.' + key)) return map[key];
    }
    return [];
  }

  function extractMainText() {
    const selectors = [
      ...siteSpecificSelectors(),
      '[data-qa="vacancy-description"]',
      '[data-qa="vacancy-branded"]',
      '.vacancy-description',
      '.g-user-content',
      'article',
      'main',
      '[role="main"]',
      '#content',
      '.content',
      '.job-description',
      '.job_description',
      '.posting',
      '.description',
      '[itemprop="description"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = textOf(el);
      if (t && t.length >= 80) return t.slice(0, 20000);
    }
    let best = '';
    document.querySelectorAll('article, main, section, div').forEach((el) => {
      if (el.querySelector('nav, footer, header')) return;
      const t = textOf(el);
      if (t.length > best.length && t.length < 40000) best = t;
    });
    return (best || textOf(document.body)).slice(0, 20000);
  }

  function extractCompany() {
    const selectors = [
      '[data-qa="vacancy-company-name"]',
      '[data-qa="vacancy-serp__vacancy-employer"]',
      'a[data-qa="vacancy-company-name"]',
      '[itemprop="hiringOrganization"]',
      '[itemprop="hiringOrganization"] [itemprop="name"]',
      '.company-name',
      '.employer',
      '.company',
      'a[href*="/company"]',
    ];
    for (const sel of selectors) {
      const t = textOf(document.querySelector(sel));
      if (t && t.length < 200) return t.slice(0, 300);
    }
    return '';
  }

  function extractTitle() {
    const selectors = [
      '[data-qa="vacancy-title"]',
      'h1[data-qa]',
      'h1',
      '[itemprop="title"]',
      'meta[property="og:title"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.tagName === 'META') {
        const c = String(el.getAttribute('content') || '').trim();
        if (c) return c.slice(0, 300);
      } else {
        const t = textOf(el);
        if (t) return t.slice(0, 300);
      }
    }
    return String(document.title || 'Vacancy').slice(0, 300);
  }

  function matchLine(text, patterns) {
    const lines = String(text || '').split(/\n+/);
    for (const line of lines) {
      const clean = line.replace(/\s+/g, ' ').trim();
      if (!clean || clean.length > 280) continue;
      for (const re of patterns) {
        const m = clean.match(re);
        if (m) return (m[1] || m[0] || clean).trim().slice(0, 300);
      }
    }
    // also search collapsed text
    const flat = String(text || '').replace(/\s+/g, ' ');
    for (const re of patterns) {
      const m = flat.match(re);
      if (m) return (m[1] || m[0] || '').trim().slice(0, 300);
    }
    return '';
  }

  function extractKeySkills(rootText) {
    const skills = [];
    const skillNodes = document.querySelectorAll(
      '[data-qa="skills-element"], [data-qa="bloko-tag__text"], .bloko-tag__section_text, .skill, .tag, [class*="skill"]'
    );
    skillNodes.forEach((el) => {
      const t = textOf(el);
      if (t && t.length >= 2 && t.length <= 60 && !skills.includes(t)) skills.push(t);
    });

    const block = matchLine(rootText, [
      /(?:ключевые навыки|key skills|skills|required skills|требования к навыкам)[:\s]+(.{5,400})/i,
    ]);
    if (block) {
      block.split(/[,;/|•·]/).forEach((p) => {
        const s = p.trim();
        if (s && s.length >= 2 && s.length <= 60 && !skills.includes(s)) skills.push(s);
      });
    }
    return skills.slice(0, 30);
  }

  function extractStructured(description) {
    const blob = [description, textOf(document.body)].filter(Boolean).join('\n');

    const salary =
      matchLine(blob, [
        /(?:уровень дохода|зарплата|salary|compensation|pay)[:\s]+(.{3,120})/i,
        /(\$[\d,.]+(?:\s*[-–]\s*\$?[\d,.]+)?(?:\s*(?:k|K|\/yr|\/year|в год|в месяц))?)/,
        /(\d[\d\s]{2,}\s*(?:₽|руб|USD|EUR|\$).*?(?:на руки|до вычета|gross|net)?)/i,
      ]) ||
      textOf(document.querySelector('[data-qa="vacancy-salary"], [itemprop="baseSalary"], .salary')) ||
      '';

    const experience =
      matchLine(blob, [
        /(?:опыт работы|experience|exp\.?)[:\s]+(.{2,120})/i,
        /(\d+\s*[-–—]\s*\d+\s*(?:лет|года|years))/i,
        /(без опыта|no experience|entry[- ]level)/i,
      ]) ||
      textOf(document.querySelector('[data-qa="vacancy-experience"], [data-qa="vacancy-experience"] span')) ||
      '';

    const employmentType =
      matchLine(blob, [
        /(?:тип занятости|занятость|employment(?: type)?)[:\s]+(.{2,100})/i,
        /(частичная занятость|полная занятость|part[- ]time|full[- ]time|contract|freelance)/i,
      ]) || '';

    const schedule =
      matchLine(blob, [
        /(?:график(?: работы)?)[:\s]+(.{2,80})/i,
        /(график[:\s]+)?(5\/2|2\/2|сменн\w*|flexible schedule)/i,
      ]) || '';

    const workingHours =
      matchLine(blob, [
        /(?:рабочие часы|working hours|hours)[:\s]+(.{2,120})/i,
        /(по договор[её]нности|flexible hours|\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})/i,
      ]) || '';

    const workFormat =
      matchLine(blob, [
        /(?:формат работы|work format|work type|location type)[:\s]+(.{2,100})/i,
        /(удал[её]нн\w*|remote|hybrid|гибрид\w*|офис\w*|on[- ]site|work from home)/i,
      ]) ||
      textOf(document.querySelector('[data-qa="vacancy-view-employment-mode"], [data-qa="vacancy-view-location"]')) ||
      '';

    const location =
      matchLine(blob, [
        /(?:локация|location|город|city)[:\s]+(.{2,100})/i,
      ]) ||
      textOf(document.querySelector('[data-qa="vacancy-view-raw-address"], [itemprop="jobLocation"]')) ||
      '';

    let seniority = '';
    const titleLower = (extractTitle() || '').toLowerCase();
    if (/\b(senior|lead|principal|сеньор)\b/i.test(titleLower + ' ' + blob.slice(0, 500))) seniority = 'senior';
    else if (/\b(middle|mid|мидл)\b/i.test(titleLower + ' ' + blob.slice(0, 500))) seniority = 'middle';
    else if (/\b(junior|intern|джун)\b/i.test(titleLower + ' ' + blob.slice(0, 500))) seniority = 'junior';

    const keySkills = extractKeySkills(blob);

    return {
      salary: salary || (blob.match(/уровень дохода не указан/i) ? 'Уровень дохода не указан' : ''),
      experience: experience || '',
      employmentType: employmentType || '',
      schedule: schedule || '',
      workingHours: workingHours || '',
      workFormat: workFormat || '',
      keySkills,
      seniority: seniority || '',
      location: location || '',
    };
  }

  function extractVacancy() {
    const host = detectHost(location.hostname);
    const title = extractTitle();
    const company = extractCompany();
    const description = extractMainText();
    const questions = isHhPage() ? extractQuestions() : [];
    const structured = extractStructured(description);
    const knownSite = JOB_SITE_HINTS.some((s) => siteHost() === s || siteHost().endsWith('.' + s));

    return {
      url: location.href,
      title: title || document.title || 'Vacancy',
      company,
      description,
      questions,
      structured,
      host,
      source: isHhPage() ? 'hh' : knownSite ? 'job_board' : 'page',
      siteHost: siteHost(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'JR_EXTRACT_VACANCY') return false;
    try {
      const vacancy = extractVacancy();
      if (!vacancy.description || vacancy.description.length < 40) {
        sendResponse({
          ok: false,
          error: 'Не удалось извлечь достаточно текста со страницы. Вставьте описание вручную.',
        });
        return true;
      }
      sendResponse({ ok: true, vacancy });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
    return true;
  });
})();
