/**
 * HH autofill + cover letter insert (human gate).
 * Never clicks submit / «Откликнуться». Graceful no-op if DOM missing.
 * Loaded after platforms/* and page-extract.js.
 */
(function (global) {
  if (global.__JR_AUTOFILL_READY__) return;
  global.__JR_AUTOFILL_READY__ = true;

  const DEFAULT_LETTER_SELECTORS = [
    '[data-qa="vacancy-response-popup-form-letter-input"]',
    'textarea[data-qa*="letter"]',
    'textarea[name*="letter"]',
    'textarea[name*="Letter"]',
  ];

  const DEFAULT_FIELD_SELECTORS = [
    '[data-qa="vacancy-response-popup-form-field"]',
    '.vacancy-response-popup-form-field',
    '[role="dialog"] .bloko-form-item',
    'form .bloko-form-item',
  ];

  function platformSelectors() {
    const reg = global.__JR_PLATFORMS__;
    const adapter = reg && typeof reg.detect === 'function' ? reg.detect(location.hostname) : null;
    const sel = (adapter && adapter.selectors) || {};
    return {
      letter: sel.letter || DEFAULT_LETTER_SELECTORS[0],
      formField: sel.formField || sel.form_field || DEFAULT_FIELD_SELECTORS[0],
    };
  }

  function normalizeLabel(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[«»""„]/g, '"')
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenSet(s) {
    const n = normalizeLabel(s);
    const parts = n.split(/[^a-zа-яё0-9+#.]+/i).filter((t) => t.length > 1);
    return new Set(parts);
  }

  /** Dice coefficient on token sets (0..1). Pure helper for unit tests. */
  function fuzzyMatchScore(a, b) {
    const A = tokenSet(a);
    const B = tokenSet(b);
    if (!A.size || !B.size) {
      const na = normalizeLabel(a);
      const nb = normalizeLabel(b);
      if (!na || !nb) return 0;
      if (na === nb) return 1;
      if (na.includes(nb) || nb.includes(na)) return 0.72;
      return 0;
    }
    let inter = 0;
    A.forEach((t) => {
      if (B.has(t)) inter += 1;
    });
    return (2 * inter) / (A.size + B.size);
  }

  function textOf(el) {
    return String(el?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLetterControl(el) {
    if (!el) return false;
    const name = String(el.getAttribute('name') || '');
    const qa = String(el.getAttribute('data-qa') || '');
    const ph = String(el.getAttribute('placeholder') || '');
    return /letter|сопровод|cover/i.test(`${name} ${qa} ${ph}`);
  }

  function dispatchInputEvents(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_err) {
      /* ignore */
    }
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    const text = String(value ?? '');
    try {
      if (tag === 'textarea' || tag === 'input') {
        const proto =
          tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') desc.set.call(el, text);
        else el.value = text;
      } else if (el.isContentEditable) {
        el.textContent = text;
      } else {
        return false;
      }
      dispatchInputEvents(el);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function findLetterInput(root) {
    const scope = root || document;
    const sel = platformSelectors();
    const ordered = [sel.letter, ...DEFAULT_LETTER_SELECTORS];
    for (const css of ordered) {
      if (!css) continue;
      const el = scope.querySelector(css);
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return el;
    }
    const areas = scope.querySelectorAll('textarea, [contenteditable="true"]');
    for (const el of areas) {
      if (isLetterControl(el)) return el;
    }
    return null;
  }

  function fieldLabel(block) {
    const labelEl = block.querySelector(
      '[data-qa="label"], [data-qa="task-question"], [data-qa*="task-question"], legend, label, .bloko-form-label, h2, h3, span'
    );
    let t = textOf(labelEl);
    if (!t || t.length < 3) t = textOf(block);
    return t.slice(0, 4000);
  }

  function fieldControl(block) {
    const preferred = block.querySelector(
      'textarea:not([name*="letter"]):not([data-qa*="letter"]), input[type="text"], input:not([type]), input[type="search"], input[type="tel"], input[type="email"], input[type="number"]'
    );
    if (preferred && !isLetterControl(preferred)) return preferred;
    const any = block.querySelector('textarea, input[type="text"], input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])');
    if (any && !isLetterControl(any)) return any;
    return null;
  }

  function collectFormFields(root) {
    const scope = root || document;
    const sel = platformSelectors();
    const blocks = [];
    const cssList = [sel.formField, ...DEFAULT_FIELD_SELECTORS];
    const seen = new Set();
    for (const css of cssList) {
      if (!css) continue;
      scope.querySelectorAll(css).forEach((block) => {
        if (seen.has(block)) return;
        seen.add(block);
        const control = fieldControl(block);
        if (!control) return;
        const label = fieldLabel(block);
        if (!label || label.length < 3) return;
        blocks.push({ block, control, label });
      });
    }
    // Employer tasks on vacancy_response page
    scope.querySelectorAll('[name^="task_"]').forEach((el) => {
      if (seen.has(el) || isLetterControl(el)) return;
      if (!/^(textarea|input)$/i.test(el.tagName)) return;
      if (/radio|checkbox|hidden|submit|button/i.test(el.type || '')) return;
      const block =
        el.closest('.bloko-form-item, [data-qa*="task"], fieldset, form > div') || el.parentElement;
      if (block && seen.has(block)) return;
      if (block) seen.add(block);
      seen.add(el);
      const label =
        fieldLabel(block || el) ||
        textOf(scope.querySelector(`[data-qa="task-question"]`)) ||
        String(el.getAttribute('placeholder') || el.name || '');
      if (!label || label.length < 3) return;
      blocks.push({ block: block || el, control: el, label });
    });
    return blocks;
  }

  function bestFieldForQuestion(question, fields, used) {
    let best = null;
    let bestScore = 0;
    fields.forEach((f, idx) => {
      if (used.has(idx)) return;
      const score = fuzzyMatchScore(question, f.label);
      if (score > bestScore) {
        bestScore = score;
        best = { field: f, idx, score };
      }
    });
    if (!best || bestScore < 0.34) return null;
    return best;
  }

  /**
   * Fill mapped answers into HH response form fields.
   * @returns {{ ok: boolean, filled: number, skipped: number, missing: string[], totalFields: number }}
   */
  function fillAnswers(answers, root) {
    const list = Array.isArray(answers) ? answers : [];
    const fields = collectFormFields(root);
    if (!fields.length) {
      return { ok: false, filled: 0, skipped: list.length, missing: ['form_fields_not_found'], totalFields: 0 };
    }
    const used = new Set();
    let filled = 0;
    let skipped = 0;
    const missing = [];
    list.forEach((row) => {
      const q = String(row?.question || row?.text || '').trim();
      const a = String(row?.answer || '').trim();
      if (!a) {
        skipped += 1;
        return;
      }
      const match = bestFieldForQuestion(q || a, fields, used);
      if (!match) {
        skipped += 1;
        missing.push(q.slice(0, 120) || '(empty question)');
        return;
      }
      used.add(match.idx);
      if (setNativeValue(match.field.control, a)) filled += 1;
      else {
        skipped += 1;
        missing.push(q.slice(0, 120));
      }
    });
    return {
      ok: filled > 0,
      filled,
      skipped,
      missing: missing.slice(0, 12),
      totalFields: fields.length,
    };
  }

  /**
   * Insert cover letter into HH response textarea/editor.
   * @returns {{ ok: boolean, found: boolean, reason?: string }}
   */
  function insertLetter(text, root) {
    const letter = String(text || '').trim();
    if (!letter) return { ok: false, found: false, reason: 'empty_letter' };
    const el = findLetterInput(root);
    if (!el) return { ok: false, found: false, reason: 'letter_input_not_found' };
    const ok = setNativeValue(el, letter);
    return { ok, found: true, reason: ok ? undefined : 'set_value_failed' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'JR_INSERT_LETTER') {
      try {
        const res = insertLetter(message.text || message.letterText || '');
        sendResponse({
          ok: !!res.ok,
          found: !!res.found,
          reason: res.reason || null,
          humanGate: true,
          autoSubmit: false,
          message: res.ok
            ? 'Письмо вставлено. Проверьте форму и нажмите «Откликнуться» сами.'
            : res.reason === 'letter_input_not_found'
              ? 'Поле письма на странице не найдено (откройте форму отклика HH).'
              : 'Не удалось вставить письмо.',
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err), humanGate: true, autoSubmit: false });
      }
      return true;
    }

    if (message?.type === 'JR_FILL_FORM_FIELDS') {
      try {
        const res = fillAnswers(message.answers || []);
        sendResponse({
          ok: !!res.ok,
          filled: res.filled,
          skipped: res.skipped,
          missing: res.missing,
          totalFields: res.totalFields,
          humanGate: true,
          autoSubmit: false,
          message: res.ok
            ? `Заполнено полей: ${res.filled}. Проверьте и отправьте форму вручную.`
            : res.totalFields === 0
              ? 'Поля формы отклика не найдены (откройте popup/страницу отклика HH).'
              : 'Не удалось сопоставить ответы с полями.',
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err), humanGate: true, autoSubmit: false });
      }
      return true;
    }

    return false;
  });

  global.__JR_AUTOFILL__ = {
    normalizeLabel,
    fuzzyMatchScore,
    fillAnswers,
    insertLetter,
    findLetterInput,
    collectFormFields,
  };
})(typeof window !== 'undefined' ? window : globalThis);
