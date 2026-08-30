/**
 * Lead Validation — static demo client
 * Talks to local API at http://127.0.0.1:3105
 */

const API_BASE = "http://127.0.0.1:3105";
const VALIDATE_URL = `${API_BASE}/v1/leads/validate`;
const HEALTH_URL = `${API_BASE}/health`;

const SAMPLE = {
  email: "user@company.com",
  phone: "+12025550123",
  name: "Jane Doe",
  company: "Acme",
  source: "landing",
};

const form = document.getElementById("lead-form");
const submitBtn = document.getElementById("submit-btn");
const fillSampleBtn = document.getElementById("fill-sample");
const apiStatus = document.getElementById("api-status");
const apiStatusText = apiStatus.querySelector(".api-status__text");
const apiDownBanner = document.getElementById("api-down-banner");

const resultPanel = document.getElementById("result-panel");
const resultIdle = document.getElementById("result-idle");
const resultBody = document.getElementById("result-body");
const resultError = document.getElementById("result-error");
const resultErrorText = document.getElementById("result-error-text");
const resultStatusLabel = document.getElementById("result-status-label");
const scoreWrap = document.getElementById("score-wrap");
const scoreValue = document.getElementById("score-value");
const checksList = document.getElementById("checks-list");
const rawJson = document.getElementById("raw-json");

let apiUp = false;

function setApiState(state, label) {
  apiStatus.dataset.state = state;
  apiStatusText.textContent = label;
  apiDownBanner.hidden = state !== "down";
  apiUp = state === "up";
}

async function checkHealth() {
  setApiState("checking", "Checking API…");
  try {
    const res = await fetch(HEALTH_URL, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data?.ok) {
      throw new Error("Health returned not ok");
    }
    setApiState("up", "API online · :3105");
  } catch {
    setApiState("down", "API offline · :3105");
  }
}

function fillSample() {
  for (const [key, value] of Object.entries(SAMPLE)) {
    const input = form.elements.namedItem(key);
    if (input && "value" in input) {
      input.value = value;
    }
  }
  form.elements.namedItem("email")?.focus();
}

function emptyToNull(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function buildPayload(formData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    phone: emptyToNull(formData.get("phone")),
    name: emptyToNull(formData.get("name")),
    company: emptyToNull(formData.get("company")),
    source: emptyToNull(formData.get("source")),
  };
}

function showIdle() {
  resultPanel.dataset.state = "idle";
  delete resultPanel.dataset.status;
  resultIdle.hidden = false;
  resultBody.hidden = true;
  resultBody.classList.remove("is-revealed");
  resultError.hidden = true;
}

function showError(message) {
  resultPanel.dataset.state = "error";
  delete resultPanel.dataset.status;
  resultIdle.hidden = true;
  resultBody.hidden = true;
  resultBody.classList.remove("is-revealed");
  resultError.hidden = false;
  resultErrorText.textContent = message;
}

function formatReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return "No issues";
  }
  return reasons.join(" · ");
}

function renderChecks(checks) {
  checksList.replaceChildren();
  if (!checks || typeof checks !== "object") {
    return;
  }

  for (const [name, detail] of Object.entries(checks)) {
    const li = document.createElement("li");
    li.className = "check";
    li.dataset.ok = detail?.valid ? "true" : "false";

    const badge = document.createElement("span");
    badge.className = "check__badge";
    badge.setAttribute("aria-hidden", "true");

    const title = document.createElement("p");
    title.className = "check__name";
    title.textContent = name;

    const meta = document.createElement("p");
    meta.className = "check__meta";

    const parts = [];
    parts.push(detail?.valid ? "pass" : "fail");
    if (detail?.e164) {
      parts.push(`E.164 ${detail.e164}`);
    }
    if (Array.isArray(detail?.missing) && detail.missing.length) {
      parts.push(`missing: ${detail.missing.join(", ")}`);
    }
    const reasons = formatReasons(detail?.reasons);
    if (reasons !== "No issues" || !detail?.valid) {
      parts.push(reasons);
    } else if (detail?.valid) {
      parts.push(reasons);
    }
    meta.textContent = parts.join(" · ");

    li.append(badge, title, meta);
    checksList.append(li);
  }
}

function animateScore(score) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100);
  // Reset then fill so the transition always plays
  resultPanel.style.setProperty("--score-pct", "0");
  scoreValue.textContent = "0";
  scoreWrap.setAttribute("aria-label", `Score ${pct} percent`);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resultPanel.style.setProperty("--score-pct", String(pct));
      scoreValue.textContent = String(pct);
    });
  });
}

function showResult(data) {
  const status = data?.status ?? "unknown";
  resultPanel.dataset.state = "ready";
  resultPanel.dataset.status = status;
  resultIdle.hidden = true;
  resultError.hidden = true;
  resultBody.hidden = false;
  resultBody.classList.remove("is-revealed");

  resultStatusLabel.textContent = status;
  renderChecks(data?.checks);
  rawJson.textContent = JSON.stringify(data, null, 2);

  // Force reflow so reveal + score animations restart
  void resultBody.offsetWidth;
  resultBody.classList.add("is-revealed");
  animateScore(data?.score);
}

async function validateLead(event) {
  event.preventDefault();

  if (!form.reportValidity()) {
    const firstInvalid = form.querySelector(":invalid");
    firstInvalid?.focus();
    return;
  }

  const payload = buildPayload(new FormData(form));
  form.classList.add("is-submitting");
  submitBtn.classList.add("is-busy");
  submitBtn.disabled = true;
  submitBtn.textContent = "Validating…";

  try {
    const res = await fetch(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("API returned a non-JSON response");
    }

    if (!res.ok) {
      const msg =
        data?.message ||
        data?.error ||
        `Request failed with HTTP ${res.status}`;
      showError(msg);
      if (!apiUp) {
        setApiState("down", "API offline · :3105");
      }
      return;
    }

    if (!apiUp) {
      setApiState("up", "API online · :3105");
    }
    showResult(data);
  } catch (err) {
    setApiState("down", "API offline · :3105");
    const isNetwork =
      err?.name === "TypeError" ||
      err?.name === "TimeoutError" ||
      err?.name === "AbortError";
    showError(
      isNetwork
        ? "Cannot reach the API at 127.0.0.1:3105. Start the lead-validation service, then try again."
        : err?.message || "Unexpected error while validating."
    );
  } finally {
    form.classList.remove("is-submitting");
    submitBtn.classList.remove("is-busy");
    submitBtn.disabled = false;
    submitBtn.textContent = "Validate lead";
  }
}

fillSampleBtn.addEventListener("click", fillSample);
form.addEventListener("submit", validateLead);

showIdle();
checkHealth();
setInterval(checkHealth, 20000);
