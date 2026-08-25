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

  const FORM_TYPE_MAP = {
    0: 'short_text',
    1: 'paragraph',
    2: 'multiple_choice',
    3: 'dropdown',
    4: 'checkboxes',
    5: 'linear_scale',
    7: 'grid',
    9: 'date',
    10: 'time',
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

  function siteHost() {
    return String(location.hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isGoogleFormPage() {
    const host = siteHost();
    if (host !== 'docs.google.com') return false;
    return /\/forms\//i.test(location.pathname) || /viewform|formResponse/i.test(location.href);
  }

  function stripHtml(s) {
    return String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pushQuestion(list, seen, q) {
    const text = stripHtml(q?.text || '').slice(0, 4000);
    if (!text || text.length < 2) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const options = Array.isArray(q?.options)
      ? q.options.map((o) => stripHtml(o)).filter(Boolean).slice(0, 40)
      : [];
    list.push({
      id: String(q?.id || list.length + 1).slice(0, 128),
      text,
      type: String(q?.type || 'text').slice(0, 64),
      options,
    });
  }

  /** Parse FB_PUBLIC_LOAD_DATA_ embedded in Google Forms HTML (most reliable). */
  function extractGoogleFormFromFbData() {
    const scripts = Array.from(document.querySelectorAll('script'));
    let raw = '';
    for (const s of scripts) {
      const t = s.textContent || '';
      const idx = t.indexOf('FB_PUBLIC_LOAD_DATA_');
      if (idx < 0) continue;
      const eq = t.indexOf('=', idx);
      if (eq < 0) continue;
      let i = eq + 1;
      while (i < t.length && /\s/.test(t[i])) i += 1;
      if (t[i] !== '[') continue;
      let depth = 0;
      let end = -1;
      for (let j = i; j < t.length; j += 1) {
        const ch = t[j];
        if (ch === '[') depth += 1;
        else if (ch === ']') {
          depth -= 1;
          if (depth === 0) {
            end = j + 1;
            break;
          }
        }
      }
      if (end > i) {
        raw = t.slice(i, end);
        break;
      }
    }
    if (!raw) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(data) || !Array.isArray(data[1])) return null;
    const form = data[1];
    const title =
      stripHtml(document.title || '') ||
      (typeof form[8] === 'string' ? stripHtml(form[8]) : '') ||
      'Google Form';
    let description = '';
    let questionsRaw = null;
    for (const item of form) {
      if (typeof item === 'string' && item.trim().length > 10 && !description) {
        description = stripHtml(item).slice(0, 2000);
      }
      if (
        Array.isArray(item) &&
        item.length &&
        Array.isArray(item[0]) &&
        typeof item[0][1] === 'string' &&
        typeof item[0][3] === 'number'
      ) {
        questionsRaw = item;
      }
    }
    const questions = [];
    const seen = new Set();
    if (Array.isArray(questionsRaw)) {
      for (const q of questionsRaw) {
        if (!Array.isArray(q) || q.length < 4) continue;
        const qid = q[0];
        const qtext = q[1];
        const qtypeNum = q[3];
        const opts = [];
        if (Array.isArray(q[4])) {
          for (const opt of q[4]) {
            if (Array.isArray(opt) && typeof opt[0] === 'string' && opt[0].trim()) {
              // entry option rows are often [entryId, null, required] for text fields
              // or [null, optionLabel] / [optionId, optionLabel]
              if (typeof opt[1] === 'string' && opt[1].trim()) opts.push(opt[1]);
            } else if (Array.isArray(opt) && typeof opt[1] === 'string' && opt[1].trim()) {
              opts.push(opt[1]);
            }
          }
          // multiple choice: options nested deeper
          for (const opt of q[4]) {
            if (!Array.isArray(opt)) continue;
            for (const nested of opt) {
              if (Array.isArray(nested) && typeof nested[0] === 'string' && nested[0].length > 0 && nested[0].length < 300) {
                // skip numeric-looking entry ids when label is elsewhere
                if (!/^\d{6,}$/.test(nested[0]) && nested[1] == null) {
                  // sometimes [label] only
                }
              }
              if (Array.isArray(nested) && typeof nested[1] === 'string' && nested[1].trim()) {
                opts.push(nested[1]);
              }
            }
          }
        }
        // Classic MC: q[4] = [[entryId, [[null, label], ...], ...]]
        if (Array.isArray(q[4]) && q[4][0] && Array.isArray(q[4][0][1])) {
          for (const choice of q[4][0][1]) {
            if (Array.isArray(choice) && typeof choice[1] === 'string' && choice[1].trim()) {
              opts.push(choice[1]);
            } else if (Array.isArray(choice) && typeof choice[0] === 'string' && choice[0].trim() && choice[1] == null) {
              // rare
            }
          }
        }
        pushQuestion(questions, seen, {
          id: qid,
          text: qtext,
          type: FORM_TYPE_MAP[qtypeNum] || `type_${qtypeNum}`,
          options: [...new Set(opts.map(stripHtml).filter(Boolean))],
        });
      }
    }
    return {
      title: title.slice(0, 300) || 'Google Form',
      description: description || '',
      questions,
    };
  }

  function extractGoogleFormFromDom() {
    const questions = [];
    const seen = new Set();
    const roots = document.querySelectorAll(
      [
        '.freebirdFormviewerComponentsQuestionBaseRoot',
        '.Qr7Oae',
        '[role="listitem"]',
        'div[data-params]',
      ].join(', ')
    );
    roots.forEach((root, idx) => {
      const titleEl =
        root.querySelector(
          '.freebirdFormviewerComponentsQuestionBaseTitle, .M7eMe, [role="heading"], .exportItemTitle'
        ) || root.querySelector('div[aria-label], span');
      let text = textOf(titleEl);
      if (!text || text.length < 2) {
        const aria = root.getAttribute('aria-label') || '';
        text = stripHtml(aria);
      }
      // skip chrome like "Required question"
      if (/^(required|обязательн)/i.test(text)) return;
      if (text.length < 3 || text.length > 2000) return;

      const options = [];
      root.querySelectorAll('[role="radio"], [role="checkbox"], .docssharedWizToggleLabeledLabelText, .aDTYNe').forEach((el) => {
        const o = textOf(el);
        if (o && o.length >= 1 && o.length <= 200 && !options.includes(o)) options.push(o);
      });

      let type = 'text';
      if (root.querySelector('textarea')) type = 'paragraph';
      else if (root.querySelector('[role="radiogroup"], [role="radio"]')) type = 'multiple_choice';
      else if (root.querySelector('[role="checkbox"]')) type = 'checkboxes';
      else if (root.querySelector('select')) type = 'dropdown';

      pushQuestion(questions, seen, { id: idx + 1, text, type, options });
    });
    return questions;
  }

  function extractGoogleForm() {
    const fromFb = extractGoogleFormFromFbData();
    const domQs = extractGoogleFormFromDom();
    const questions = [];
    const seen = new Set();
    for (const q of [...(fromFb?.questions || []), ...domQs]) {
      pushQuestion(questions, seen, q);
    }
    const title =
      (fromFb?.title && fromFb.title.length > 3 ? fromFb.title : '') ||
      textOf(document.querySelector('[role="heading"], .freebirdFormviewerViewHeaderTitle, h1')) ||
      stripHtml(document.title) ||
      'Google Form';
    const description =
      (fromFb?.description || '') ||
      textOf(
        document.querySelector(
          '.freebirdFormviewerViewHeaderDescription, .mG8P6, [data-params] .gOV6he'
        )
      ) ||
      '';
    const qLines = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
    const descParts = [
      description,
      questions.length ? `Вопросы формы (${questions.length}):\n${qLines}` : '',
    ].filter(Boolean);
    return {
      url: location.href,
      title: title.slice(0, 300),
      company: '',
      description: descParts.join('\n\n').slice(0, 20000) || title,
      questions,
      structured: {},
      host: 'web',
      source: 'google_form',
      siteHost: siteHost(),
      pageKind: 'google_form',
    };
  }

  /** Tables with явный вопрос/ответ header - not vacancy FAQ / filters. */
  function extractTableQuestions() {
    const questions = [];
    const seen = new Set();
    document.querySelectorAll('table').forEach((table, tIdx) => {
      // skip tables inside nav/aside/footer or tiny filter widgets
      if (table.closest('nav, aside, footer, [role="navigation"], [class*="filter"], [class*="sidebar"]')) {
        return;
      }
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2 || rows.length > 60) return;
      const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(textOf);
      const headerJoin = headerCells.join(' ').toLowerCase();
      const looksLikeQa =
        (/вопрос|question/.test(headerJoin) && /ответ|answer/.test(headerJoin)) ||
        (/^вопрос$/i.test(headerCells[0] || '') && headerCells.length >= 2);

      // Without clear Q/A headers do not treat random tables as application forms
      if (!looksLikeQa) return;

      for (let r = 1; r < rows.length; r += 1) {
        const cells = Array.from(rows[r].querySelectorAll('th, td')).map(textOf);
        if (!cells.length) continue;
        const qIdx = headerCells.findIndex((h) => /вопрос|question|^q$/i.test(h));
        const text = cells[qIdx >= 0 ? qIdx : 0] || '';
        if (!text || isVacancyMetaFaq(text)) continue;
        // Skip answer-only / empty prompt rows
        if (text.length < 8 || text.length > 800) continue;
        pushQuestion(questions, seen, {
          id: `t${tIdx}_${r}`,
          text,
          type: 'table',
          options: [],
        });
      }
    });
    return questions.slice(0, 40);
  }

  /**
   * HH employer questionnaire on /applicant/vacancy_response (and response popup).
   * Real markup (hh Lux/Magritte): [data-qa="task-question"] + inputs name="task_<id>" / task_<id>_text.
   * Do NOT scrape vacancy FAQ / chat quick-replies ("Где располагается место работы?").
   */
  function isHhVacancyResponsePage() {
    if (!isHhPage()) return false;
    const path = String(location.pathname || '');
    return /\/applicant\/vacancy_response/i.test(path);
  }

  function cleanTaskQuestionText(raw) {
    return stripHtml(raw)
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\bписать тут\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function isCoverLetterPrompt(text) {
    const t = String(text || '').toLowerCase();
    return /сопровод|cover\s*letter|письмо к отклику|письмо работодателя/.test(t) && t.length < 80;
  }

  function collectTaskOptionLabels(inputs) {
    const options = [];
    (inputs || []).forEach((r) => {
      const label = r.closest('label') || r.closest('[class*="magritte"]') || r.parentElement;
      let opt =
        textOf(label?.querySelector('[data-qa="task-option-text"], [data-qa*="option-text"], .task-option-text')) ||
        textOf(label);
      opt = cleanTaskQuestionText(opt);
      if (!opt || opt.length > 200) return;
      if (/^писать тут$/i.test(opt) || isVacancyMetaFaq(opt)) return;
      if (!options.includes(opt)) options.push(opt);
    });
    return options;
  }

  function findTaskQuestionText(taskId, index, titleEls) {
    const radios = document.querySelectorAll(`input[type="radio"][name="task_${taskId}"]`);
    const checks = document.querySelectorAll(`input[type="checkbox"][name="task_${taskId}"]`);
    const textEl =
      document.querySelector(`[name="task_${taskId}_text"]`) ||
      document.querySelector(`textarea[name="task_${taskId}"]`);
    const anchor = radios[0] || checks[0] || textEl;
    if (anchor) {
      const block =
        anchor.closest('[data-qa*="task"]') ||
        anchor.closest('.bloko-form-item') ||
        anchor.closest('fieldset') ||
        anchor.closest('[class*="FormItem"]') ||
        anchor.closest('form > div') ||
        anchor.parentElement;
      const tq =
        block?.querySelector('[data-qa="task-question"]') ||
        block?.querySelector('[data-qa*="task-question"]') ||
        block?.querySelector('legend') ||
        block?.querySelector('h2, h3, h4') ||
        block?.querySelector('label');
      const fromBlock = cleanTaskQuestionText(textOf(tq));
      if (fromBlock && fromBlock.length >= 4) return fromBlock;
    }
    if (titleEls[index]) {
      const fromTitle = cleanTaskQuestionText(textOf(titleEls[index]));
      if (fromTitle && fromTitle.length >= 4) return fromTitle;
    }
    // aria-label / placeholder on textarea as last resort (often empty or "Писать тут")
    if (textEl) {
      const aria = cleanTaskQuestionText(
        textEl.getAttribute('aria-label') || textEl.getAttribute('placeholder') || ''
      );
      if (aria && aria.length >= 8 && !/^писать тут$/i.test(aria)) return aria;
    }
    return '';
  }

  function extractHhEmployerTasks() {
    const questions = [];
    const seen = new Set();
    const ids = [];
    document.querySelectorAll('[name^="task_"]').forEach((el) => {
      const m = String(el.getAttribute('name') || '').match(/^task_(\d+)/);
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    });

    const titleEls = Array.from(
      document.querySelectorAll(
        '[data-qa="task-question"], [data-qa*="task-question"], [class*="task-question"]'
      )
    );

    ids.forEach((id, i) => {
      const radios = Array.from(
        document.querySelectorAll(`input[type="radio"][name="task_${id}"]`)
      );
      const checks = Array.from(
        document.querySelectorAll(`input[type="checkbox"][name="task_${id}"]`)
      );
      const textEl =
        document.querySelector(`[name="task_${id}_text"]`) ||
        document.querySelector(`textarea[name="task_${id}"]`);

      let qText = findTaskQuestionText(id, i, titleEls);
      if (!qText || isVacancyMetaFaq(qText) || isCoverLetterPrompt(qText)) return;

      let type = 'text';
      let options = [];
      if (radios.length) {
        type = 'multiple_choice';
        options = collectTaskOptionLabels(radios);
      } else if (checks.length) {
        type = 'checkboxes';
        options = collectTaskOptionLabels(checks);
      } else if (textEl && String(textEl.tagName || '').toLowerCase() === 'textarea') {
        type = 'paragraph';
      }

      pushQuestion(questions, seen, {
        id: `task_${id}`,
        text: qText.slice(0, 4000),
        type,
        options,
      });
    });

    // Fallback: title nodes without matching task_* (rare Magritte layouts)
    if (!questions.length && titleEls.length) {
      titleEls.forEach((el, i) => {
        const qText = cleanTaskQuestionText(textOf(el));
        if (!qText || qText.length < 4 || isVacancyMetaFaq(qText) || isCoverLetterPrompt(qText)) return;
        const block = el.closest('.bloko-form-item, [data-qa*="task"], fieldset, form > div') || el.parentElement;
        const hasInput = block?.querySelector('textarea, input[type="text"], input[type="radio"], input[type="checkbox"]');
        if (!hasInput) return;
        pushQuestion(questions, seen, {
          id: `hh_q_${i + 1}`,
          text: qText.slice(0, 4000),
          type: block.querySelector('textarea') ? 'paragraph' : 'text',
          options: [],
        });
      });
    }

    // Last resort on vacancy_response: textareas in main form with nearby labels
    if (!questions.length && isHhVacancyResponsePage()) {
      const form =
        document.querySelector('[data-qa*="vacancy-response"]') ||
        document.querySelector('main form, form') ||
        document.querySelector('main');
      if (form) {
        form.querySelectorAll('textarea').forEach((ta, i) => {
          const name = String(ta.getAttribute('name') || '');
          if (/letter|сопровод/i.test(name)) return;
          const qa = String(ta.getAttribute('data-qa') || '');
          if (/letter/i.test(qa)) return;
          if (ta.closest('aside, nav, footer, [class*="sidebar"], [class*="chat"]')) return;
          const block = ta.closest('.bloko-form-item, fieldset, [class*="FormItem"], label') || ta.parentElement;
          let qText = cleanTaskQuestionText(
            textOf(
              block?.querySelector('[data-qa="task-question"], [data-qa*="task-question"], legend, label, h2, h3')
            )
          );
          if (!qText) {
            const prev = ta.previousElementSibling;
            qText = cleanTaskQuestionText(textOf(prev));
          }
          if (!qText || qText.length < 8 || isVacancyMetaFaq(qText) || isCoverLetterPrompt(qText)) return;
          pushQuestion(questions, seen, {
            id: name || `hh_ta_${i + 1}`,
            text: qText.slice(0, 4000),
            type: 'paragraph',
            options: [],
          });
        });
      }
    }

    return questions.slice(0, 40);
  }

  /**
   * HH questions: employer tasks on vacancy_response / open form only.
   * Never scrape generic labels or vacancy FAQ widgets.
   */
  function extractHhQuestions() {
    if (
      isHhVacancyResponsePage() ||
      document.querySelector('[name^="task_"], [data-qa="task-question"], [data-qa*="task-question"]')
    ) {
      return extractHhEmployerTasks();
    }

    // Popup response form on vacancy page (modal) - field blocks only
    const questions = [];
    const seen = new Set();
    const blocks = document.querySelectorAll(
      [
        '[data-qa="vacancy-response-popup-form-field"]',
        '.vacancy-response-popup-form-field',
        '[data-qa="vacancy-response-popup-form"] [data-qa="task-question"]',
        '[role="dialog"] [data-qa="task-question"]',
        '[role="dialog"] [name^="task_"]',
      ].join(', ')
    );
    if (!blocks.length) return [];

    // If dialog has task_* - use employer task extractor scoped to dialog
    if (document.querySelector('[role="dialog"] [name^="task_"], [data-qa="vacancy-response-popup-form"] [name^="task_"]')) {
      return extractHhEmployerTasks();
    }

    blocks.forEach((block, idx) => {
      if (block.matches('[name^="task_"]')) return;
      const label = textOf(block.querySelector('[data-qa="label"], [data-qa="task-question"], .label, label, span'));
      const q = cleanTaskQuestionText(label || textOf(block));
      if (!q || q.length < 8 || q.length > 500) return;
      if (isVacancyMetaFaq(q) || isCoverLetterPrompt(q)) return;
      pushQuestion(questions, seen, { id: `popup_${idx + 1}`, text: q, type: 'text', options: [] });
    });
    return questions.slice(0, 20);
  }

  /** Vacancy page FAQ / meta widgets / chat quick-replies - not real application questions. */
  function isVacancyMetaFaq(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return true;
    const metaFaq = [
      /^где располагается место работы\??$/,
      /^где находится место работы\??$/,
      /^какой график работы\??$/,
      /^вакансия открыта\??$/,
      /^какая оплата труда\??$/,
      /^какая схема оплаты\??$/,
      /^как с вами связаться\??$/,
      /^другой вопрос$/,
      /^задать вопрос$/,
      /^спросить у работодателя$/,
      /^есть ли вопросы\??$/,
      /^уровень дохода не указан$/,
      /^где находится/,
      /^какой адрес/,
      /^когда откликаться/,
      /^what is the (salary|location|schedule)/,
      /^is (this|the) (job|position|vacancy) (still )?open/,
      /^where (is|are) (the )?(office|workplace|job)/,
    ];
    if (metaFaq.some((re) => re.test(t))) return true;
    if (
      /^(где|какой|какая|какие|когда|вакансия)\b/.test(t) &&
      /(место работы|график|оплат|открыта|зарплат|локаци|адрес офиса|схема оплаты)/.test(t) &&
      t.length < 80
    ) {
      return true;
    }
    return false;
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
    if (isGoogleFormPage()) {
      return extractGoogleForm();
    }

    const host = detectHost(location.hostname);
    const isResponsePage = isHhVacancyResponsePage();
    const title = extractTitle();
    const company = extractCompany();
    const description = extractMainText();
    // Only real application Q&A: HH employer tasks (vacancy_response / popup) OR clear Q|A tables.
    // Do NOT scrape vacancy FAQ widgets ("Где располагается место работы?" etc.).
    const hhQs = isHhPage() ? extractHhQuestions() : [];
    const tableQs = isResponsePage ? [] : extractTableQuestions().filter((q) => !isVacancyMetaFaq(q.text));
    const questions = [];
    const seen = new Set();
    for (const q of [...hhQs, ...tableQs]) {
      if (isVacancyMetaFaq(q.text)) continue;
      pushQuestion(questions, seen, q);
    }
    const structured = extractStructured(description);
    const knownSite = JOB_SITE_HINTS.some((s) => siteHost() === s || siteHost().endsWith('.' + s));
    let pageKind = 'page';
    if (isResponsePage) pageKind = 'hh_vacancy_response';
    else if (questions.length && tableQs.length && !isHhPage()) pageKind = 'table_qa';
    else if (knownSite || isHhPage()) pageKind = 'job_board';

    const source = isResponsePage
      ? 'hh_vacancy_response'
      : isHhPage()
        ? 'hh'
        : pageKind === 'table_qa'
          ? 'table_qa'
          : knownSite
            ? 'job_board'
            : 'page';

    return {
      url: location.href,
      title: title || document.title || 'Vacancy',
      company,
      description:
        description ||
        (questions.length
          ? `Вопросы работодателя (${questions.length}):\n` +
            questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')
          : ''),
      questions,
      structured,
      host,
      source,
      siteHost: siteHost(),
      pageKind,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'JR_EXTRACT_VACANCY') return false;
    try {
      const vacancy = extractVacancy();
      const hasQs = Array.isArray(vacancy.questions) && vacancy.questions.length > 0;
      const isForm = vacancy.source === 'google_form' || vacancy.pageKind === 'google_form';
      if ((!vacancy.description || vacancy.description.length < 40) && !(isForm && hasQs)) {
        sendResponse({
          ok: false,
          error: 'Не удалось извлечь достаточно текста со страницы. Вставьте описание вручную.',
        });
        return true;
      }
      if (isForm && hasQs && (!vacancy.description || vacancy.description.length < 20)) {
        vacancy.description = vacancy.questions
          .map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : q.text}`)
          .join('\n')
          .slice(0, 20000);
      }
      sendResponse({ ok: true, vacancy });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
    return true;
  });
})();
