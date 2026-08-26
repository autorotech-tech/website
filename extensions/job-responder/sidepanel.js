let currentVacancy = null;
let currentSources = [];
let lastAddedSourceIds = new Set();
let lastAddedAt = null;
let lastIngestSummary = '';
let geminiRagReady = false;
let lastTabUrl = '';
let lastTabId = null;
/** Side panel is per Chrome window - ignore tab events from other windows. */
let panelWindowId = null;
/** URL/tab that produced the current generate result - clear when inactive/closed. */
let resultBoundUrl = '';
let resultBoundTabId = null;
let vacancyExtractTimer = null;
let vacancyExtractSeq = 0;

const BTN_EVALUATE_LABEL = 'Оценить предложение';
const BTN_SCORE_LIST_LABEL = 'Оценить список';
const JR_RELEVANCE_CACHE_KEY = 'jrRelevanceCache';
const JR_RELEVANCE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESULT_PLACEHOLDER = 'Здесь появится отклик';
const scoreListBtn = document.getElementById('scoreListBtn');
const listScoreMeta = document.getElementById('listScoreMeta');

async function resolvePanelWindowId() {
  if (panelWindowId != null) return panelWindowId;
  try {
    const win = await chrome.windows.getCurrent();
    if (win?.id != null) panelWindowId = Number(win.id);
  } catch (_err) {
    /* ignore */
  }
  return panelWindowId;
}

function isMessageForThisPanel(message) {
  if (message?.windowId == null || panelWindowId == null) return true;
  return Number(message.windowId) === Number(panelWindowId);
}

function setListScoreMeta(text, { show = true } = {}) {
  if (!listScoreMeta) return;
  listScoreMeta.hidden = !show || !text;
  listScoreMeta.textContent = text || '';
}

function vacancyIdFromUrl(url) {
  const m = String(url || '').match(/\/vacancy\/(\d+)/);
  return m ? m[1] : '';
}

function pruneRelevanceCache(map) {
  const now = Date.now();
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [key, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object') continue;
    const scoredAt = Number(entry.scoredAt) || 0;
    if (scoredAt && now - scoredAt > JR_RELEVANCE_CACHE_TTL_MS) continue;
    if (entry.score == null) continue;
    out[String(key)] = entry;
  }
  return out;
}

async function readRelevanceCache() {
  const saved = await chrome.storage.local.get([JR_RELEVANCE_CACHE_KEY]);
  return pruneRelevanceCache(saved[JR_RELEVANCE_CACHE_KEY]);
}

async function writeRelevanceCache(map) {
  await chrome.storage.local.set({ [JR_RELEVANCE_CACHE_KEY]: pruneRelevanceCache(map) });
}

/**
 * Merge score rows into jrRelevanceCache (keyed by vacancy id / canonical url).
 * @param {Array<object>} rows
 * @param {'list'|'detail'} source
 */
async function upsertRelevanceCache(rows, source = 'list') {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  const cache = await readRelevanceCache();
  const now = Date.now();
  for (const row of list) {
    if (!row || row.score == null) continue;
    const id =
      String(row.id || '').trim() ||
      vacancyIdFromUrl(row.url) ||
      (row.url ? String(row.url).split('?')[0] : '');
    if (!id) continue;
    const rationale = Array.isArray(row.rationale)
      ? row.rationale
      : source === 'list'
        ? ['Оценка из списка вакансий (без LLM)']
        : [];
    cache[id] = {
      score: Math.round(Number(row.score) || 0),
      matched: Array.isArray(row.matched) ? row.matched.slice(0, 12) : [],
      missing: Array.isArray(row.missing) ? row.missing.slice(0, 12) : [],
      rationale,
      title: String(row.title || '').slice(0, 500),
      url: String(row.url || ''),
      scoredAt: now,
      source: source === 'detail' ? 'detail' : 'list',
    };
  }
  await writeRelevanceCache(cache);
}

async function lookupRelevanceCacheForVacancy(vacancy) {
  const url = String(vacancy?.url || '');
  const id = String(vacancy?.id || '').trim() || vacancyIdFromUrl(url);
  if (!id && !url) return null;
  const cache = await readRelevanceCache();
  const byId = id ? cache[id] : null;
  if (byId) return { key: id, entry: byId };
  const canon = url ? url.split('?')[0] : '';
  if (canon && cache[canon]) return { key: canon, entry: cache[canon] };
  // Fallback: match by url field stored on cache entries
  if (id) {
    for (const [key, entry] of Object.entries(cache)) {
      if (!entry) continue;
      const entryId = vacancyIdFromUrl(entry.url) || String(key);
      if (entryId === id) return { key, entry };
    }
  }
  return null;
}

/** Show cached list/detail score in panel - zero API / zero tokens. */
async function tryRestoreRelevanceFromCache(vacancy) {
  const hit = await lookupRelevanceCacheForVacancy(vacancy);
  if (!hit?.entry || hit.entry.score == null) return false;
  const fromList = hit.entry.source !== 'detail';
  renderRelevance({
    score: hit.entry.score,
    matched: hit.entry.matched || [],
    missing: hit.entry.missing || [],
    rationale: hit.entry.rationale || [],
    fromCache: true,
    cacheSource: fromList ? 'list' : 'detail',
  });
  const label = fromList ? 'Релевантность из списка' : 'Релевантность (кэш)';
  setVacancyPageStatus('ok', label);
  setSuccess(`${label} · ${hit.entry.score} / 100 · без API`);
  return true;
}

/** Hydrate score from active tab URL (before/without full DOM extract). */
async function hydrateRelevanceFromActiveTabUrl() {
  try {
    const windowId = await resolvePanelWindowId();
    const query =
      windowId != null
        ? { active: true, windowId: Number(windowId) }
        : { active: true, lastFocusedWindow: true };
    const tabs = await chrome.tabs.query(query);
    const tab = tabs && tabs[0];
    const url = String(tab?.url || '');
    const id = vacancyIdFromUrl(url);
    if (!id) return false;
    return tryRestoreRelevanceFromCache({ id, url });
  } catch (_err) {
    return false;
  }
}

async function scoreVacancyList() {
  setError('');
  setSuccess('');
  setListScoreMeta('Читаю карточки на странице…');
  setButtonBusy(scoreListBtn, true, BTN_SCORE_LIST_LABEL, 'Список…');
  try {
    await JR_API.ensureWorkspace();
    const windowId = await resolvePanelWindowId();
    const listResp = await JR_API.fetchVacancyListFromTab({ windowId });
    const vacancies = Array.isArray(listResp.vacancies) ? listResp.vacancies : [];
    const tabId = listResp.tabId;
    if (!vacancies.length) {
      setListScoreMeta(
        listResp.pageKind === 'not_search_list'
          ? 'Откройте страницу поиска hh.ru (/search/vacancy), затем нажмите снова.'
          : 'На странице не найдено карточек вакансий.'
      );
      setError('Список вакансий пуст - откройте поиск hh.ru');
      return;
    }
    setListScoreMeta(`Оцениваю ${vacancies.length} вакансий…`);
    const selectedSourceIds = getSelectedSourceIds();
    const batch = await JR_API.scoreRelevanceBatch({ vacancies, selectedSourceIds });
    const scores = Array.isArray(batch.scores) ? batch.scores : [];
    await upsertRelevanceCache(scores, 'list');
    setListScoreMeta(`Вставляю бейджи (${scores.length})…`);
    const inj = await JR_API.injectListBadges({ scores, tabId, windowId });
    const avg =
      scores.length > 0
        ? Math.round(scores.reduce((s, r) => s + (Number(r.score) || 0), 0) / scores.length)
        : 0;
    const top = [...scores].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const summary = `Список: ${scores.length} оценено, бейджей: ${inj.injected || scores.length}, среднее ${avg}%${
      top ? `, топ ${top.score}% - ${(top.title || '').slice(0, 40)}` : ''
    }. Кэш сохранён. Без LLM.`;
    setListScoreMeta(summary);
    setSuccess(summary);
    if (relevanceBox && scores[0]) {
      renderRelevance({
        score: scores[0].score,
        matched: scores[0].matched || [],
        missing: scores[0].missing || [],
        rationale: [`Пакетная оценка списка (${scores.length} вакансий) - открывайте карточку, score из кэша`],
        fromCache: true,
        cacheSource: 'list',
      });
    }
  } catch (err) {
    setError(String(err.message || err));
    setListScoreMeta('');
  } finally {
    setButtonBusy(scoreListBtn, false, BTN_SCORE_LIST_LABEL);
  }
}

if (scoreListBtn) {
  scoreListBtn.addEventListener('click', () => {
    scoreVacancyList().catch((err) => setError(String(err.message || err)));
  });
}

/** Ultra-short system rules - default jrPromptExtra + reset target. See docs/job-responder/prompts-ultra-short.md
 * Keep in sync with agent-api ULTRA_SHORT_SYSTEM_PROMPT (GET /api/v1/job-responder/default-prompt).
 */
const DEFAULT_PROMPT_EXTRA = `[ROLE] Ассистент откликов. Пишешь только по фактам кандидата. Без воды.

[INPUT] vacancy | profile | cover_template? | custom_instructions? | contacts?

[RULES]
1. Не выдумывай опыт, метрики, контакты, URL, ownership продуктов. Нет факта в profile -> пропусти пункт.
2. Адаптируй cover_template под вакансию; стиль кандидата сохрани.
3. В письме: 3-4 коротких факта под вакансию (слова/метрики как в profile/RAG).
4. Блок ## Контакты: ТОЛЬКО email/Telegram/телефон. Блок ## Ссылки: ВСЕ релевантные URL с подписями из template/contacts/profile/правок (резюме, youtube, LinkedIn, демо…). Без опыта, навыков, smoke/test URL. Не выдумывай URL. YouTube @handle ≠ Telegram.
5. Честность: только tools/уровни/метрики из profile. Запрет без источника: "senior"/"сеньор", "эксперт", "свободно", CEFR (C1/C2), "на уровне senior". Proficient ≠ C1. Зеркаль формулировки RAG, не усиливай.
6. HH: ASCII ", дефис - (не —), -> (не →); без «ёлочек».
7. no-ai-slop: без воды и клише (delve/leverage/utilize/cutting-edge; "выразить заинтересованность"; "в современном мире"). Факты и конкретика. Русский, если не просили иначе.

[OUT cover_letter]
# ОТКЛИК НА ВАКАНСИЮ
**Должность:** {title}
**Компания:** {company}
**Формат:** {format|remote|employment}

---

## СОПРОВОДИТЕЛЬНОЕ ПИСЬМО
{greeting}

{1 short pitch sentence}

**Почему я подхожу под вакансию:**
1. **{тема}** - {1-2 предложения с фактом}
2. ...
3. ...
(макс 4 пункта)

{1 sentence CTA}

**Следующий шаг:** {коротко}

## Контакты
- Telegram: ...
- Email: ...
(только известные; без пустых строк и без лишнего текста)

## Ссылки
резюме: https://...
youtube: https://...
(все известные релевантные URL с подписями; не выдумывай)

[OUT qa] [{"question":"...","answer":"..."}]`;

/** Canonical ## Ссылки (must stay in sync with agent-api DEFAULT_CANONICAL_LINKS). */
const DEFAULT_CANONICAL_LINKS = [
  { label: 'резюме', url: 'https://autoro.tech/resume/' },
  { label: 'youtube', url: 'https://www.youtube.com/@iq_boosted' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com/in/vlad-autoro-tech/' },
  {
    label: 'профиль на форуме по интернет маркетингу',
    url: 'https://www.blackhatworld.com/members/vlad_x.1811065/',
  },
  { label: 'видео-демо процессов e-commerce', url: 'https://youtu.be/v2_zmJrlMks' },
  { label: 'видео-демо о тестирование гипотезы', url: 'https://youtu.be/AJtcYfItspM' },
];

const DEFAULT_LINKS_BLOCK =
  '## Ссылки\n' + DEFAULT_CANONICAL_LINKS.map((l) => `${l.label}: ${l.url}`).join('\n');

/** Structured cover template - default for empty / migration. */
const DEFAULT_COVER_TEMPLATE = `[COVER_TEMPLATE]
Приветствие: Здравствуйте!
О себе (1-2 предложения): Кратко кто вы и чем полезны под эту роль.
Ключевые факты (bullet):
- факт 1 под требования вакансии
- факт 2 (метрика / стек / результат)
CTA: Готов обсудить детали в удобном формате.

[CONTACTS]
Telegram: @autoro_tech
Email: autoro.tech@gmail.com

${DEFAULT_LINKS_BLOCK}
`;

/** Legacy default contact line - migrate storage to ultra-short on load. */
const LEGACY_PROMPT_EXTRA =
  'Всегда включай контакты и релевантные ссылки из профиля (email, Telegram, телефон, портфолио, GitHub, LinkedIn). ' +
  'Не выдумывай. Для переопределения добавьте строки вида ключ: значение (см. placeholder).';

function normPromptBlob(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isJrSystemPromptText(text) {
  const t = String(text || '');
  return /\[ROLE\]/.test(t) && /\[RULES\]/.test(t) && (/\[OUT/.test(t) || /\[FLOW\]/.test(t));
}

/** Old v0.8.x ultra-short with [FLOW] - migrate to [OUT cover_letter] default. */
function isOldUltraShortPrompt(text) {
  const t = String(text || '');
  return isJrSystemPromptText(t) && /\[FLOW\]/.test(t) && !/\[OUT cover_letter\]/.test(t);
}

/** Old ultra-short without no-ai-slop rule 7 - migrate to current default. */
function isMissingNoAiSlopPrompt(text) {
  const t = String(text || '');
  return isJrSystemPromptText(t) && !/no-ai-slop/i.test(t);
}

/** System prompt in storage drifted from live DEFAULT_PROMPT_EXTRA / API. */
function isDriftedSystemPrompt(text, liveDefault = DEFAULT_PROMPT_EXTRA) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (!isJrSystemPromptText(t)) return false;
  return normPromptBlob(t) !== normPromptBlob(liveDefault);
}

function shouldMigratePromptExtra(savedExtra, liveDefault = DEFAULT_PROMPT_EXTRA) {
  const saved = String(savedExtra || '');
  if (!saved.trim()) return true;
  if (saved.trim() === LEGACY_PROMPT_EXTRA.trim()) return true;
  if (/^Всегда включай контакты и релевантные ссылки из профиля/.test(saved.trim())) return true;
  if (isOldUltraShortPrompt(saved)) return true;
  if (isMissingNoAiSlopPrompt(saved)) return true;
  if (isDriftedSystemPrompt(saved, liveDefault)) return true;
  return false;
}

function isStructuredCoverTemplate(text) {
  const t = String(text || '');
  return /\[COVER_TEMPLATE\]/i.test(t) || /\[CONTACTS\]/i.test(t);
}

function coverTemplateMissingCanonicalLinks(text) {
  const blob = String(text || '');
  return DEFAULT_CANONICAL_LINKS.some((item) => !blob.includes(item.url));
}

/** Ensure ## Ссылки has all 6 canonical URLs (dedupe by URL; never drop AJtcYfItspM). */
function ensureCanonicalLinksInTemplate(text) {
  let raw = String(text || '').trim();
  if (!raw) {
    return DEFAULT_COVER_TEMPLATE.trim();
  }
  const missing = DEFAULT_CANONICAL_LINKS.filter((item) => !raw.includes(item.url));
  if (!missing.length) return raw;
  if (/##\s*Ссылки/i.test(raw)) {
    const lines = missing.map((item) => `${item.label}: ${item.url}`).join('\n');
    return `${raw.trimEnd()}\n${lines}`.trim();
  }
  return `${raw.trimEnd()}\n\n${DEFAULT_LINKS_BLOCK}`.trim();
}

function formatContactsBlock(contacts) {
  const order = [
    ['telegram', 'Telegram'],
    ['email', 'Email'],
    ['phone', 'Телефон'],
    ['portfolio', 'Portfolio'],
    ['link', 'Portfolio'],
    ['linkedin', 'LinkedIn'],
    ['github', 'GitHub'],
    ['website', 'Сайт'],
  ];
  const lines = [];
  const used = new Set();
  for (const [key, label] of order) {
    if (!contacts?.[key] || used.has(key)) continue;
    used.add(key);
    lines.push(`${label}: ${contacts[key]}`);
  }
  for (const [k, v] of Object.entries(contacts || {})) {
    if (used.has(k) || !v) continue;
    lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}

function extractLinksSection(text) {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s*Ссылки\s*$/i.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return '';
  return lines.slice(start).join('\n').trim();
}

function stripLinksSection(text) {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s*Ссылки\s*$/i.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return String(text || '').trim();
  return lines.slice(0, start).join('\n').trim();
}

function buildStructuredCoverTemplate({ body = '', contacts = {} } = {}) {
  let about = String(body || '').trim();
  // Strip existing structured wrappers if re-migrating (keep ## Ссылки separately)
  const linksFromBody = extractLinksSection(about);
  about = about
    .replace(/\[COVER_TEMPLATE\]/gi, '')
    .replace(/\[CONTACTS\][\s\S]*$/i, '')
    .trim();
  about = stripLinksSection(about);
  if (!about) {
    about =
      'Приветствие: Здравствуйте!\nО себе (1-2 предложения): Кратко кто вы и чем полезны под эту роль.\nКлючевые факты (bullet):\n- факт 1\n- факт 2\nCTA: Готов обсудить детали.';
  }
  const contactLines = formatContactsBlock(contacts);
  const contactsBlock = contactLines
    ? contactLines
    : 'Telegram: @autoro_tech\nEmail: autoro.tech@gmail.com';
  const withLinks = ensureCanonicalLinksInTemplate(
    `[COVER_TEMPLATE]\n${about}\n\n[CONTACTS]\n${contactsBlock}\n\n${linksFromBody || DEFAULT_LINKS_BLOCK}`.trim()
  );
  return withLinks;
}

function mergeContactsIntoStructuredTemplate(template, contacts) {
  const raw = String(template || '').trim();
  if (!raw || !contacts || !Object.keys(contacts).length) {
    return ensureCanonicalLinksInTemplate(raw);
  }
  // Preserve ## Ссылки that sit after [CONTACTS]
  const linksTail = extractLinksSection(raw) || DEFAULT_LINKS_BLOCK;
  if (!/\[CONTACTS\]/i.test(raw)) {
    return ensureCanonicalLinksInTemplate(
      `${raw}\n\n[CONTACTS]\n${formatContactsBlock(contacts)}\n\n${linksTail}`.trim()
    );
  }
  const existing = parseProfileOverrides(raw);
  const merged = { ...contacts, ...existing }; // template wins
  const head = stripLinksSection(raw.replace(/\[CONTACTS\][\s\S]*$/i, '').trim());
  return ensureCanonicalLinksInTemplate(
    `${head}\n\n[CONTACTS]\n${formatContactsBlock(merged)}\n\n${linksTail}`.trim()
  );
}

/** Last saved prompt text (chrome.storage jrPromptExtra). */
let savedPromptExtra = DEFAULT_PROMPT_EXTRA;

function syncPromptSaveButton() {
  const saveBtn = document.getElementById('savePromptBtn');
  const meta = document.getElementById('promptExtraMeta');
  if (!promptExtraEl || !saveBtn) return;
  const current = String(promptExtraEl.value || '');
  const dirty = current !== String(savedPromptExtra || '');
  saveBtn.disabled = !dirty;
  if (meta) {
    const isLiveDefault = normPromptBlob(current) === normPromptBlob(DEFAULT_PROMPT_EXTRA);
    if (dirty) {
      meta.textContent = 'Есть несохранённые изменения промпта.';
    } else if (isLiveDefault) {
      meta.textContent =
        'Показан runtime-промпт (ultra-short). Generate использует тот же текст на бэкенде.';
    } else {
      meta.textContent = 'Промпт сохранён - уходит в generate как promptExtra / CUSTOM.';
    }
  }
}

/** Apply live default (local or API) into textarea + storage when empty/legacy/drifted. */
async function applyRuntimePromptToUi(liveDefault) {
  const prompt = String(liveDefault || DEFAULT_PROMPT_EXTRA);
  if (promptExtraEl) promptExtraEl.value = prompt;
  savedPromptExtra = prompt;
  await chrome.storage.local.set({ jrPromptExtra: prompt });
  syncPromptSaveButton();
}
/** Keys expanded after generate / with answers (not forced closed by restore). */
const JR_SKIP_COLLAPSE_RESTORE = new Set(['result', 'qaResults']);

/** Default-open sections when no saved collapse state for the key. */
const JR_DEFAULT_OPEN = new Set(['generate']);
/**
 * Parse free-text overrides: "Telegram: @x | email: a@b" and free-form RU
 * ("Поменяй контакты… Telegram: @autoro_tech").
 * @returns {Record<string, string>}
 */
function parseProfileOverrides(text) {
  const out = {};
  const raw = String(text || '').trim();
  if (!raw) return out;

  const canonKey = (key) => {
    const k = String(key || '')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (/telegram|телеграм|\bтг\b|\btg\b/.test(k)) return 'telegram';
    if (/email|e-mail|\bmail\b|почт/.test(k)) return 'email';
    if (/phone|tel|телефон|мобильн/.test(k)) return 'phone';
    if (/github/.test(k)) return 'github';
    if (/linkedin/.test(k)) return 'linkedin';
    if (/portfolio|портфолио|website|сайт|\blink\b|\burl\b|^ссылка$/.test(k)) return 'link';
    return k.slice(0, 40);
  };
  const cleanVal = (v) =>
    String(v || '')
      .trim()
      .replace(/\s*(?:->|→)\s*$/u, '')
      .replace(/^[,;|\s]+|[,;|\s]+$/g, '')
      .slice(0, 500);
  const extractUrl = (v) => {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) return s.split(/\s+/)[0].replace(/[).,;"']+$/, '');
    const m = s.match(/https?:\/\/[^\s|>,"'\]]+/i);
    return m ? m[0].replace(/[).,;"']+$/, '') : '';
  };

  const chunks = raw.split(/[|\n]+/);
  for (const chunk of chunks) {
    const m = String(chunk).match(/^\s*[-*•]?\s*([^:]{1,120})\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const rawKey = String(m[1] || '').trim();
    const key = canonKey(rawKey);
    let val = cleanVal(m[2]);
    if (!key || !val) continue;
    if (/всегда включай|не выдумывай|переопределения пишите/i.test(key + ' ' + val) && val.length > 80) {
      continue;
    }
    if (key === 'telegram') {
      const hm = val.match(/(?:t\.me\/|@)([A-Za-z0-9_]{4,64})/i) || val.match(/^@?([A-Za-z0-9_]{4,64})$/);
      if (hm) out.telegram = `@${String(hm[1]).replace(/^@/, '')}`;
      continue;
    }
    if (key === 'email') {
      const em = val.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
      if (em) out.email = em[0];
      continue;
    }
    const url = extractUrl(val);
    if (url && !/example\.com|jr-smoke|localhost/i.test(url)) {
      // Keep Russian labels (резюме, youtube, демо…) for ## Ссылки
      const label =
        key === 'link' || key === 'github' || key === 'linkedin' || key === 'portfolio'
          ? key
          : rawKey.slice(0, 40);
      out[label] = url;
      continue;
    }
    if (key.length <= 40 && val.length <= 500) out[key] = val;
  }

  if (!out.telegram) {
    const tg =
      raw.match(/(?:telegram|телеграм|тг)\s*(?:в\s+базе)?\s*[:\-–—]?\s*(?:->|→)?\s*(?:https?:\/\/t\.me\/|@)?([A-Za-z0-9_]{4,64})/i) ||
      raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,64})/i) ||
      raw.match(/(?:^|[\s|])@([A-Za-z0-9_]{4,64})\b/);
    if (tg) out.telegram = `@${tg[1]}`;
  }
  if (!out.email) {
    const em = raw.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    if (em) out.email = em[0];
  }
  return out;
}

function formatParsedContactsPreview(contacts) {
  if (!contacts || typeof contacts !== 'object') return '';
  const bits = [];
  for (const k of ['telegram', 'email', 'phone', 'link', 'github', 'linkedin', 'portfolio']) {
    if (contacts[k]) bits.push(`${k}: ${contacts[k]}`);
  }
  for (const [k, v] of Object.entries(contacts)) {
    if (['telegram', 'email', 'phone', 'link', 'github', 'linkedin', 'portfolio'].includes(k)) continue;
    if (v) bits.push(`${k}: ${v}`);
  }
  return bits.join(' · ');
}

async function restoreCollapseState() {
  try {
    const saved = await chrome.storage.local.get(['jrCollapseState']);
    const state = saved.jrCollapseState && typeof saved.jrCollapseState === 'object' ? saved.jrCollapseState : {};
    document.querySelectorAll('[data-jr-collapse]').forEach((el) => {
      const key = el.getAttribute('data-jr-collapse');
      if (!key || JR_SKIP_COLLAPSE_RESTORE.has(key)) return;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        el.open = Boolean(state[key]);
      } else if (JR_DEFAULT_OPEN.has(key)) {
        el.open = true;
      }
    });
  } catch (_) {
    /* ignore */
  }
}

function bindCollapsePersistence() {
  document.querySelectorAll('[data-jr-collapse]').forEach((el) => {
    el.addEventListener('toggle', () => {
      const key = el.getAttribute('data-jr-collapse');
      if (!key || JR_SKIP_COLLAPSE_RESTORE.has(key)) return;
      chrome.storage.local.get(['jrCollapseState'], (saved) => {
        const prev = saved.jrCollapseState && typeof saved.jrCollapseState === 'object' ? saved.jrCollapseState : {};
        chrome.storage.local.set({
          jrCollapseState: { ...prev, [key]: Boolean(el.open) },
        });
      });
    });
  });
}

const authHint = document.getElementById('authHint');
const resumeStatus = document.getElementById('resumeStatus');
const geminiRagStatusEl = document.getElementById('geminiRagStatus');
const ingestBanner = document.getElementById('ingestBanner');
const vacancyMeta = document.getElementById('vacancyMeta');
const vacancyDescription = document.getElementById('vacancyDescription');
const vacancyStructuredEl = document.getElementById('vacancyStructured');
const vacancyStatusDot = document.getElementById('vacancyStatusDot');
const relevanceBox = document.getElementById('relevanceBox');
const resultText = document.getElementById('resultText');
const genMeta = document.getElementById('genMeta');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const sourcesListEl = document.getElementById('sourcesList');
const workspaceIdInput = document.getElementById('workspaceIdInput');
const workBarEl = document.getElementById('workBar');
const workBarTextEl = document.getElementById('workBarText');

let processBusyCount = 0;
let processBusyLabel = '';
let lastToast = { kind: '', text: '' };

function scrollRoot() {
  return document.scrollingElement || document.documentElement;
}

function withPreservedScroll(fn) {
  const root = scrollRoot();
  const top = root.scrollTop;
  fn();
  root.scrollTop = top;
}

function renderWorkBar() {
  if (!workBarEl || !workBarTextEl) return;
  workBarEl.classList.remove('isBusy', 'isOk', 'isError');
  if (processBusyCount > 0) {
    workBarEl.classList.add('isBusy');
    workBarEl.setAttribute('aria-busy', 'true');
    workBarTextEl.textContent = processBusyLabel || 'Работаю…';
    return;
  }
  workBarEl.setAttribute('aria-busy', 'false');
  if (lastToast.kind === 'error') {
    workBarEl.classList.add('isError');
    workBarTextEl.textContent = lastToast.text;
    return;
  }
  if (lastToast.kind === 'ok') {
    workBarEl.classList.add('isOk');
    workBarTextEl.textContent = lastToast.text;
    return;
  }
  workBarTextEl.textContent = 'Готово к работе';
}

function setError(msg) {
  withPreservedScroll(() => {
    errorEl.textContent = msg || '';
    if (msg) successEl.textContent = '';
    lastToast = msg ? { kind: 'error', text: msg } : { kind: '', text: '' };
    renderWorkBar();
  });
}

function setSuccess(msg) {
  withPreservedScroll(() => {
    successEl.textContent = msg || '';
    if (msg) errorEl.textContent = '';
    lastToast = msg ? { kind: 'ok', text: msg } : { kind: '', text: '' };
    renderWorkBar();
  });
}

function showIngestBanner({ addedCount = 0, total = currentSources.length, summary = '' } = {}) {
  if (!ingestBanner) return;
  if (summary) lastIngestSummary = summary;
  if (addedCount > 0) lastAddedAt = new Date();
  const when = lastAddedAt ? formatUpdatedAt(lastAddedAt.toISOString()) : '';
  const lines = [];
  if (lastIngestSummary) lines.push(lastIngestSummary);
  lines.push(`В базе: ${total} источник(ов)`);
  if (when) lines.push(`Последнее добавление: ${when}`);
  ingestBanner.hidden = false;
  ingestBanner.textContent = lines.join(' · ');
}

function setButtonBusy(btn, busy, idleLabel, busyLabel) {
  if (!btn) return;
  const wasBusy = btn.dataset.busy === '1';
  btn.disabled = Boolean(busy);
  if (busy) {
    btn.dataset.busy = '1';
    if (idleLabel) btn.dataset.idleLabel = idleLabel;
    else if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
    const label = busyLabel || 'Загрузка…';
    btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span>${label}`;
    processBusyLabel = label;
    if (!wasBusy) processBusyCount += 1;
    renderWorkBar();
  } else {
    btn.dataset.busy = '0';
    btn.textContent = idleLabel || btn.dataset.idleLabel || btn.textContent;
    if (wasBusy) processBusyCount = Math.max(0, processBusyCount - 1);
    renderWorkBar();
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Keep «Отклик / Результат» open and textarea at expanded height after copy. */
function keepResultPanelExpanded({ wasExpanded = true } = {}) {
  const genSection = document.getElementById('generateSection');
  if (genSection) genSection.open = true;
  if (resultText && wasExpanded) {
    resultText.classList.add('isExpanded');
  }
}

/**
 * Clipboard for Chrome side panel / extension context.
 * Order: select #resultText (user gesture) -> clipboard API -> visible temp textarea
 * -> background offscreen document (MV3 CLIPBOARD reason).
 * Does not collapse the result panel: restores focus/selection and isExpanded after select().
 */
async function copyTextToClipboard(text, { sourceEl = null, keepExpanded = false } = {}) {
  const value = String(text || '');
  if (!value) throw new Error('Нечего копировать');

  const wasExpanded =
    keepExpanded ||
    Boolean(sourceEl?.classList?.contains('isExpanded')) ||
    Boolean(resultText?.classList?.contains('isExpanded')) ||
    document.activeElement === resultText;
  const prevActive = document.activeElement;
  const prevSel =
    resultText && typeof resultText.selectionStart === 'number'
      ? { start: resultText.selectionStart, end: resultText.selectionEnd }
      : null;

  const restoreAfterCopy = () => {
    keepResultPanelExpanded({ wasExpanded });
    if (resultText && prevSel && typeof resultText.setSelectionRange === 'function') {
      try {
        resultText.setSelectionRange(prevSel.start, prevSel.end);
      } catch (_err) {
        /* ignore */
      }
    }
    if (
      prevActive &&
      prevActive !== resultText &&
      typeof prevActive.focus === 'function' &&
      document.contains(prevActive)
    ) {
      try {
        prevActive.focus({ preventScroll: true });
      } catch (_err) {
        try {
          prevActive.focus();
        } catch (_err2) {
          /* ignore */
        }
      }
    }
    // Blur from select()/temp focus may have already removed isExpanded — re-apply.
    keepResultPanelExpanded({ wasExpanded });
  };

  const tryExecOnEl = (el) => {
    if (!el) return false;
    try {
      el.focus();
      if (typeof el.select === 'function') el.select();
      if (typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(0, String(el.value || '').length);
      }
      return Boolean(document.execCommand('copy'));
    } catch (_err) {
      return false;
    }
  };

  try {
    // 1) Prefer the visible result textarea under the click gesture.
    if (sourceEl && String(sourceEl.value || '') === value && tryExecOnEl(sourceEl)) {
      return true;
    }
    if (resultText && String(resultText.value || '').trim() === value.trim() && tryExecOnEl(resultText)) {
      return true;
    }

    // 2) Async clipboard API (may fail in side_panel without focus/permission).
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_err) {
      /* fall through */
    }

    // 3) Temporary textarea kept in-viewport (off-screen left:-9999 often blocked).
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText =
      'position:fixed;inset:0;width:calc(100% - 8px);height:48px;margin:4px;opacity:0.01;z-index:2147483647;';
    document.body.appendChild(ta);
    let ok = false;
    try {
      ok = tryExecOnEl(ta);
    } finally {
      document.body.removeChild(ta);
    }
    if (ok) return true;

    // 4) Background -> offscreen document.
    if (typeof JR_API !== 'undefined' && typeof JR_API.copyTextViaBackground === 'function') {
      await JR_API.copyTextViaBackground(value);
      return true;
    }

    throw new Error('Не удалось скопировать в буфер');
  } finally {
    restoreAfterCopy();
  }
}

function flashCopyFeedback(btn, idleLabel, successLabel = 'Скопировано') {
  if (!btn) return;
  const prev = idleLabel || btn.textContent || 'Копировать';
  btn.textContent = successLabel;
  btn.classList.add('isCopied');
  setTimeout(() => {
    btn.textContent = prev;
    btn.classList.remove('isCopied');
  }, 1500);
}

function getResultCopyText() {
  return String(resultText?.value || '').trim();
}

function isResultCopyable(text = getResultCopyText()) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value === RESULT_PLACEHOLDER) return false;
  return true;
}

function syncCopyButtonState() {
  const btn = document.getElementById('copyBtn') || copyBtn;
  if (!btn) return;
  const ok = isResultCopyable();
  btn.disabled = !ok;
  btn.title = ok ? 'Скопировать отклик' : 'Сначала сгенерируйте отклик';
  btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
}

function formatUpdatedAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm} ${hh}:${mi}`;
  } catch {
    return String(iso);
  }
}

function kindLabel(kind) {
  if (kind === 'job_resume') return 'CV';
  if (kind === 'job_skills') return 'навыки';
  if (kind === 'job_experience') return 'опыт';
  return kind || '';
}

function sourceId(item) {
  return Number(item.knowledgeItemId || item.knowledge_item_id || item.id || 0);
}

function sourceTitleRaw(item) {
  const raw = String(
    item.title || item.name || item.filename || item.fileName || item.file_name || ''
  ).trim();
  if (raw) return raw;
  const id = sourceId(item);
  return id > 0 ? `Источник #${id}` : 'Без названия';
}

function sourceUpdatedAt(item) {
  return item.updatedAt || item.updated_at || '';
}

function coverLetterHaystack(item) {
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : String(item.tags || '');
  return [
    item.title,
    item.name,
    item.category,
    item.kind,
    tags,
    item.preview,
    item.description,
    item.contentText,
    item.contentPreview,
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

function isCoverLetterSource(item) {
  const hay = coverLetterHaystack(item);
  if (!hay.trim()) return false;
  if (/\b(cv|resume|резюме|portfolio|портфолио)\b/i.test(hay) && !/сопровод|cover\s*letter|coverletter/.test(hay)) {
    return false;
  }
  return /сопровод|cover\s*letter|coverletter|cover_letter|motivation\s*letter|motivational\s*letter|шаблон\s*отклик/.test(
    hay
  );
}

function coverLetterBody(item) {
  return String(item.contentText || item.contentPreview || item.preview || '')
    .replace(/^---jr_profile---[\s\S]*?\n---\n/, '')
    .trim();
}

function pickCoverLetterSource(items) {
  const matches = (Array.isArray(items) ? items : []).filter(isCoverLetterSource);
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ta = Date.parse(sourceUpdatedAt(a) || '') || 0;
    const tb = Date.parse(sourceUpdatedAt(b) || '') || 0;
    return tb - ta;
  });
  return matches[0];
}

async function maybePrefillCoverTemplate(items, { force = false } = {}) {
  if (!coverTemplateEl) return false;
  const current = String(coverTemplateEl.value || '').trim();
  if (!force && current) return false;
  const picked = pickCoverLetterSource(items);
  if (!picked) return false;
  let body = coverLetterBody(picked);
  if (!body || body.length < 40) return false;
  const contacts = {
    ...parseProfileOverrides(String(ragEditsInput?.value || '')),
    ...parseProfileOverrides(body),
  };
  if (!isStructuredCoverTemplate(body)) {
    body = buildStructuredCoverTemplate({ body, contacts });
  } else if (Object.keys(contacts).length) {
    body = mergeContactsIntoStructuredTemplate(body, contacts);
  }
  coverTemplateEl.value = body;
  await chrome.storage.local.set({ jrCoverTemplate: body });
  setSuccess(`Шаблон взят из базы: ${sourceTitleRaw(picked)}`);
  return true;
}

async function ensureCoverTemplateStructured({ force = false } = {}) {
  if (!coverTemplateEl) return false;
  const current = String(coverTemplateEl.value || '').trim();
  const contacts = {
    ...parseProfileOverrides(String(ragEditsInput?.value || '')),
    ...parseProfileOverrides(current),
  };
  let next = current;
  if (!current) {
    next = buildStructuredCoverTemplate({ contacts });
  } else if (!isStructuredCoverTemplate(current) || force) {
    next = buildStructuredCoverTemplate({
      body: isStructuredCoverTemplate(current)
        ? current.replace(/\[CONTACTS\][\s\S]*$/i, '').replace(/\[COVER_TEMPLATE\]/gi, '').trim()
        : current,
      contacts,
    });
  } else if (Object.keys(contacts).length) {
    next = mergeContactsIntoStructuredTemplate(current, contacts);
  } else {
    next = ensureCanonicalLinksInTemplate(current);
  }
  next = ensureCanonicalLinksInTemplate(next);
  if (next === current) return false;
  coverTemplateEl.value = next;
  await chrome.storage.local.set({ jrCoverTemplate: next });
  return true;
}

function renderSources(items) {
  currentSources = Array.isArray(items) ? items : [];
  if (!sourcesListEl) return;
  if (!currentSources.length) {
    sourcesListEl.innerHTML =
      '<div class="hint">Список пуст. Проверьте workspaceId (test = 1), затем «Обновить».</div>';
    return;
  }
  sourcesListEl.innerHTML = currentSources
    .map((item) => {
      const id = sourceId(item);
      const checked = item.kind === 'job_resume' ? 'checked disabled' : 'checked';
      const isNew = lastAddedSourceIds.has(id) ? ' isNew' : '';
      const cat = item.category || '';
      const metaParts = [kindLabel(item.kind), cat, formatUpdatedAt(sourceUpdatedAt(item))].filter(Boolean);
      const titleRaw = sourceTitleRaw(item);
      const title = escapeHtml(titleRaw);
      const isLink = cat === 'link' || Boolean(item.url);
      const descRaw = String(item.description || (isLink ? item.preview : '') || '').trim();
      const desc = descRaw && isLink ? escapeHtml(descRaw) : '';
      const merged = item.merged
        ? '<span class="sourceBadge" title="Дубликат слит с существующим">слит</span>'
        : '';
      const coverBadge = isCoverLetterSource(item)
        ? '<span class="sourceBadge" title="Похоже на сопроводительное">письмо</span>'
        : '';
      return `
        <div class="sourceItem${isNew}">
          <input type="checkbox" class="sourceCheckbox" value="${id}" ${checked} />
          <div class="sourceItemBody">
            <div class="sourceItemTitle" title="${title}">${title}${merged}${coverBadge}</div>
            <div class="sourceItemMeta">${escapeHtml(metaParts.join(' · ') || 'без метаданных')}</div>
            ${desc ? `<div class="sourceItemDesc" title="${desc}">${desc}</div>` : ''}
          </div>
          <button type="button" class="sourceDeleteBtn" data-id="${id}" data-title="${title}">×</button>
        </div>
      `;
    })
    .join('');
}

async function refreshAuthHint() {
  const testMode = await JR_API.isTestMode();
  const ws = await JR_API.getWorkspaceId();
  if (workspaceIdInput) workspaceIdInput.value = ws;
  if (testMode) {
    authHint.textContent = `Тестовый режим (без login) · workspace ${ws} (default ${JR_API.DEFAULT_TEST_WORKSPACE_ID})`;
    return true;
  }
  const saved = await chrome.storage.local.get(['userAccessToken', 'userEmail']);
  if (saved.userAccessToken) {
    authHint.textContent = `Вход: ${saved.userEmail || 'OK'} · workspace ${ws}`;
    return true;
  }
  authHint.textContent = 'Не авторизован - нажмите "Вход"';
  return false;
}

async function refreshGeminiRagStatus({ quiet = false } = {}) {
  if (!geminiRagStatusEl) return null;
  try {
    const st = await JR_API.geminiRagStatus();
    geminiRagReady = Boolean(st.enabled && st.ready);
    if (!st.enabled) {
      geminiRagStatusEl.textContent = 'База: расширенный поиск выключен на сервере';
      return st;
    }
    if (!st.hasGeminiKeys) {
      geminiRagStatusEl.textContent = 'База: нет ключей в Swoop Admin -> Settings';
      return st;
    }
    const syncNote = st.lastSyncAt ? `, sync: ${formatUpdatedAt(st.lastSyncAt)}` : '';
    geminiRagStatusEl.textContent = st.ready
      ? `База: OK · ${st.docCount || 0} док.${syncNote}`
      : `База: ${st.docCount || 0} док. · нажмите «Синхр.»${syncNote}`;
    if (!quiet && st.ready) {
      setSuccess(`База готова: ${st.docCount} док.`);
    }
    return st;
  } catch (err) {
    geminiRagReady = false;
    geminiRagStatusEl.textContent = `База: ${err.message}`;
    return null;
  }
}

async function refreshResumeStatus() {
  try {
    const st = await JR_API.resumeStatus();
    const ws = st.workspaceId || (await JR_API.getWorkspaceId());
    const lastAdd = lastAddedAt ? `, добавлено: ${formatUpdatedAt(lastAddedAt.toISOString())}` : '';
    resumeStatus.textContent = st.hasPrimaryCv
      ? `База резюме ws=${ws}: ${st.count} док., CV: OK, обновлено: ${st.lastUpdated || '-'}${lastAdd}`
      : `База резюме ws=${ws}: загрузите CV (сейчас ${st.count} док.)${lastAdd}`;
    await refreshGeminiRagStatus({ quiet: true });
  } catch (err) {
    resumeStatus.textContent = `База резюме: ${err.message}`;
  }
}

function getSelectedSourceIds() {
  return Array.from(document.querySelectorAll('.sourceCheckbox:checked'))
    .map((el) => Number(el.value))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function refreshSources({ highlightIds = [], quiet = false } = {}) {
  const refreshBtn = document.getElementById('refreshSourcesBtn');
  const ids = (highlightIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length) ids.forEach((id) => lastAddedSourceIds.add(id));
  sourcesListEl?.classList.add('isLoading');
  if (!quiet) {
    setButtonBusy(refreshBtn, true, 'Обновить', '…');
  }
  try {
    const data = await JR_API.listSources();
    const items = Array.isArray(data.items) ? data.items : [];
    renderSources(items);
    showIngestBanner({
      addedCount: ids.length,
      total: items.length,
      summary: ids.length
        ? `Новые источники подсвечены зелёным (${ids.length})`
        : lastIngestSummary,
    });
    const prefilled = await maybePrefillCoverTemplate(items).catch(() => false);
    if (!items.length) {
      if (!quiet) {
        setSuccess(
          `Список обновлён: 0 источников для workspaceId=${data.workspaceId || (await JR_API.getWorkspaceId())}. ` +
            `Test default = ${JR_API.DEFAULT_TEST_WORKSPACE_ID}. Если грузили в другой workspace - смените ID и «Сохранить».`
        );
      }
    } else if (!quiet && !ids.length && !prefilled) {
      setSuccess(`Список обновлён: ${items.length} источник(ов)`);
    }
    return items;
  } catch (err) {
    renderSources([]);
    setError(`Ошибка списка sources: ${String(err.message || err)}`);
    throw err;
  } finally {
    sourcesListEl?.classList.remove('isLoading');
    if (!quiet) setButtonBusy(refreshBtn, false, 'Обновить');
  }
}

function looksLikeCssGarbage(s) {
  const t = String(s || '');
  if (!t) return false;
  if (/!important/i.test(t)) return true;
  if (/\.[a-zA-Z_][\w-]*\s*\{/.test(t)) return true;
  if (/\{[^}]{0,120}(?:display|visibility|table-layout|white-space)\s*:/i.test(t)) return true;
  return false;
}

function renderStructured(structured) {
  if (!vacancyStructuredEl) return;
  if (!structured || typeof structured !== 'object') {
    vacancyStructuredEl.hidden = true;
    vacancyStructuredEl.innerHTML = '';
    return;
  }
  const clean = (v) => {
    const t = String(v || '').replace(/\s+/g, ' ').trim();
    if (!t || looksLikeCssGarbage(t)) return '';
    return t;
  };
  const rows = [
    ['Зарплата / доход', clean(structured.salary)],
    ['Опыт', clean(structured.experience)],
    ['Занятость', clean(structured.employmentType)],
    ['График', clean(structured.schedule)],
    ['Часы', clean(structured.workingHours)],
    ['Формат', clean(structured.workFormat)],
    ['Локация', clean(structured.location)],
    ['Seniority', clean(structured.seniority)],
    [
      'Навыки',
      Array.isArray(structured.keySkills)
        ? structured.keySkills.map(clean).filter(Boolean).join(', ')
        : '',
    ],
  ].filter(([, v]) => v && String(v).trim());

  if (!rows.length) {
    vacancyStructuredEl.hidden = true;
    vacancyStructuredEl.innerHTML = '';
    return;
  }
  vacancyStructuredEl.hidden = false;
  vacancyStructuredEl.innerHTML =
    '<strong>Структура</strong><ul>' +
    rows.map(([k, v]) => `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</li>`).join('') +
    '</ul>';
}

function renderRelevance(data) {
  if (!relevanceBox) return;
  if (!data || data.score == null) {
    relevanceBox.hidden = true;
    relevanceBox.innerHTML = '';
    relevanceBox.classList.remove('fromCache');
    return;
  }
  const fromCache = Boolean(data.fromCache);
  const fromList = data.cacheSource === 'list' || (fromCache && data.cacheSource !== 'detail');
  const subtitle = fromCache
    ? fromList
      ? 'Релевантность из списка'
      : 'Релевантность (кэш)'
    : 'Релевантность профиля ↔ вакансия';
  const bullets = (data.rationale || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const matched = (data.matched || []).map((r) => `<li class="relevanceMatched">${escapeHtml(r)}</li>`).join('');
  const missing = (data.missing || []).map((r) => `<li class="relevanceMissing">${escapeHtml(r)}</li>`).join('');
  const matchedJoined = (data.matched || []).join('\n');
  const sem = (data.semanticMatches || data.matchedSemantic || [])
    .slice(0, 8)
    .map((m) => {
      const label = m.label || m.skill || '';
      return `<li class="relevanceMatched">${escapeHtml(label)}</li>`;
    })
    .join('');
  relevanceBox.hidden = false;
  relevanceBox.classList.toggle('fromCache', fromCache);
  relevanceBox.innerHTML = `
    <div class="relevanceScoreRow">
      <div class="relevanceScore">${Number(data.score)} / 100</div>
      ${fromCache ? '<span class="relevanceCacheDot" title="Из кэша, без API" aria-label="Из кэша"></span>' : ''}
    </div>
    <div class="relevanceSubtitle">${escapeHtml(subtitle)}</div>
    ${bullets ? `<ul>${bullets}</ul>` : ''}
    ${matched ? `<div><b>Совпало</b><ul>${matched}</ul></div>` : ''}
    ${sem && !/смысл|семантика/i.test(matchedJoined) ? `<div><b>Совпало (смысл)</b><ul>${sem}</ul></div>` : ''}
    ${missing ? `<div><b>Не хватает в профиле</b><ul>${missing}</ul></div>` : ''}
  `;
}

function clearQaState() {
  window.__jrQaRows = [];
  renderQaTable([]);
  if (currentVacancy) {
    currentVacancy = { ...currentVacancy, questions: [] };
  }
}

/** Status dot: reading | ok | fail - visible while vacancy section is collapsed. */
function setVacancyPageStatus(state, title) {
  if (!vacancyStatusDot) return;
  const mode = state === 'reading' || state === 'ok' || state === 'fail' ? state : state ? 'ok' : 'fail';
  vacancyStatusDot.hidden = false;
  vacancyStatusDot.classList.remove('isOk', 'isFail', 'isReading');
  if (mode === 'reading') vacancyStatusDot.classList.add('isReading');
  else if (mode === 'ok') vacancyStatusDot.classList.add('isOk');
  else vacancyStatusDot.classList.add('isFail');
  const fallback =
    mode === 'reading' ? 'Чтение' : mode === 'ok' ? 'Страница прочитана' : 'Не удалось прочитать страницу';
  vacancyStatusDot.title = title || fallback;
  vacancyStatusDot.setAttribute('aria-label', vacancyStatusDot.title);
  vacancyStatusDot.setAttribute('aria-hidden', 'false');
}

function clearGenerateResult() {
  if (resultText) resultText.value = '';
  if (genMeta) genMeta.textContent = '';
  resultBoundUrl = '';
  resultBoundTabId = null;
  setResultGenerating(false);
  syncCopyButtonState();
}

function maybeClearResultForPageChange({ url = '', tabId = null, removedTabId = null } = {}) {
  const boundUrl = String(resultBoundUrl || '');
  const boundTab = resultBoundTabId != null ? Number(resultBoundTabId) : null;
  if (!boundUrl && boundTab == null) return false;
  if (removedTabId != null && boundTab != null && Number(removedTabId) === boundTab) {
    clearGenerateResult();
    return true;
  }
  const nextUrl = String(url || '');
  const nextTab = tabId != null ? Number(tabId) : null;
  const urlChanged = boundUrl && nextUrl && nextUrl !== boundUrl;
  const tabChanged = boundTab != null && nextTab != null && nextTab !== boundTab;
  const becameInactive = Boolean(boundUrl || boundTab != null) && (urlChanged || tabChanged);
  if (becameInactive) {
    clearGenerateResult();
    return true;
  }
  return false;
}

function applyVacancy(vacancy) {
  const prevId =
    String(currentVacancy?.id || '').trim() || vacancyIdFromUrl(currentVacancy?.url || '');
  currentVacancy = vacancy;
  const nextId = String(vacancy?.id || '').trim() || vacancyIdFromUrl(vacancy?.url || '');
  const host = vacancy.host || 'web';
  const site = vacancy.siteHost ? ` · ${vacancy.siteHost}` : '';
  const kind =
    vacancy.source === 'google_form' || vacancy.pageKind === 'google_form'
      ? ' · Google Form'
      : vacancy.source === 'hh_vacancy_response' || vacancy.pageKind === 'hh_vacancy_response'
        ? ' · HH вопросы работодателя'
        : vacancy.source === 'table_qa'
          ? ' · таблица Q&A'
          : '';
  vacancyMeta.textContent = `${vacancy.title || '-'} | ${vacancy.company || '-'} | ${host}${site}${kind}`;
  if (vacancy.description) vacancyDescription.value = vacancy.description;
  else if (vacancyDescription) vacancyDescription.value = '';
  renderStructured(vacancy.structured);
  // Keep cached score visible when re-reading the same vacancy (new window / re-extract).
  if (prevId !== nextId) renderRelevance(null);
  const qs = normalizeQuestionList(vacancy.questions);
  // Always reset Q&A block: hide when empty (no stale FAQ across navigations)
  if (!qs.length) {
    clearQaState();
    currentVacancy = { ...vacancy, questions: [] };
  } else {
    renderQaTable(qs.map((q) => ({ question: q.text, answer: '' })));
  }
  const descOk = String(vacancy.description || '').trim().length >= 20 || qs.length > 0;
  setVacancyPageStatus(
    descOk ? 'ok' : 'fail',
    descOk ? 'Страница прочитана' : 'Страница пустая или мало текста'
  );
}

/**
 * DOM extract from active tab.
 * @param {{ fromClick?: boolean, runRelevance?: boolean }} opts
 * fromClick/runRelevance: user action «Оценить предложение» -> extract + relevance API.
 * Auto tab-switch: extract only (zero LLM / no relevance tokens).
 */
async function refreshVacancyFromTab({ fromClick = false, runRelevance = false } = {}) {
  const doRelevance = Boolean(fromClick || runRelevance);
  const vacancyBtn = document.getElementById('refreshVacancyBtn');
  const seq = ++vacancyExtractSeq;
  setError('');
  setVacancyPageStatus('reading', 'Чтение');
  setSuccess('Чтение');
  // Early cache hydrate from URL (works even if DOM extract is slow / new window).
  if (!doRelevance) {
    await hydrateRelevanceFromActiveTabUrl();
    if (seq !== vacancyExtractSeq) return;
  }
  if (doRelevance) {
    setButtonBusy(vacancyBtn, true, BTN_EVALUATE_LABEL, 'Чтение…');
  }
  try {
    // Client-side DOM extract only - no /generate or Gemini (zero tokens).
    const windowId = await resolvePanelWindowId();
    const vacancy = await JR_API.fetchVacancyFromTab({ windowId });
    if (seq !== vacancyExtractSeq) return;
    if (!vacancy.id) {
      const vid = vacancyIdFromUrl(vacancy.url);
      if (vid) vacancy.id = vid;
    }
    lastTabUrl = String(vacancy.url || '');
    if (vacancy.tabId != null) lastTabId = Number(vacancy.tabId);
    applyVacancy(vacancy);
    const qn = normalizeQuestionList(vacancy.questions).length;
    const descOk = String(vacancy.description || '').trim().length >= 20 || qn > 0;
    const readMsg =
      vacancy.source === 'google_form'
        ? `Google Form прочитана (${qn} вопросов)`
        : vacancy.source === 'hh_vacancy_response' || vacancy.pageKind === 'hh_vacancy_response'
          ? qn
            ? `Страница отклика HH: ${qn} вопрос(ов) работодателя`
            : 'Страница отклика HH: вопросы не найдены (проверьте форму task-question)'
          : qn
            ? `Страница прочитана (${qn} вопросов)`
            : descOk
              ? 'Страница прочитана'
              : 'Страница пустая или мало текста';
    if (!descOk) {
      setVacancyPageStatus('fail', readMsg);
      setError(readMsg);
      // Still try cache hydrate - score is independent of description length.
      await tryRestoreRelevanceFromCache(vacancy);
      return;
    }
    setVacancyPageStatus('ok', 'Страница прочитана');
    setSuccess(readMsg);

    // Relevance only on explicit user click «Оценить предложение».
    // On auto tab/page read: restore list-score cache if any (zero tokens / no /relevance).
    if (doRelevance) {
      setButtonBusy(vacancyBtn, true, BTN_EVALUATE_LABEL, 'Оценка…');
      try {
        const data = await runRelevanceScore();
        if (seq !== vacancyExtractSeq) return;
        if (data && data.score != null) {
          setSuccess(`Страница прочитана · релевантность ${data.score} / 100`);
        } else if (data) {
          setError('Оценка не вернула score. Проверьте API / redeploy.');
        }
      } catch (relErr) {
        if (seq !== vacancyExtractSeq) return;
        setVacancyPageStatus('ok', 'Страница прочитана');
        setError(String(relErr.message || relErr));
      }
    } else {
      const restored = await tryRestoreRelevanceFromCache(vacancy);
      if (seq !== vacancyExtractSeq) return;
      if (!restored) {
        /* leave panel without relevance until user clicks «Оценить предложение» */
      }
    }
  } catch (err) {
    if (seq !== vacancyExtractSeq) return;
    clearQaState();
    setVacancyPageStatus('fail', 'Не удалось прочитать страницу');
    setError(String(err.message || err));
    // Last resort: hydrate score from active tab URL alone.
    await hydrateRelevanceFromActiveTabUrl();
  } finally {
    if (doRelevance) {
      setButtonBusy(vacancyBtn, false, BTN_EVALUATE_LABEL);
    }
  }
}

function scheduleVacancyExtractFromTab({ debounceMs = 280 } = {}) {
  setVacancyPageStatus('reading', 'Чтение');
  setSuccess('Чтение');
  clearTimeout(vacancyExtractTimer);
  vacancyExtractTimer = setTimeout(() => {
    refreshVacancyFromTab({ fromClick: false, runRelevance: false }).catch(() => {});
  }, debounceMs);
}

function normalizeQuestionList(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((item, i) => {
    let text = '';
    let type = 'text';
    let options = [];
    let id = String(i + 1);
    if (typeof item === 'string') {
      text = item.trim();
    } else if (item && typeof item === 'object') {
      text = String(item.text || item.question || '').trim();
      type = String(item.type || 'text');
      options = Array.isArray(item.options) ? item.options.map(String) : [];
      id = String(item.id || i + 1);
    }
    if (!text || text.length < 2) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, text, type, options });
  });
  return out;
}

function renderQaTable(rows) {
  const section = document.getElementById('qaSection');
  const table = document.getElementById('qaTable');
  const meta = document.getElementById('qaMeta');
  if (!section || !table) return;
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.question || r.answer)) : [];
  if (!list.length) {
    section.hidden = true;
    table.innerHTML = '';
    return;
  }
  section.hidden = false;
  const qaDetails = document.getElementById('qaResultsDetails');
  if (qaDetails && list.some((r) => String(r.answer || '').trim())) {
    qaDetails.open = true;
  }
  if (meta) {
    const answered = list.filter((r) => String(r.answer || '').trim()).length;
    meta.textContent =
      answered > 0
        ? `Вопрос | Ответ · ${answered}/${list.length} с ответом. Копируйте по строкам или «Копировать все».`
        : `Найдено вопросов: ${list.length}. Нажмите «Ответы на вопросы» - появятся ответы для копирования.`;
  }
  table.innerHTML = list
    .map((row, idx) => {
      const q = escapeHtml(row.question || '');
      const a = escapeHtml(row.answer || '—');
      return `
        <div class="qaRow" data-idx="${idx}">
          <div class="qaQuestion"><b>Вопрос:</b> ${q}</div>
          <div class="qaAnswer"><b>Ответ:</b> ${a}</div>
          <div class="qaRowActions">
            <button type="button" class="qaCopyBtn" data-copy-idx="${idx}">Копировать ответ</button>
          </div>
        </div>`;
    })
    .join('');
  table.querySelectorAll('.qaCopyBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-copy-idx'));
      const row = list[idx];
      const text = String(row?.answer || '').trim() || String(row?.question || '');
      try {
        await copyTextToClipboard(text);
        const prev = btn.textContent;
        btn.textContent = 'Скопировано';
        setSuccess('Скопировано');
        setTimeout(() => {
          btn.textContent = prev || 'Копировать ответ';
        }, 1500);
      } catch (err) {
        setError(String(err.message || err));
      }
    });
  });
  window.__jrQaRows = list;
}

function buildVacancyPayload() {
  const base = currentVacancy || {};
  const description = String(vacancyDescription.value || base.description || '').trim();
  const title = String(base.title || 'Вакансия').trim();
  const structured = base.structured && typeof base.structured === 'object' ? base.structured : undefined;
  const questions = normalizeQuestionList(base.questions);
  return {
    url: base.url || '',
    title,
    company: base.company || '',
    description:
      description ||
      (questions.length
        ? questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')
        : ''),
    questions,
    structured: structured || undefined,
    source: base.source || undefined,
  };
}

async function runRelevanceScore() {
  const vacancy = buildVacancyPayload();
  if (!vacancy.description || vacancy.description.length < 20) {
    setError('Нужно описание вакансии для оценки релевантности');
    return;
  }
  if (relevanceBox) {
    relevanceBox.hidden = false;
    relevanceBox.classList.remove('fromCache');
    relevanceBox.innerHTML = '<div>Считаю релевантность…</div>';
  }
  const data = await JR_API.scoreRelevance({
    vacancy,
    selectedSourceIds: getSelectedSourceIds(),
  });
  renderRelevance(data);
  if (data && data.score != null) {
    const vid = vacancyIdFromUrl(vacancy.url);
    await upsertRelevanceCache(
      [
        {
          id: vid,
          url: vacancy.url,
          title: vacancy.title,
          score: data.score,
          matched: data.matched || [],
          missing: data.missing || [],
          rationale: data.rationale || [],
        },
      ],
      'detail'
    );
  }
  return data;
}

async function runGenerate(mode) {
  setError('');
  setSuccess('');
  const vacancy = buildVacancyPayload();
  const isQa = mode === 'question_answers' || mode === 'qa';
  if (!vacancy.description || vacancy.description.length < 20) {
    setError('Нужно описание вакансии - нажмите «Оценить предложение»');
    return;
  }
  if (isQa && (!vacancy.questions || !vacancy.questions.length)) {
    setError('На странице нет вопросов. Откройте Google Form / таблицу или HH с вопросами, затем «Оценить предложение».');
    return;
  }
  const btn = isQa ? genAnswersBtn : genCoverBtn;
  const idle = isQa ? 'Ответы на вопросы' : 'Отклик';
  const busyLabel = isQa ? 'Готовлю ответы…' : 'Пишу отклик…';
  setButtonBusy(btn, true, idle, 'Генерация…');
  genMeta.textContent = 'Генерация…';
  setResultGenerating(true, busyLabel);
  try {
    // Relevance comes back with /generate (deterministic, no LLM). Do not pre-call /relevance.
    const coverTemplate = String(coverTemplateEl?.value || '').trim();
    const promptExtraRaw = String(promptExtraEl?.value || '').trim();
    const ragEditsText = String(ragEditsInput?.value || '').trim();
    const systemAsExtra = isJrSystemPromptText(promptExtraRaw);
    // Default ultra-short lives in backend system; skip duplicate CUSTOM + override parse.
    const promptExtra = systemAsExtra ? '' : promptExtraRaw;
    const profileOverrides = {
      ...parseProfileOverrides(ragEditsText),
      ...(systemAsExtra ? {} : parseProfileOverrides(promptExtraRaw)),
    };
    if (coverTemplateEl) {
      await chrome.storage.local.set({ jrCoverTemplate: coverTemplate });
    }
    // Промпт: только через «Сохранить промпт»; на generate уходит текущее значение textarea.
    const data = await JR_API.generateResponse({
      mode: isQa ? 'qa' : 'cover_letter',
      host: currentVacancy?.host || 'web',
      vacancy,
      selectedSourceIds: getSelectedSourceIds(),
      coverTemplate: !isQa ? coverTemplate : undefined,
      promptExtra,
      profileOverrides: Object.keys(profileOverrides).length ? profileOverrides : undefined,
      useGeminiRag: geminiRagReady,
    });
    const letter = String(data.text || '').trim();
    resultText.value = letter;
    syncCopyButtonState();
    resultBoundUrl = String(vacancy.url || lastTabUrl || '');
    resultBoundTabId = lastTabId != null ? Number(lastTabId) : null;
    if (Array.isArray(data.answers) && data.answers.length) {
      const mapped = data.answers.map((a, i) => {
        let question = String(a.question || a.text || '').trim();
        if (!question && vacancy.questions[i]) question = vacancy.questions[i].text || '';
        return {
          question,
          answer: a.answer || '',
        };
      });
      renderQaTable(mapped);
    } else if (isQa && vacancy.questions.length) {
      // Fallback: keep questions visible even if JSON parse failed
      renderQaTable(vacancy.questions.map((q) => ({ question: q.text, answer: letter || '' })));
    }
    if (data.relevance) renderRelevance(data.relevance);
    const bits = [];
    bits.push(`источники: ${(data.sources || []).length}`);
    if (data.relevance?.score != null) bits.push(`score: ${data.relevance.score}`);
    if (data.usedCoverTemplate) bits.push('шаблон: да');
    if (data.elapsedSec != null) bits.push(`${data.elapsedSec}s`);
    if (data.limitMessage) bits.push(String(data.limitMessage));
    genMeta.textContent = bits.join(' · ');
    if (data.ok === false && data.message) {
      setError(String(data.message));
      return;
    }
    if (!letter && !(Array.isArray(data.answers) && data.answers.length)) {
      setError(data.message || 'API ответил без текста. Повторите.');
      return;
    }
    setSuccess(isQa ? 'Ответы готовы' : 'Готово');
  } catch (err) {
    genMeta.textContent = '';
    setError(String(err.message || err));
  } finally {
    setResultGenerating(false);
    setButtonBusy(btn, false, idle);
  }
}

const refreshVacancyBtn = document.getElementById('refreshVacancyBtn');
const genCoverBtn = document.getElementById('genCoverBtn');
const genAnswersBtn = document.getElementById('genAnswersBtn');
const copyBtn = document.getElementById('copyBtn');
const copyAllQaBtn = document.getElementById('copyAllQaBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshSourcesBtn = document.getElementById('refreshSourcesBtn');
const geminiRagSyncBtn = document.getElementById('geminiRagSyncBtn');
const saveWorkspaceBtn = document.getElementById('saveWorkspaceBtn');

const resumeFileInput = document.getElementById('resumeFile');
const resumeFileHint = document.getElementById('resumeFileHint');
const portfolioFilesInput = document.getElementById('portfolioFiles');
const portfolioFileHint = document.getElementById('portfolioFileHint');
const ragTextInput = document.getElementById('ragTextInput');
const ragTextTitle = document.getElementById('ragTextTitle');
const coverTemplateEl = document.getElementById('coverTemplate');
const promptExtraEl = document.getElementById('promptExtra');
const resetPromptBtn = document.getElementById('resetPromptBtn');
const savePromptBtn = document.getElementById('savePromptBtn');
const coverFromRagBtn = document.getElementById('coverFromRagBtn');
const saveCoverTemplateBtn = document.getElementById('saveCoverTemplateBtn');
const migrateCoverTemplateBtn = document.getElementById('migrateCoverTemplateBtn');
const ragEditsInput = document.getElementById('ragEditsInput');
const saveRagEditsBtn = document.getElementById('saveRagEditsBtn');
const ragEditsMeta = document.getElementById('ragEditsMeta');
const promptExtraMeta = document.getElementById('promptExtraMeta');
const linkUrlInput = document.getElementById('linkUrl');
const linkTitleInput = document.getElementById('linkTitle');
const driveFolderInput = document.getElementById('driveFolderInput');
const driveTokenInput = document.getElementById('driveTokenInput');
const driveStatusEl = document.getElementById('driveStatus');
const driveConnectBtn = document.getElementById('driveConnectBtn');
const driveDisconnectBtn = document.getElementById('driveDisconnectBtn');
const driveManualDetails = document.getElementById('driveManualDetails');

const uploadResumeFileBtn = document.getElementById('uploadResumeFileBtn');
const uploadPortfolioFilesBtn = document.getElementById('uploadPortfolioFilesBtn');
const addRagTextBtn = document.getElementById('addRagTextBtn');
const addLinkBtn = document.getElementById('addLinkBtn');
const driveImportBtn = document.getElementById('driveImportBtn');

function formatFileHint(input, hintEl) {
  if (!hintEl) return;
  const files = Array.from(input?.files || []);
  if (!files.length) {
    hintEl.textContent = 'Файлов не выбрано';
    return;
  }
  const names = files.map((f) => f.name).slice(0, 4);
  const more = files.length > 4 ? ` и ещё ${files.length - 4}` : '';
  hintEl.textContent = `Выбрано ${files.length}: ${names.join(', ')}${more}`;
}

function collectLinkedIds(res) {
  const ids = [];
  if (res?.knowledgeItemId) ids.push(res.knowledgeItemId);
  for (const link of res?.linkedSources || []) {
    if (link?.knowledgeItemId) ids.push(link.knowledgeItemId);
  }
  return ids;
}

function formatLinkedNote(res) {
  const n = (res?.linkedSources || []).length;
  if (!n) return '';
  const fresh = (res.linkedSources || []).filter((x) => !x.deduped).length;
  return ` · ссылок: ${n}${fresh ? ` (новых ${fresh})` : ''}`;
}

async function uploadFilesSequentially(files, { kind, category, button, label }) {
  const added = [];
  const errors = [];
  let linkedTotal = 0;
  let okCount = 0;
  let i = 0;
  for (const file of files) {
    i += 1;
    if (button) {
      setButtonBusy(button, true, button.dataset.idleLabel, `Загрузка ${i}/${files.length}…`);
    }
    try {
      const res = await JR_API.resumeFileCapture({
        file,
        kind,
        category,
        title: file.name,
      });
      okCount += 1;
      added.push(...collectLinkedIds(res));
      linkedTotal += (res.linkedSources || []).length;
    } catch (err) {
      errors.push(`${file.name}: ${err.message || err}`);
    }
  }
  return { added, errors, linkedTotal, okCount };
}

async function refreshDriveStatus() {
  if (!driveStatusEl || typeof JR_DRIVE_AUTH === 'undefined') return;
  const st = await JR_DRIVE_AUTH.loadUiState();
  if (driveFolderInput && !driveFolderInput.value && st.folderUrlOrId) {
    driveFolderInput.value = st.folderUrlOrId;
  }
  if (driveTokenInput && st.manualToken && !driveTokenInput.value) {
    driveTokenInput.value = st.manualToken;
  }
  if (!st.oauthConfigured) {
    driveStatusEl.textContent =
      'Drive: OAuth client_id ещё не задан в manifest - используйте ручной token или настройте GCP (drive.md)';
    if (driveConnectBtn) driveConnectBtn.hidden = true;
    if (driveDisconnectBtn) driveDisconnectBtn.hidden = true;
    if (driveManualDetails) driveManualDetails.open = true;
    return;
  }
  if (driveConnectBtn) driveConnectBtn.hidden = Boolean(st.connected);
  if (driveDisconnectBtn) driveDisconnectBtn.hidden = !st.connected;
  driveStatusEl.textContent = st.connected
    ? 'Drive: подключён (chrome.identity). Папку укажите один раз - импорт берёт token сам.'
    : 'Drive: не подключён. Нажмите «Подключить Google Drive».';
}

if (saveWorkspaceBtn) {
  saveWorkspaceBtn.addEventListener('click', async () => {
    setError('');
    setButtonBusy(saveWorkspaceBtn, true, 'OK', 'Сохранение…');
    try {
      const id = await JR_API.setWorkspaceId(workspaceIdInput?.value || JR_API.DEFAULT_TEST_WORKSPACE_ID);
      await refreshAuthHint();
      await refreshResumeStatus();
      await refreshSources();
      setSuccess(`workspaceId = ${id}`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(saveWorkspaceBtn, false, 'OK');
    }
  });
}

if (resumeFileInput) {
  resumeFileInput.addEventListener('change', () => formatFileHint(resumeFileInput, resumeFileHint));
}
if (portfolioFilesInput) {
  portfolioFilesInput.addEventListener('change', () => formatFileHint(portfolioFilesInput, portfolioFileHint));
}

if (uploadResumeFileBtn) {
  uploadResumeFileBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const files = Array.from(resumeFileInput?.files || []);
    if (!files.length) {
      setError('Сначала выберите CV файл(ы)');
      resumeFileInput?.click();
      return;
    }
    uploadResumeFileBtn.dataset.idleLabel = 'Добавить CV';
    setButtonBusy(uploadResumeFileBtn, true, 'Добавить CV', `Загрузка 0/${files.length}…`);
    try {
      await JR_API.ensureWorkspace();
      const { added, errors, linkedTotal, okCount } = await uploadFilesSequentially(files, {
        kind: 'job_resume',
        category: 'cv',
        button: uploadResumeFileBtn,
        label: 'CV',
      });
      await refreshResumeStatus();
      await refreshSources({ highlightIds: added, quiet: true });
      resumeFileInput.value = '';
      formatFileHint(resumeFileInput, resumeFileHint);
      if (errors.length) {
        setError(`Часть CV не загрузилась:\n${errors.join('\n')}`);
      }
      if (okCount > 0) {
        const summary =
          `CV: ${okCount}/${files.length} файл(ов)` +
          (linkedTotal ? ` · извлечено ссылок: ${linkedTotal}` : '');
        setSuccess(summary);
        showIngestBanner({ addedCount: added.length || okCount, summary });
      }
    } catch (err) {
      setError(String(err.message || err));
      await refreshSources().catch(() => {});
    } finally {
      setButtonBusy(uploadResumeFileBtn, false, 'Добавить CV');
    }
  });
}

if (uploadPortfolioFilesBtn) {
  uploadPortfolioFilesBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const files = Array.from(portfolioFilesInput?.files || []);
    if (!files.length) {
      setError('Сначала выберите файлы portfolio');
      portfolioFilesInput?.click();
      return;
    }
    uploadPortfolioFilesBtn.dataset.idleLabel = 'Добавить portfolio';
    setButtonBusy(uploadPortfolioFilesBtn, true, 'Добавить portfolio', `Загрузка 0/${files.length}…`);
    try {
      await JR_API.ensureWorkspace();
      const { added, errors, linkedTotal, okCount } = await uploadFilesSequentially(files, {
        kind: 'job_experience',
        category: 'experience',
        button: uploadPortfolioFilesBtn,
        label: 'Portfolio',
      });
      await refreshResumeStatus();
      await refreshSources({ highlightIds: added, quiet: true });
      portfolioFilesInput.value = '';
      formatFileHint(portfolioFilesInput, portfolioFileHint);
      if (errors.length) {
        setError(`Часть файлов не загрузилась:\n${errors.join('\n')}`);
      }
      if (okCount > 0) {
        const summary =
          `Portfolio: ${okCount}/${files.length} файл(ов)` +
          (linkedTotal ? ` · извлечено ссылок: ${linkedTotal}` : '');
        setSuccess(summary);
        showIngestBanner({ addedCount: added.length || okCount, summary });
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(uploadPortfolioFilesBtn, false, 'Добавить portfolio');
    }
  });
}

function stripJrProfileWrapper(text) {
  const raw = String(text || '');
  const marker = '---jr_profile---';
  const idx = raw.indexOf(marker);
  if (idx < 0) return raw.trim();
  return raw.slice(0, idx).trim();
}

function findOverridesSourceText(items) {
  const list = Array.isArray(items) ? items : [];
  const hit = list.find((s) => {
    const kind = String(s?.kind || '').toLowerCase();
    const category = String(s?.category || '').toLowerCase();
    return kind === 'job_profile_overrides' || category === 'overrides';
  });
  if (!hit) return '';
  return stripJrProfileWrapper(
    hit.contentSnippet ||
      hit.content_snippet ||
      hit.contentText ||
      hit.content_text ||
      hit.preview ||
      hit.aiSummary ||
      ''
  );
}

function setRagEditsMeta(msg) {
  if (ragEditsMeta) ragEditsMeta.textContent = msg || '';
}

async function persistRagEditsLocal(text) {
  await chrome.storage.local.set({ jrRagEdits: String(text || '') });
}

/** Focus result area + overlay spinner while /generate runs. */
function setResultGenerating(busy, label) {
  const wrap = document.getElementById('resultWrap');
  const busyEl = document.getElementById('resultBusy');
  const busyText = document.getElementById('resultBusyText');
  const genSection = document.getElementById('generateSection');
  if (genSection) genSection.open = true;
  if (wrap) wrap.classList.toggle('isGenerating', Boolean(busy));
  if (busyEl) {
    busyEl.hidden = !busy;
    busyEl.setAttribute('aria-hidden', busy ? 'false' : 'true');
  }
  if (busyText) busyText.textContent = label || 'Генерация…';
  if (!resultText) return;
  resultText.classList.toggle('isGenerating', Boolean(busy));
  resultText.classList.add('isExpanded');
  if (busy) {
    resultText.setAttribute('aria-busy', 'true');
    try {
      resultText.focus({ preventScroll: true });
    } catch (_) {
      resultText.focus();
    }
  } else {
    resultText.removeAttribute('aria-busy');
    try {
      resultText.focus({ preventScroll: true });
    } catch (_) {
      resultText.focus();
    }
  }
}

if (addRagTextBtn) {
  addRagTextBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const text = String(ragTextInput?.value || '').trim();
    const title = String(ragTextTitle?.value || '').trim();
    if (text.length < 20) {
      setError('Вставьте текст (мин. 20 символов)');
      return;
    }
    setButtonBusy(addRagTextBtn, true, 'Добавить текст', 'Добавление…');
    try {
      await JR_API.ensureWorkspace();
      const res = await JR_API.resumeTextCapture({
        text,
        title: title || undefined,
        kind: 'job_experience',
        category: 'notes',
      });
      const ids = collectLinkedIds(res);
      const summary = `Текст в базе (id=${res.knowledgeItemId})${formatLinkedNote(res)}`;
      setSuccess(summary);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: ids, quiet: true });
      showIngestBanner({ addedCount: ids.length || 1, summary });
      if (ragTextInput) ragTextInput.value = '';
      if (ragTextTitle) ragTextTitle.value = '';
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(addRagTextBtn, false, 'Добавить текст');
    }
  });
}

let ragEditsSaveTimer = null;
if (ragEditsInput) {
  ragEditsInput.addEventListener('input', () => {
    clearTimeout(ragEditsSaveTimer);
    ragEditsSaveTimer = setTimeout(() => {
      persistRagEditsLocal(ragEditsInput.value).catch(() => {});
    }, 400);
  });
  ragEditsInput.addEventListener('focus', () => {
    ragEditsInput.classList.add('isFocused');
  });
  ragEditsInput.addEventListener('blur', () => {
    ragEditsInput.classList.remove('isFocused');
    persistRagEditsLocal(ragEditsInput.value).catch(() => {});
  });
}

if (saveRagEditsBtn) {
  saveRagEditsBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const text = String(ragEditsInput?.value || '').trim();
    if (text.length < 3) {
      setError('Введите правки (мин. 3 символа), например: Telegram: @autoro_tech');
      return;
    }
    setButtonBusy(saveRagEditsBtn, true, 'Сохранить правки', 'Сохранение…');
    try {
      await JR_API.ensureWorkspace();
      await persistRagEditsLocal(text);
      const res = await JR_API.resumePatch({ text });
      const kid = res.knowledgeItemId;
      const action = res.replaced ? 'обновлены' : 'созданы';
      const parsed =
        res.parsedContacts && typeof res.parsedContacts === 'object'
          ? res.parsedContacts
          : parseProfileOverrides(text);
      const preview = formatParsedContactsPreview(parsed);
      const syncNote = res.geminiSync?.awaited
        ? res.geminiSync?.ok === false
          ? ' Синхр. базы: ошибка (правки всё равно в отклике).'
          : ' Синхр. базы: ok.'
        : ' Синхр. базы в очереди.';
      const summary = preview
        ? `Правки профиля ${action}. Сохранено: ${preview}.${syncNote}`
        : `Правки профиля ${action}.${syncNote}`;
      setSuccess(summary);
      await refreshResumeStatus();
      await refreshSources({
        highlightIds: kid ? [kid] : [],
        quiet: true,
      });
      showIngestBanner({ addedCount: 1, summary });
      if (typeof refreshGeminiRagStatus === 'function') {
        await refreshGeminiRagStatus().catch(() => {});
      }
      // Draft cleared after successful save - facts stay in knowledge base.
      if (ragEditsInput) ragEditsInput.value = '';
      await persistRagEditsLocal('');
      setRagEditsMeta(`${summary} Поле очищено - правки уже в базе.`);
    } catch (err) {
      setError(String(err.message || err));
      setRagEditsMeta('');
    } finally {
      setButtonBusy(saveRagEditsBtn, false, 'Сохранить правки');
    }
  });
}

if (addLinkBtn) {
  addLinkBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const url = String(linkUrlInput?.value || '').trim();
    const title = String(linkTitleInput?.value || '').trim();
    if (!url) {
      setError('Укажите ссылку');
      return;
    }
    setButtonBusy(addLinkBtn, true, 'Добавить ссылку', 'Загрузка…');
    try {
      await JR_API.ensureWorkspace();
      const res = await JR_API.resumeLinkCapture({
        url,
        title: title || undefined,
        kind: 'job_experience',
        category: 'link',
      });
      const summary = `Ссылка добавлена (id=${res.knowledgeItemId})${formatLinkedNote(res)}`;
      setSuccess(summary);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: collectLinkedIds(res), quiet: true });
      showIngestBanner({ addedCount: 1, summary });
      linkUrlInput.value = '';
      linkTitleInput.value = '';
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(addLinkBtn, false, 'Добавить ссылку');
    }
  });
}

if (driveConnectBtn) {
  driveConnectBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    setButtonBusy(driveConnectBtn, true, 'Подключить', 'Подключение…');
    try {
      await JR_DRIVE_AUTH.connectInteractive();
      await refreshDriveStatus();
      setSuccess('Google Drive подключён');
    } catch (err) {
      setError(String(err.message || err));
      await refreshDriveStatus();
    } finally {
      setButtonBusy(driveConnectBtn, false, 'Подключить');
    }
  });
}

if (driveDisconnectBtn) {
  driveDisconnectBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    try {
      await JR_DRIVE_AUTH.disconnect();
      await refreshDriveStatus();
      setSuccess('Google Drive отключён');
    } catch (err) {
      setError(String(err.message || err));
    }
  });
}

if (driveImportBtn) {
  driveImportBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const folderUrlOrId = String(driveFolderInput?.value || '').trim();
    const manualToken = String(driveTokenInput?.value || '').trim();
    if (!folderUrlOrId) {
      setError('Укажите URL или ID папки Google Drive');
      return;
    }
    setButtonBusy(driveImportBtn, true, 'Импорт из Drive', 'Импорт…');
    try {
      await JR_DRIVE_AUTH.saveFolder(folderUrlOrId);
      if (manualToken) await JR_DRIVE_AUTH.saveManualToken(manualToken);

      let { accessToken, source } = await JR_DRIVE_AUTH.resolveAccessToken({
        allowInteractive: true,
        manualToken,
      });

      await JR_API.ensureWorkspace();
      let res;
      try {
        res = await JR_API.driveImport({ folderUrlOrId, accessToken });
      } catch (err) {
        const msg = String(err.message || err);
        if (/401|unauthor/i.test(msg) && source === 'identity') {
          ({ accessToken, source } = await JR_DRIVE_AUTH.refreshAfterUnauthorized(manualToken));
          res = await JR_API.driveImport({ folderUrlOrId, accessToken });
        } else {
          throw err;
        }
      }

      const ids = [];
      for (const x of res.imported || []) {
        if (x.knowledgeItemId) ids.push(x.knowledgeItemId);
        for (const link of x.linkedSources || []) {
          if (link?.knowledgeItemId) ids.push(link.knowledgeItemId);
        }
      }
      await refreshResumeStatus();
      await refreshSources({ highlightIds: ids, quiet: true });
      await refreshDriveStatus();
      const errN = (res.errors || []).length;
      const via = source === 'identity' ? 'oauth' : 'manual token';
      const linkedN = ids.length - (res.importedCount || 0);
      const summary =
        `Drive: импортировано ${res.importedCount || 0}` +
        (linkedN > 0 ? `, ссылок ${linkedN}` : '') +
        (errN ? `, ошибок ${errN}` : '') +
        ` (${via})`;
      showIngestBanner({ addedCount: ids.length, summary });
      if (errN && !(res.importedCount > 0)) {
        setError(`${summary}\n${(res.errors || []).map((e) => `${e.name}: ${e.error}`).join('\n')}`);
      } else if (errN) {
        setSuccess(summary);
        errorEl.textContent = (res.errors || []).map((e) => `${e.name}: ${e.error}`).join('\n');
      } else {
        setSuccess(summary);
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(driveImportBtn, false, 'Импорт из Drive');
    }
  });
}

refreshVacancyBtn.addEventListener('click', () =>
  refreshVacancyFromTab({ fromClick: true, runRelevance: true })
);
refreshSourcesBtn.addEventListener('click', () => {
  setError('');
  refreshSources({ quiet: false }).catch(() => {});
});

if (geminiRagSyncBtn) {
  geminiRagSyncBtn.addEventListener('click', async () => {
    setError('');
    setButtonBusy(geminiRagSyncBtn, true, 'Синхр.', '…');
    if (geminiRagStatusEl) geminiRagStatusEl.textContent = 'Синхронизация…';
    try {
      const res = await JR_API.geminiRagSync({ poll: true });
      await refreshGeminiRagStatus({ quiet: true });
      setSuccess(
        res.queued
          ? 'Синхронизация базы поставлена в очередь'
          : `Синхр. базы: ${res.synced || 0} / пропущено ${res.skipped || 0}`
      );
    } catch (err) {
      setError(String(err.message || err));
      await refreshGeminiRagStatus({ quiet: true });
    } finally {
      setButtonBusy(geminiRagSyncBtn, false, 'Синхр.');
    }
  });
}

if (sourcesListEl) {
  sourcesListEl.addEventListener('click', async (ev) => {
    const btn = ev.target?.closest?.('.sourceDeleteBtn');
    if (!btn) return;
    ev.preventDefault();
    const id = Number(btn.getAttribute('data-id') || 0);
    const title = String(btn.getAttribute('data-title') || 'источник');
    if (!id) return;
    if (!window.confirm(`Удалить «${title}» из базы резюме?`)) return;
    setError('');
    setSuccess('');
    setButtonBusy(btn, true, '×', '…');
    try {
      await JR_API.deleteSources({ knowledgeItemIds: [id] });
      lastAddedSourceIds.delete(id);
      await refreshResumeStatus();
      await refreshSources({ quiet: true });
      setSuccess(`Удалено: ${title}`);
    } catch (err) {
      setError(String(err.message || err));
      setButtonBusy(btn, false, '×');
    }
  });
}
genCoverBtn.addEventListener('click', () => runGenerate('cover_letter'));
genAnswersBtn.addEventListener('click', () => runGenerate('question_answers'));
if (copyBtn) {
  // mousedown preventDefault keeps #resultText focused so blur doesn't shrink it before click.
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  copyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getResultCopyText();
    if (!isResultCopyable(text)) {
      setError('Нечего копировать - сначала нажмите «Отклик»');
      syncCopyButtonState();
      keepResultPanelExpanded({ wasExpanded: true });
      return;
    }
    try {
      await copyTextToClipboard(text, { sourceEl: resultText, keepExpanded: true });
      keepResultPanelExpanded({ wasExpanded: true });
      flashCopyFeedback(copyBtn, 'Копировать', 'Скопировано');
      setSuccess('Скопировано');
    } catch (err) {
      keepResultPanelExpanded({ wasExpanded: true });
      setError(String(err.message || err));
    }
  });
}
syncCopyButtonState();

if (copyAllQaBtn) {
  copyAllQaBtn.addEventListener('click', async () => {
    const rows = Array.isArray(window.__jrQaRows) ? window.__jrQaRows : [];
    const text = rows
      .map((r) => {
        const q = String(r.question || '').trim();
        const a = String(r.answer || '').trim();
        if (!q && !a) return '';
        return `Вопрос: ${q}\nОтвет: ${a || '-'}`;
      })
      .filter(Boolean)
      .join('\n\n');
    try {
      const payload = text || getResultCopyText();
      if (!payload) {
        setError('Нечего копировать');
        return;
      }
      await copyTextToClipboard(payload, { sourceEl: text ? null : resultText });
      flashCopyFeedback(copyAllQaBtn, 'Копировать все', 'Скопировано');
      setSuccess('Скопировано');
    } catch (err) {
      setError(String(err.message || err));
    }
  });
}

loginBtn.addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('login.html'), type: 'popup', width: 420, height: 520 });
});

logoutBtn.addEventListener('click', async () => {
  await JR_API.logout();
  await refreshAuthHint();
  setSuccess('Выход выполнен');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.userAccessToken || changes.jrTestMode || changes.jrWorkspaceId) {
    refreshAuthHint();
    refreshResumeStatus();
    refreshSources({ quiet: true }).catch(() => {});
  }
  if (changes.jrCoverTemplate && coverTemplateEl && document.activeElement !== coverTemplateEl) {
    coverTemplateEl.value = String(changes.jrCoverTemplate.newValue || '');
  }
  if (changes.jrPromptExtra && promptExtraEl && document.activeElement !== promptExtraEl) {
    const next = String(changes.jrPromptExtra.newValue || DEFAULT_PROMPT_EXTRA);
    savedPromptExtra = next;
    promptExtraEl.value = next;
    syncPromptSaveButton();
  }
  if (changes.jrRagEdits && ragEditsInput && document.activeElement !== ragEditsInput) {
    ragEditsInput.value = String(changes.jrRagEdits.newValue || '');
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'JR_TAB_REMOVED') {
    if (!isMessageForThisPanel(message)) return;
    const removedId = message.tabId != null ? Number(message.tabId) : null;
    maybeClearResultForPageChange({ removedTabId: removedId });
    clearQaState();
    renderRelevance(null);
    // Active tab re-read comes via JR_TAB_CHANGED (after_remove).
    return;
  }
  if (message?.type !== 'JR_TAB_CHANGED' && message?.type !== 'JR_TAB_NAVIGATED') return;
  if (!isMessageForThisPanel(message)) return;
  const url = String(message.url || '');
  const tabId = message.tabId != null ? Number(message.tabId) : null;
  maybeClearResultForPageChange({ url, tabId });
  if (url && url === lastTabUrl && (tabId == null || tabId === lastTabId)) return;
  lastTabUrl = url;
  if (tabId != null) lastTabId = tabId;
  // Clear stale form Q&A + relevance, then DOM-only re-extract (no LLM / no relevance API).
  clearQaState();
  renderRelevance(null);
  // Instant score from cache by URL (new window / tab switch) before extract finishes.
  const vid = vacancyIdFromUrl(url);
  if (vid) {
    tryRestoreRelevanceFromCache({ id: vid, url }).catch(() => {});
  }
  if (message.canExtract === false) {
    setVacancyPageStatus('fail', 'Не http(s) страница');
    setError('Откройте обычную http(s) страницу с вакансией');
    return;
  }
  scheduleVacancyExtractFromTab({ debounceMs: 280 });
});

let coverTemplateSaveTimer = null;
if (coverTemplateEl) {
  coverTemplateEl.addEventListener('input', () => {
    clearTimeout(coverTemplateSaveTimer);
    coverTemplateSaveTimer = setTimeout(() => {
      chrome.storage.local.set({ jrCoverTemplate: String(coverTemplateEl.value || '') });
    }, 400);
  });
}

if (promptExtraEl) {
  promptExtraEl.addEventListener('input', () => {
    syncPromptSaveButton();
  });
  promptExtraEl.addEventListener('focus', () => {
    promptExtraEl.classList.add('isFocused');
  });
  promptExtraEl.addEventListener('blur', () => {
    promptExtraEl.classList.remove('isFocused');
  });
}

if (savePromptBtn) {
  savePromptBtn.addEventListener('click', async () => {
    if (!promptExtraEl) return;
    const value = String(promptExtraEl.value || '');
    await chrome.storage.local.set({ jrPromptExtra: value });
    savedPromptExtra = value;
    syncPromptSaveButton();
    setSuccess('Промпт сохранён');
  });
}

if (resetPromptBtn) {
  resetPromptBtn.addEventListener('click', async () => {
    let live = DEFAULT_PROMPT_EXTRA;
    try {
      const data = await JR_API.getDefaultPrompt();
      if (data?.prompt && isJrSystemPromptText(data.prompt)) {
        live = String(data.prompt);
      }
    } catch {
      /* use bundled default */
    }
    await applyRuntimePromptToUi(live);
    setSuccess('Инструкции сброшены (runtime ultra-short default)');
  });
}

if (resultText) {
  resultText.addEventListener('focus', () => {
    resultText.classList.add('isExpanded');
  });
  resultText.addEventListener('blur', (e) => {
    // Don't shrink when focus moves to Copy / other controls inside the result card.
    const genSection = document.getElementById('generateSection');
    const next = e.relatedTarget;
    if (genSection && next && genSection.contains(next)) return;
    if (resultText.classList.contains('isGenerating')) return;
    resultText.classList.remove('isExpanded');
  });
}

if (coverFromRagBtn) {
  coverFromRagBtn.addEventListener('click', async () => {
    setError('');
    setButtonBusy(coverFromRagBtn, true, 'Взять из базы', 'Ищу…');
    try {
      let items = currentSources;
      if (!items.length) {
        items = (await refreshSources({ quiet: true })) || [];
      }
      const ok = await maybePrefillCoverTemplate(items, { force: true });
      if (!ok) {
        setError(
          'В базе не найдено сопроводительное (название/категория: "сопроводительн", cover letter).'
        );
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(coverFromRagBtn, false, 'Взять из базы');
    }
  });
}

if (migrateCoverTemplateBtn) {
  migrateCoverTemplateBtn.addEventListener('click', async () => {
    setError('');
    try {
      const ok = await ensureCoverTemplateStructured({ force: true });
      setSuccess(ok ? 'Шаблон приведён к структуре [COVER_TEMPLATE] + [CONTACTS]' : 'Шаблон уже в нужном формате');
    } catch (err) {
      setError(String(err.message || err));
    }
  });
}

if (saveCoverTemplateBtn) {
  saveCoverTemplateBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    let text = String(coverTemplateEl?.value || '').trim();
    if (text.length < 20) {
      setError('Шаблон слишком короткий (мин. 20 символов)');
      return;
    }
    if (!isStructuredCoverTemplate(text)) {
      await ensureCoverTemplateStructured({ force: true });
      text = String(coverTemplateEl?.value || '').trim();
    }
    setButtonBusy(saveCoverTemplateBtn, true, 'Сохранить шаблон в базу', 'Сохранение…');
    try {
      await JR_API.ensureWorkspace();
      await chrome.storage.local.set({ jrCoverTemplate: text });
      const res = await JR_API.resumeTextCapture({
        text,
        title: 'Моё сопроводительное (шаблон)',
        kind: 'job_experience',
        category: 'cover_letter',
      });
      const contacts = parseProfileOverrides(text);
      const preview = formatParsedContactsPreview(contacts);
      const summary = preview
        ? `Шаблон в базе (id=${res.knowledgeItemId}). Контакты: ${preview}`
        : `Шаблон сохранён в базу (id=${res.knowledgeItemId})`;
      setSuccess(summary);
      await refreshResumeStatus();
      await refreshSources({
        highlightIds: collectLinkedIds(res),
        quiet: true,
      });
      showIngestBanner({ addedCount: 1, summary });
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(saveCoverTemplateBtn, false, 'Сохранить шаблон в базу');
    }
  });
}

(async function init() {
  try {
    await resolvePanelWindowId();
    await restoreCollapseState();
    bindCollapsePersistence();
    const savedTpl = await chrome.storage.local.get(['jrCoverTemplate', 'jrPromptExtra', 'jrRagEdits']);
    if (ragEditsInput) {
      ragEditsInput.value = String(savedTpl.jrRagEdits || '');
    }
    if (coverTemplateEl) {
      const savedCover = savedTpl.jrCoverTemplate != null ? String(savedTpl.jrCoverTemplate) : '';
      if (!savedCover.trim()) {
        const contacts = parseProfileOverrides(String(savedTpl.jrRagEdits || ''));
        coverTemplateEl.value = buildStructuredCoverTemplate({ contacts });
        await chrome.storage.local.set({ jrCoverTemplate: coverTemplateEl.value });
      } else if (!isStructuredCoverTemplate(savedCover)) {
        const contacts = {
          ...parseProfileOverrides(String(savedTpl.jrRagEdits || '')),
          ...parseProfileOverrides(savedCover),
        };
        coverTemplateEl.value = buildStructuredCoverTemplate({ body: savedCover, contacts });
        await chrome.storage.local.set({ jrCoverTemplate: coverTemplateEl.value });
      } else {
        const nextCover = ensureCanonicalLinksInTemplate(savedCover);
        coverTemplateEl.value = nextCover;
        if (nextCover !== savedCover) {
          await chrome.storage.local.set({ jrCoverTemplate: nextCover });
        }
      }
    }
    // Resolve live runtime prompt (API if available, else bundled DEFAULT)
    let livePrompt = DEFAULT_PROMPT_EXTRA;
    try {
      const data = await JR_API.getDefaultPrompt();
      if (data?.prompt && isJrSystemPromptText(data.prompt)) {
        livePrompt = String(data.prompt);
      }
    } catch {
      /* offline / older API - keep bundled */
    }
    if (promptExtraEl) {
      const savedExtra = savedTpl.jrPromptExtra != null ? String(savedTpl.jrPromptExtra) : '';
      if (shouldMigratePromptExtra(savedExtra, livePrompt)) {
        await applyRuntimePromptToUi(livePrompt);
      } else {
        promptExtraEl.value = savedExtra;
        savedPromptExtra = savedExtra;
        syncPromptSaveButton();
      }
    }
    await refreshDriveStatus();
    await refreshAuthHint();
    await JR_API.ensureWorkspace();
    await refreshResumeStatus();
    await refreshSources({ quiet: true });
  } catch (err) {
    setError(String(err.message || err));
  }
  syncCopyButtonState();
  // New window / fresh panel: hydrate score from URL ASAP, then full extract.
  await hydrateRelevanceFromActiveTabUrl().catch(() => {});
  await refreshVacancyFromTab().catch(() => {});
})();
