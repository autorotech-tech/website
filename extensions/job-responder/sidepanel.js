let currentVacancy = null;

const authHint = document.getElementById('authHint');
const resumeStatus = document.getElementById('resumeStatus');
const vacancyMeta = document.getElementById('vacancyMeta');
const vacancyDescription = document.getElementById('vacancyDescription');
const resultText = document.getElementById('resultText');
const genMeta = document.getElementById('genMeta');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');

function setError(msg) {
  errorEl.textContent = msg || '';
}

function setSuccess(msg) {
  successEl.textContent = msg || '';
}

async function refreshAuthHint() {
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

function applyVacancy(vacancy) {
  currentVacancy = vacancy;
  const host = vacancy.host || 'ru';
  vacancyMeta.textContent = `${vacancy.title || '—'} | ${vacancy.company || '—'} | ${host}`;
  if (vacancy.description) vacancyDescription.value = vacancy.description;
}

async function refreshVacancyFromTab() {
  setError('');
  try {
    const vacancy = await JR_API.fetchVacancyFromTab();
    applyVacancy(vacancy);
    setSuccess('Вакансия обновлена со страницы');
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
      host: currentVacancy?.host || 'ru',
      vacancy,
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

const saveResumeBtn = document.getElementById('saveResumeBtn');
const refreshVacancyBtn = document.getElementById('refreshVacancyBtn');
const genCoverBtn = document.getElementById('genCoverBtn');
const genAnswersBtn = document.getElementById('genAnswersBtn');
const copyBtn = document.getElementById('copyBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

saveResumeBtn.addEventListener('click', async () => {
  setError('');
  setSuccess('');
  const title = String(document.getElementById('resumeTitle').value || 'Резюме').trim();
  const text = String(document.getElementById('resumeText').value || '').trim();
  if (text.length < 20) {
    setError('Минимум 20 символов для резюме');
    return;
  }
  saveResumeBtn.disabled = true;
  try {
    await JR_API.resumeCapture({ title, text, kind: 'job_resume', category: 'cv' });
    setSuccess('Резюме сохранено в Resume RAG');
    await refreshResumeStatus();
  } catch (err) {
    setError(String(err.message || err));
  } finally {
    saveResumeBtn.disabled = false;
  }
});

refreshVacancyBtn.addEventListener('click', refreshVacancyFromTab);
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
  if (changes.userAccessToken) {
    refreshAuthHint();
    refreshResumeStatus();
  }
});

(async function init() {
  const loggedIn = await refreshAuthHint();
  if (loggedIn) {
    try {
      await JR_API.ensureWorkspace();
      await refreshResumeStatus();
    } catch (err) {
      setError(String(err.message || err));
    }
  }
  await refreshVacancyFromTab().catch(() => {});
})();
