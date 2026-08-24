let currentVacancy = null;
let currentSources = [];
let lastAddedSourceIds = new Set();
let lastAddedAt = null;
let lastIngestSummary = '';

const authHint = document.getElementById('authHint');
const resumeStatus = document.getElementById('resumeStatus');
const ingestBanner = document.getElementById('ingestBanner');
const vacancyMeta = document.getElementById('vacancyMeta');
const vacancyDescription = document.getElementById('vacancyDescription');
const vacancyStructuredEl = document.getElementById('vacancyStructured');
const relevanceBox = document.getElementById('relevanceBox');
const resultText = document.getElementById('resultText');
const genMeta = document.getElementById('genMeta');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const sourcesListEl = document.getElementById('sourcesList');
const workspaceIdInput = document.getElementById('workspaceIdInput');

function setError(msg) {
  errorEl.textContent = msg || '';
  if (msg) {
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function setSuccess(msg) {
  successEl.textContent = msg || '';
  if (msg) {
    successEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function showIngestBanner({ addedCount = 0, total = currentSources.length, summary = '' } = {}) {
  if (!ingestBanner) return;
  if (summary) lastIngestSummary = summary;
  if (addedCount > 0) lastAddedAt = new Date();
  const when = lastAddedAt ? formatUpdatedAt(lastAddedAt.toISOString()) : '';
  const lines = [];
  if (lastIngestSummary) lines.push(lastIngestSummary);
  lines.push(`В RAG сейчас: ${total} источник(ов)`);
  if (when) lines.push(`Последнее добавление: ${when}`);
  ingestBanner.hidden = false;
  ingestBanner.textContent = lines.join(' · ');
}

function setButtonBusy(btn, busy, idleLabel, busyLabel) {
  if (!btn) return;
  btn.disabled = Boolean(busy);
  if (busy) {
    if (idleLabel) btn.dataset.idleLabel = idleLabel;
    else if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
    btn.innerHTML = `<span class="btnSpinner" aria-hidden="true"></span>${busyLabel || 'Загрузка…'}`;
  } else {
    btn.textContent = idleLabel || btn.dataset.idleLabel || btn.textContent;
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const body = coverLetterBody(picked);
  if (!body || body.length < 40) return false;
  coverTemplateEl.value = body;
  await chrome.storage.local.set({ jrCoverTemplate: body });
  setSuccess(`Шаблон сопроводительного взят из RAG: ${sourceTitleRaw(picked)}`);
  return true;
}

function renderSources(items) {
  currentSources = Array.isArray(items) ? items : [];
  if (!sourcesListEl) return;
  if (!currentSources.length) {
    sourcesListEl.innerHTML =
      '<div class="hint">Список пуст. Проверьте workspaceId (test = 1), затем «Обновить sources».</div>';
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

async function refreshResumeStatus() {
  try {
    const st = await JR_API.resumeStatus();
    const ws = st.workspaceId || (await JR_API.getWorkspaceId());
    const lastAdd = lastAddedAt ? `, добавлено: ${formatUpdatedAt(lastAddedAt.toISOString())}` : '';
    resumeStatus.textContent = st.hasPrimaryCv
      ? `Resume RAG ws=${ws}: ${st.count} док., CV: OK, обновлено: ${st.lastUpdated || '-'}${lastAdd}`
      : `Resume RAG ws=${ws}: загрузите основное резюме (сейчас ${st.count} док.)${lastAdd}`;
  } catch (err) {
    resumeStatus.textContent = `Resume RAG: ${err.message}`;
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
    setButtonBusy(refreshBtn, true, 'Обновить sources', 'Обновляю…');
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
    if (ids.length) {
      sourcesListEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return items;
  } catch (err) {
    renderSources([]);
    setError(`Ошибка списка sources: ${String(err.message || err)}`);
    throw err;
  } finally {
    sourcesListEl?.classList.remove('isLoading');
    if (!quiet) setButtonBusy(refreshBtn, false, 'Обновить sources');
  }
}

function renderStructured(structured) {
  if (!vacancyStructuredEl) return;
  if (!structured || typeof structured !== 'object') {
    vacancyStructuredEl.hidden = true;
    vacancyStructuredEl.innerHTML = '';
    return;
  }
  const rows = [
    ['Зарплата / доход', structured.salary],
    ['Опыт', structured.experience],
    ['Занятость', structured.employmentType],
    ['График', structured.schedule],
    ['Часы', structured.workingHours],
    ['Формат', structured.workFormat],
    ['Локация', structured.location],
    ['Seniority', structured.seniority],
    ['Навыки', Array.isArray(structured.keySkills) ? structured.keySkills.join(', ') : ''],
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
    return;
  }
  const bullets = (data.rationale || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const matched = (data.matched || []).map((r) => `<li class="relevanceMatched">${escapeHtml(r)}</li>`).join('');
  const missing = (data.missing || []).map((r) => `<li class="relevanceMissing">${escapeHtml(r)}</li>`).join('');
  relevanceBox.hidden = false;
  relevanceBox.innerHTML = `
    <div class="relevanceScore">${Number(data.score)} / 100</div>
    <div>Релевантность Resume ↔ вакансия</div>
    ${bullets ? `<ul>${bullets}</ul>` : ''}
    ${matched ? `<div><b>Совпало</b><ul>${matched}</ul></div>` : ''}
    ${missing ? `<div><b>Не хватает в RAG</b><ul>${missing}</ul></div>` : ''}
  `;
}

function applyVacancy(vacancy) {
  currentVacancy = vacancy;
  const host = vacancy.host || 'web';
  const site = vacancy.siteHost ? ` · ${vacancy.siteHost}` : '';
  const kind =
    vacancy.source === 'google_form' || vacancy.pageKind === 'google_form'
      ? ' · Google Form'
      : vacancy.source === 'table_qa'
        ? ' · таблица Q&A'
        : '';
  vacancyMeta.textContent = `${vacancy.title || '-'} | ${vacancy.company || '-'} | ${host}${site}${kind}`;
  if (vacancy.description) vacancyDescription.value = vacancy.description;
  renderStructured(vacancy.structured);
  renderRelevance(null);
  const qs = normalizeQuestionList(vacancy.questions);
  renderQaTable(qs.map((q) => ({ question: q.text, answer: '' })));
}

async function refreshVacancyFromTab() {
  setError('');
  try {
    const vacancy = await JR_API.fetchVacancyFromTab();
    applyVacancy(vacancy);
    const qn = normalizeQuestionList(vacancy.questions).length;
    setSuccess(
      vacancy.source === 'google_form'
        ? `Google Form прочитана (${qn} вопросов)`
        : qn
          ? `Страница прочитана (${qn} вопросов)`
          : 'Страница прочитана'
    );
    await runRelevanceScore().catch(() => {});
  } catch (err) {
    setError(String(err.message || err));
  }
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
        await navigator.clipboard.writeText(text);
        setSuccess('Ответ скопирован');
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
    relevanceBox.innerHTML = '<div>Считаю релевантность…</div>';
  }
  const data = await JR_API.scoreRelevance({
    vacancy,
    selectedSourceIds: getSelectedSourceIds(),
  });
  renderRelevance(data);
  return data;
}

async function runGenerate(mode) {
  setError('');
  setSuccess('');
  const vacancy = buildVacancyPayload();
  const isQa = mode === 'question_answers' || mode === 'qa';
  if (!vacancy.description || vacancy.description.length < 20) {
    setError('Нужно описание вакансии (обновите со страницы или вставьте вручную)');
    return;
  }
  if (isQa && (!vacancy.questions || !vacancy.questions.length)) {
    setError('На странице нет вопросов. Откройте Google Form / таблицу или HH с вопросами, затем «Обновить с страницы».');
    return;
  }
  const btn = isQa ? genAnswersBtn : genCoverBtn;
  const idle = isQa ? 'Ответы на вопросы' : 'Отклик';
  setButtonBusy(btn, true, idle, 'Генерация…');
  genMeta.textContent = 'Генерация…';
  try {
    await runRelevanceScore().catch(() => {});
    const coverTemplate = String(coverTemplateEl?.value || '').trim();
    if (coverTemplateEl) {
      await chrome.storage.local.set({ jrCoverTemplate: coverTemplate });
    }
    const data = await JR_API.generateResponse({
      mode: isQa ? 'qa' : 'cover_letter',
      host: currentVacancy?.host || 'web',
      vacancy,
      selectedSourceIds: getSelectedSourceIds(),
      coverTemplate: !isQa ? coverTemplate : undefined,
    });
    const letter = String(data.text || '').trim();
    resultText.value = letter;
    if (Array.isArray(data.answers) && data.answers.length) {
      renderQaTable(
        data.answers.map((a) => ({
          question: a.question || a.text || '',
          answer: a.answer || '',
        }))
      );
    } else if (isQa && vacancy.questions.length) {
      // Fallback: keep questions visible even if JSON parse failed
      renderQaTable(vacancy.questions.map((q) => ({ question: q.text, answer: letter || '' })));
    }
    if (data.relevance) renderRelevance(data.relevance);
    const tplNote = data.usedCoverTemplate ? ' | template: yes' : '';
    const profileNote =
      data.compactProfileChars != null
        ? ` | profile: ${data.compactProfileChars}c / ${data.sourcesMerged ?? (data.sources || []).length} src`
        : '';
    const compressNote = data.profileCompressed ? ' | compressed' : '';
    const elapsedNote = data.elapsedSec != null ? ` | ${data.elapsedSec}s` : '';
    const provNote = data.provider ? ` | ${data.provider}` : '';
    genMeta.textContent = `model: ${data.model || '-'}${provNote} | sources: ${(data.sources || []).length} | score: ${
      data.relevance?.score ?? '-'
    }${tplNote}${profileNote}${compressNote}${elapsedNote}`;
    if (data.limitMessage) {
      genMeta.textContent += ` | ${data.limitMessage}`;
    }
    if (data.ok === false && data.message) {
      setError(String(data.message));
      return;
    }
    if (!letter && !(Array.isArray(data.answers) && data.answers.length)) {
      setError(data.message || 'API ответил без текста. Повторите - профиль уже сжатый.');
      return;
    }
    setSuccess(isQa ? 'Ответы готовы - копируйте из таблицы «Вопросы формы»' : 'Готово - проверьте текст и скопируйте');
  } catch (err) {
    genMeta.textContent = '';
    setError(String(err.message || err));
  } finally {
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
const scoreBtn = document.getElementById('scoreBtn');
const saveWorkspaceBtn = document.getElementById('saveWorkspaceBtn');

const resumeFileInput = document.getElementById('resumeFile');
const resumeFileHint = document.getElementById('resumeFileHint');
const portfolioFilesInput = document.getElementById('portfolioFiles');
const portfolioFileHint = document.getElementById('portfolioFileHint');
const ragTextInput = document.getElementById('ragTextInput');
const ragTextTitle = document.getElementById('ragTextTitle');
const coverTemplateEl = document.getElementById('coverTemplate');
const coverFromRagBtn = document.getElementById('coverFromRagBtn');
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
    const id = await JR_API.setWorkspaceId(workspaceIdInput?.value || JR_API.DEFAULT_TEST_WORKSPACE_ID);
    await refreshAuthHint();
    await refreshResumeStatus();
    await refreshSources();
    setSuccess(`workspaceId = ${id}`);
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
    setButtonBusy(addRagTextBtn, true, 'Добавить в RAG', 'Добавление…');
    try {
      await JR_API.ensureWorkspace();
      const res = await JR_API.resumeTextCapture({
        text,
        title: title || undefined,
        kind: 'job_experience',
        category: 'notes',
      });
      const ids = collectLinkedIds(res);
      const summary = `Текст в RAG (id=${res.knowledgeItemId})${formatLinkedNote(res)}`;
      setSuccess(summary);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: ids, quiet: true });
      showIngestBanner({ addedCount: ids.length || 1, summary });
      if (ragTextInput) ragTextInput.value = '';
      if (ragTextTitle) ragTextTitle.value = '';
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(addRagTextBtn, false, 'Добавить в RAG');
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
    driveConnectBtn.disabled = true;
    driveConnectBtn.textContent = 'Подключение…';
    try {
      await JR_DRIVE_AUTH.connectInteractive();
      await refreshDriveStatus();
      setSuccess('Google Drive подключён');
    } catch (err) {
      setError(String(err.message || err));
      await refreshDriveStatus();
    } finally {
      driveConnectBtn.disabled = false;
      driveConnectBtn.textContent = 'Подключить Google Drive';
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
    driveImportBtn.disabled = true;
    driveImportBtn.textContent = 'Импорт…';
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
      driveImportBtn.disabled = false;
      driveImportBtn.textContent = 'Импорт из Drive';
    }
  });
}

refreshVacancyBtn.addEventListener('click', refreshVacancyFromTab);
refreshSourcesBtn.addEventListener('click', () => {
  setError('');
  refreshSources({ quiet: false }).catch(() => {});
});
if (sourcesListEl) {
  sourcesListEl.addEventListener('click', async (ev) => {
    const btn = ev.target?.closest?.('.sourceDeleteBtn');
    if (!btn) return;
    ev.preventDefault();
    const id = Number(btn.getAttribute('data-id') || 0);
    const title = String(btn.getAttribute('data-title') || 'источник');
    if (!id) return;
    if (!window.confirm(`Удалить «${title}» из Resume RAG?`)) return;
    setError('');
    setSuccess('');
    btn.disabled = true;
    try {
      await JR_API.deleteSources({ knowledgeItemIds: [id] });
      lastAddedSourceIds.delete(id);
      await refreshResumeStatus();
      await refreshSources({ quiet: true });
      setSuccess(`Удалено: ${title}`);
    } catch (err) {
      setError(String(err.message || err));
      btn.disabled = false;
    }
  });
}
if (scoreBtn) {
  scoreBtn.addEventListener('click', async () => {
    setError('');
    setButtonBusy(scoreBtn, true, 'Оценка релевантности', 'Считаю…');
    try {
      const data = await runRelevanceScore();
      if (data && data.score != null) {
        setSuccess(`Релевантность: ${data.score} / 100`);
      } else if (!data) {
        return;
      } else {
        setError('Оценка не вернула score. Проверьте API / redeploy.');
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(scoreBtn, false, 'Оценка релевантности');
    }
  });
}
genCoverBtn.addEventListener('click', () => runGenerate('cover_letter'));
genAnswersBtn.addEventListener('click', () => runGenerate('question_answers'));
copyBtn.addEventListener('click', async () => {
  const text = String(resultText.value || '').trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setSuccess('Скопировано в буфер');
});

if (copyAllQaBtn) {
  copyAllQaBtn.addEventListener('click', async () => {
    const rows = Array.isArray(window.__jrQaRows) ? window.__jrQaRows : [];
    const text = rows
      .map((r) => {
        const q = String(r.question || '').trim();
        const a = String(r.answer || '').trim();
        if (!q && !a) return '';
        return `Вопрос: ${q}\nОтвет: ${a || '—'}`;
      })
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text || String(resultText.value || '').trim());
      setSuccess('Все ответы скопированы');
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

if (coverFromRagBtn) {
  coverFromRagBtn.addEventListener('click', async () => {
    setError('');
    setButtonBusy(coverFromRagBtn, true, 'Взять из RAG', 'Ищу…');
    try {
      let items = currentSources;
      if (!items.length) {
        items = (await refreshSources({ quiet: true })) || [];
      }
      const ok = await maybePrefillCoverTemplate(items, { force: true });
      if (!ok) {
        setError(
          'В Resume RAG не найдено сопроводительное (ищите в названии/категории: "сопроводительн", cover letter).'
        );
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setButtonBusy(coverFromRagBtn, false, 'Взять из RAG');
    }
  });
}

(async function init() {
  try {
    const savedTpl = await chrome.storage.local.get(['jrCoverTemplate']);
    if (coverTemplateEl && savedTpl.jrCoverTemplate) {
      coverTemplateEl.value = String(savedTpl.jrCoverTemplate);
    }
    await refreshDriveStatus();
    await refreshAuthHint();
    await JR_API.ensureWorkspace();
    await refreshResumeStatus();
    await refreshSources({ quiet: true });
  } catch (err) {
    setError(String(err.message || err));
  }
  await refreshVacancyFromTab().catch(() => {});
})();
