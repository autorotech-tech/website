(function () {
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
    return 'ru';
  }

  function textOf(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function extractQuestions() {
    const questions = [];
    const blocks = document.querySelectorAll(
      '[data-qa="vacancy-response-popup-form-field"], .vacancy-response-popup-form-field, label'
    );
    blocks.forEach((block) => {
      const label = textOf(block.querySelector('[data-qa="label"], .label, label'));
      const q = label || textOf(block);
      if (q && q.length > 3 && q.length < 500 && !questions.includes(q)) {
        questions.push(q);
      }
    });
    return questions.slice(0, 20);
  }

  function extractVacancy() {
    const title =
      textOf(document.querySelector('[data-qa="vacancy-title"], h1')) || document.title;
    const company =
      textOf(
        document.querySelector(
          '[data-qa="vacancy-company-name"], [data-qa="vacancy-serp__vacancy-employer"], a[data-qa="vacancy-company-name"]'
        )
      ) || '';
    const descriptionEl =
      document.querySelector('[data-qa="vacancy-description"], [data-qa="vacancy-branded"]') ||
      document.querySelector('.vacancy-description, .g-user-content');
    const description = textOf(descriptionEl) || textOf(document.body).slice(0, 12000);
    return {
      url: location.href,
      title,
      company,
      description,
      questions: extractQuestions(),
      host: detectHost(location.hostname),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'JR_EXTRACT_VACANCY') return;
    try {
      const vacancy = extractVacancy();
      if (!vacancy.title || !vacancy.description) {
        sendResponse({ ok: false, error: 'Vacancy title or description not found on page' });
        return;
      }
      sendResponse({ ok: true, vacancy });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  });
})();
