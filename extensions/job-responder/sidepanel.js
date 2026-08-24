let currentVacancy = null;
let currentSources = [];
let lastAddedSourceIds = new Set();

const authHint = document.getElementById('authHint');
const resumeStatus = document.getElementById('resumeStatus');
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
  if (msg) successEl.textContent = '';
}

function setSuccess(msg) {
  successEl.textContent = msg || '';
  if (msg) errorEl.textContent = '';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatUpdatedAt(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('ru-RU', { hour12: false });
  } catch {
    return String(iso);
  }
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
    resumeStatus.textContent = st.hasPrimaryCv
      ? `Resume RAG ws=${ws}: ${st.count} док., CV: OK, обновлено: ${st.lastUpdated || '-'}`
      : `Resume RAG ws=${ws}: загрузите основное резюме (сейчас ${st.count} док.)`;
  } catch (err) {
    resumeStatus.textContent = `Resume RAG: ${err.message}`;
  }
}

function renderSources(items) {
  currentSources = Array.isArray(items) ? items : [];
  if (!sourcesListEl) return;
  if (!currentSources.length) {
    sourcesListEl.innerHTML =
      '<div class="hint">Список пуст для текущего workspaceId. Проверьте поле выше (test default = 1), затем «Обновить sources». После загрузки CV элемент появится здесь.</div>';
    return;
  }
  sourcesListEl.innerHTML = currentSources
    .map((item) => {
      const id = Number(item.knowledgeItemId || 0);
      const checked = item.kind === 'job_resume' ? 'checked disabled' : 'checked';
      const isNew = lastAddedSourceIds.has(id) ? ' isNew' : '';
      const meta = [item.kind || '-', item.category || '-', formatUpdatedAt(item.updatedAt)].join(' | ');
      const preview = escapeHtml(item.preview || '');
      const title = escapeHtml(item.title || 'Untitled');
      return `
        <label class="sourceItem${isNew}">
          <div class="sourceItemHeader">
            <input type="checkbox" class="sourceCheckbox" value="${id}" ${checked} />
            <div>
              <div class="sourceItemTitle">${title}</div>
              <div class="sourceItemMeta">${escapeHtml(meta)}</div>
              ${preview ? `<div class="sourceItemPreview">${preview}</div>` : ''}
            </div>
          </div>
        </label>
      `;
    })
    .join('');
}

function getSelectedSourceIds() {
  return Array.from(document.querySelectorAll('.sourceCheckbox:checked'))
    .map((el) => Number(el.value))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function refreshSources({ highlightIds = [] } = {}) {
  try {
    if (highlightIds.length) {
      highlightIds.forEach((id) => lastAddedSourceIds.add(Number(id)));
    }
    const data = await JR_API.listSources();
    const items = data.items || [];
    renderSources(items);
    if (!items.length) {
      setError(
        `Sources пусты для workspaceId=${data.workspaceId || (await JR_API.getWorkspaceId())}. ` +
          `В test mode по умолчанию используется ${JR_API.DEFAULT_TEST_WORKSPACE_ID}. ` +
          `Если загружали в другой workspace - смените ID выше и нажмите «Сохранить».`
      );
    } else if (highlightIds.length) {
      sourcesListEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return items;
  } catch (err) {
    renderSources([]);
    setError(`Ошибка списка sources: ${String(err.message || err)}`);
    throw err;
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
  relevanceBox.hidden = false;
  relevanceBox.innerHTML = `
    <div class="relevanceScore">${Number(data.score)} / 100</div>
    <div>Релевантность Resume ↔ вакансия</div>
    <ul>${bullets}</ul>
  `;
}

function applyVacancy(vacancy) {
  currentVacancy = vacancy;
  const host = vacancy.host || 'web';
  const site = vacancy.siteHost ? ` · ${vacancy.siteHost}` : '';
  vacancyMeta.textContent = `${vacancy.title || '-'} | ${vacancy.company || '-'} | ${host}${site}`;
  if (vacancy.description) vacancyDescription.value = vacancy.description;
  renderStructured(vacancy.structured);
  renderRelevance(null);
}

async function refreshVacancyFromTab() {
  setError('');
  try {
    const vacancy = await JR_API.fetchVacancyFromTab();
    applyVacancy(vacancy);
    setSuccess('Страница прочитана');
    await runRelevanceScore().catch(() => {});
  } catch (err) {
    setError(String(err.message || err));
  }
}

function buildVacancyPayload() {
  const base = currentVacancy || {};
  const description = String(vacancyDescription.value || base.description || '').trim();
  const title = String(base.title || 'Вакансия').trim();
  const structured = base.structured && typeof base.structured === 'object' ? base.structured : undefined;
  return {
    url: base.url || '',
    title,
    company: base.company || '',
    description,
    questions: Array.isArray(base.questions) ? base.questions : [],
    structured: structured || undefined,
  };
}

async function runRelevanceScore() {
  const vacancy = buildVacancyPayload();
  if (!vacancy.description || vacancy.description.length < 20) {
    setError('Нужно описание вакансии для оценки релевантности');
    return;
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
  if (!vacancy.description || vacancy.description.length < 20) {
    setError('Нужно описание вакансии (обновите со страницы или вставьте вручную)');
    return;
  }
  const btn = mode === 'question_answers' ? genAnswersBtn : genCoverBtn;
  btn.disabled = true;
  try {
    await runRelevanceScore().catch(() => {});
    const data = await JR_API.generateResponse({
      mode,
      host: currentVacancy?.host || 'web',
      vacancy,
      selectedSourceIds: getSelectedSourceIds(),
    });
    resultText.value = data.text || '';
    if (data.relevance) renderRelevance(data.relevance);
    genMeta.textContent = `model: ${data.model || '-'} | sources: ${(data.sources || []).length} | score: ${
      data.relevance?.score ?? '-'
    }`;
    setSuccess('Готово - проверьте текст и скопируйте');
  } catch (err) {
    setError(String(err.message || err));
  } finally {
    btn.disabled = false;
  }
}

const refreshVacancyBtn = document.getElementById('refreshVacancyBtn');
const genCoverBtn = document.getElementById('genCoverBtn');
const genAnswersBtn = document.getElementById('genAnswersBtn');
const copyBtn = document.getElementById('copyBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshSourcesBtn = document.getElementById('refreshSourcesBtn');
const scoreBtn = document.getElementById('scoreBtn');
const saveWorkspaceBtn = document.getElementById('saveWorkspaceBtn');

const resumeFileInput = document.getElementById('resumeFile');
const portfolioFilesInput = document.getElementById('portfolioFiles');
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
const addLinkBtn = document.getElementById('addLinkBtn');
const driveImportBtn = document.getElementById('driveImportBtn');

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

if (uploadResumeFileBtn) {
  uploadResumeFileBtn.addEventListener('click', async () => {
    setError('');
    setSuccess('');
    const file = resumeFileInput?.files?.[0];
    if (!file) {
      setError('Сначала выберите CV файл');
      resumeFileInput?.click();
      return;
    }
    uploadResumeFileBtn.disabled = true;
    uploadResumeFileBtn.textContent = 'Загрузка…';
    try {
      const ws = await JR_API.ensureWorkspace();
      const res = await JR_API.resumeFileCapture({
        file,
        kind: 'job_resume',
        category: 'cv',
        title: file.name,
      });
      const kid = res.knowledgeItemId;
      setSuccess(`CV добавлен: ${file.name} (id=${kid}, ws=${res.workspaceId || ws})`);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: kid ? [kid] : [] });
      resumeFileInput.value = '';
    } catch (err) {
      setError(String(err.message || err));
      await refreshSources().catch(() => {});
    } finally {
      uploadResumeFileBtn.disabled = false;
      uploadResumeFileBtn.textContent = 'Добавить CV';
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
    uploadPortfolioFilesBtn.disabled = true;
    uploadPortfolioFilesBtn.textContent = `Загрузка 0/${files.length}…`;
    const added = [];
    const errors = [];
    try {
      await JR_API.ensureWorkspace();
      let i = 0;
      for (const file of files) {
        i += 1;
        uploadPortfolioFilesBtn.textContent = `Загрузка ${i}/${files.length}…`;
        try {
          const res = await JR_API.resumeFileCapture({
            file,
            kind: 'job_experience',
            category: 'experience',
            title: file.name,
          });
          if (res.knowledgeItemId) added.push(res.knowledgeItemId);
        } catch (err) {
          errors.push(`${file.name}: ${err.message || err}`);
        }
      }
      await refreshResumeStatus();
      await refreshSources({ highlightIds: added });
      portfolioFilesInput.value = '';
      if (errors.length) {
        setError(`Часть файлов не загрузилась:\n${errors.join('\n')}`);
      }
      if (added.length) {
        setSuccess(`Portfolio: ${added.length} файл(ов) добавлено`);
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      uploadPortfolioFilesBtn.disabled = false;
      uploadPortfolioFilesBtn.textContent = 'Добавить portfolio';
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
    addLinkBtn.disabled = true;
    addLinkBtn.textContent = 'Загрузка…';
    try {
      await JR_API.ensureWorkspace();
      const res = await JR_API.resumeLinkCapture({
        url,
        title: title || undefined,
        kind: 'job_experience',
        category: 'experience',
      });
      setSuccess(`Ссылка добавлена (id=${res.knowledgeItemId})`);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: res.knowledgeItemId ? [res.knowledgeItemId] : [] });
      linkUrlInput.value = '';
      linkTitleInput.value = '';
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      addLinkBtn.disabled = false;
      addLinkBtn.textContent = 'Добавить ссылку';
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

      const ids = (res.imported || []).map((x) => x.knowledgeItemId).filter(Boolean);
      await refreshResumeStatus();
      await refreshSources({ highlightIds: ids });
      await refreshDriveStatus();
      const errN = (res.errors || []).length;
      const via = source === 'identity' ? 'oauth' : 'manual token';
      const summary =
        `Drive: импортировано ${res.importedCount || 0}` +
        (errN ? `, ошибок ${errN}` : '') +
        ` (${via})`;
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
refreshSourcesBtn.addEventListener('click', () => refreshSources().catch(() => {}));
if (scoreBtn) {
  scoreBtn.addEventListener('click', async () => {
    setError('');
    try {
      const data = await runRelevanceScore();
      setSuccess(`Релевантность: ${data?.score ?? '-'} / 100`);
    } catch (err) {
      setError(String(err.message || err));
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
    refreshSources().catch(() => {});
  }
});

(async function init() {
  try {
    await refreshDriveStatus();
    await refreshAuthHint();
    await JR_API.ensureWorkspace();
    await refreshResumeStatus();
    await refreshSources();
  } catch (err) {
    setError(String(err.message || err));
  }
  await refreshVacancyFromTab().catch(() => {});
})();
