(function () {
  if (window.__JR_PAGE_EXTRACT_READY__) return;
  window.__JR_PAGE_EXTRACT_READY__ = true;

  const HH_HOSTS = {
    ru: /(^|\.)hh\.ru$/i,
    kz: /(^|\.)hh\.kz$/i,
    uz: /(^|\.)hh\.uz$/i,
  };

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

  function extractMainText() {
    const selectors = [
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
      '.posting',
      '.description',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = textOf(el);
      if (t && t.length >= 80) return t.slice(0, 20000);
    }
    // Fallback: largest text block among common containers
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
      '.company-name',
      '.employer',
    ];
    for (const sel of selectors) {
      const t = textOf(document.querySelector(sel));
      if (t) return t.slice(0, 300);
    }
    return '';
  }

  function extractTitle() {
    const selectors = [
      '[data-qa="vacancy-title"]',
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

  function extractVacancy() {
    const host = detectHost(location.hostname);
    const title = extractTitle();
    const company = extractCompany();
    const description = extractMainText();
    const questions = isHhPage() ? extractQuestions() : [];
    return {
      url: location.href,
      title: title || document.title || 'Vacancy',
      company,
      description,
      questions,
      host,
      source: isHhPage() ? 'hh' : 'page',
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
