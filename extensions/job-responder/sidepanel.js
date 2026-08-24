let currentVacancy = null;
let currentSources = [];

const authHint = document.getElementById('authHint');
const resumeStatus = document.getElementById('resumeStatus');
const vacancyMeta = document.getElementById('vacancyMeta');
const vacancyDescription = document.getElementById('vacancyDescription');
const resultText = document.getElementById('resultText');
const genMeta = document.getElementById('genMeta');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const sourcesListEl = document.getElementById('sourcesList');

function setError(msg) {
  errorEl.textContent = msg || '';
  if (msg) successEl.textContent = '';
}

function setSuccess(msg) {
  successEl.textContent = msg || '';
  if (msg) errorEl.textContent = '';
}

async function refreshAuthHint() {
  const testMode = await JR_API.isTestMode();
  if (testMode) {
    const ws = await JR_API.ensureWorkspace();
    authHint.textContent = `Тестовый режим (без login) · workspace ${ws}`;
    return true;
  }
  const saved = await chrome.storage.local.get(['userAccessToken', 'userEmail']);
  if (saved.userAccessToken) {
    authHint.textContent = `Вход: ${saved.userEmail || 'OK'}`;
    return true;
  }
  authHint.textContent = 'Не авторизован - нажмите "Вход"';
  return false;
}

async function refreshResumeStatus() {
  try {
    const st = await JR_API.resumeStatus();
    resumeStatus.textContent = st.hasPrimaryCv
      ? `Resume RAG: ${st.count} док., CV: OK, обновлено: ${st.lastUpdated || '-'}`
      : `Resume RAG: загрузите основное резюме (сейчас ${st.count} док.)`;
  } catch (err) {
    resumeStatus.textContent = `Resume RAG: ${err.message}`;
  }
}

function renderSources(items) {
  currentSources = Array.isArray(items) ? items : [];
  if (!sourcesListEl) return;
  if (!currentSources.length) {
    sourcesListEl.innerHTML = '<div class="hint">Пока нет sources. Добавьте CV, portfolio files или links.</div>';
    return;
  }
  sourcesListEl.innerHTML = currentSources
    .map((item) => {
      const id = Number(item.knowledgeItemId || 0);
      const checked = item.kind === 'job_resume' ? 'checked disabled' : 'checked';
      const meta = [item.kind || '-', item.category || '-', item.updatedAt || '-'].join(' | ');
      const preview = String(item.preview || '').replace(/[<>]/g, '');
      const title = String(item.title || 'Untitled').replace(/[<>]/g, '');
      return `
        <label class="sourceItem">
          <div class="sourceItemHeader">
            <input type="checkbox" class="sourceCheckbox" value="${id}" ${checked} />
            <div>
              <div class="sourceItemTitle">${title}</div>
              <div class="sourceItemMeta">${meta}</div>
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

async function refreshSources() {
  try {
    const data = await JR_API.listSources();
    renderSources(data.items || []);
  } catch (err) {
    renderSources([]);
    setError(String(err.message || err));
  }
}

function applyVacancy(vacancy) {
  currentVacancy = vacancy;
  const host = vacancy.host || 'web';
  vacancyMeta.textContent = `${vacancy.title || '—'} | ${vacancy.company || '—'} | ${host}`;
  if (vacancy.description) vacancyDescription.value = vacancy.description;
}

async function refreshVacancyFromTab() {
  setError('');
  try {
    const vacancy = await JR_API.fetchVacancyFromTab();
    applyVacancy(vacancy);
    setSuccess('Страница прочитана');
  } catch (err) {
    setError(String(err.message || err));
  }
}

function buildVacancyPayload() {
  const base = currentVacancy || {};
  const description = String(vacancyDescription.value || base.description || '').trim();
  const title = String(base.title || 'Вакансия').trim();
  return {
    url: base.url || '',
    title,
    company: base.company || '',
    description,
    questions: Array.isArray(base.questions) ? base.questions : [],
  };
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
    const data = await JR_API.generateResponse({
      mode,
      host: currentVacancy?.host || 'web',
      vacancy,
      selectedSourceIds: getSelectedSourceIds(),
    });
    resultText.value = data.text || '';
    genMeta.textContent = `model: ${data.model || '-'} | sources: ${(data.sources || []).length}`;
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

const resumeFileInput = document.getElementById('resumeFile');
const portfolioFilesInput = document.getElementById('portfolioFiles');
const linkUrlInput = document.getElementById('linkUrl');
const linkTitleInput = document.getElementById('linkTitle');

const uploadResumeFileBtn = document.getElementById('uploadResumeFileBtn');
const uploadPortfolioFilesBtn = document.getElementById('uploadPortfolioFilesBtn');
const addLinkBtn = document.getElementById('addLinkBtn');

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
      await JR_API.ensureWorkspace();
      await JR_API.resumeFileCapture({
        file,
        kind: 'job_resume',
        category: 'cv',
        title: file.name,
      });
      setSuccess(`CV добавлен: ${file.name}`);
      await refreshResumeStatus();
      await refreshSources();
      resumeFileInput.value = '';
    } catch (err) {
      setError(String(err.message || err));
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
    try {
      await JR_API.ensureWorkspace();
      let i = 0;
      for (const file of files) {
        i += 1;
        uploadPortfolioFilesBtn.textContent = `Загрузка ${i}/${files.length}…`;
        await JR_API.resumeFileCapture({
          file,
          kind: 'job_experience',
          category: 'experience',
          title: file.name,
        });
      }
      setSuccess(`Portfolio: ${files.length} файл(ов) добавлено`);
      await refreshResumeStatus();
      await refreshSources();
      portfolioFilesInput.value = '';
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
      await JR_API.resumeLinkCapture({
        url,
        title: title || undefined,
        kind: 'job_experience',
        category: 'experience',
      });
      setSuccess('Ссылка добавлена в Resume RAG');
      await refreshResumeStatus();
      await refreshSources();
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

refreshVacancyBtn.addEventListener('click', refreshVacancyFromTab);
refreshSourcesBtn.addEventListener('click', refreshSources);
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
  if (changes.userAccessToken || changes.jrTestMode) {
    refreshAuthHint();
    refreshResumeStatus();
    refreshSources();
  }
});

(async function init() {
  try {
    await refreshAuthHint();
    await JR_API.ensureWorkspace();
    await refreshResumeStatus();
    await refreshSources();
  } catch (err) {
    setError(String(err.message || err));
  }
  await refreshVacancyFromTab().catch(() => {});
})();
