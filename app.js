const DATA_URL = "data/grades.enc.json?v=20260918-1";
const DEFAULT_AAD = "xinghua-chemistry-grades-v1";
const SESSION_KEY = "xinghua-chemistry-session-v1";
const SESSION_TTL_MS = 60 * 60 * 1000;
const REVIEW_MODE = new URLSearchParams(window.location.search).get("view") === "review";

const el = {
  title: document.querySelector("#page-title"),
  subtitle: document.querySelector("#page-subtitle"),
  gate: document.querySelector("#access-gate"),
  gateForm: document.querySelector("#gate-form"),
  passwordInput: document.querySelector("#password-input"),
  gateStatus: document.querySelector("#gate-status"),
  protectedContent: document.querySelector("#protected-content"),
  classPicker: document.querySelector("#class-picker"),
  classForm: document.querySelector("#class-form"),
  classInput: document.querySelector("#class-input"),
  classStatus: document.querySelector("#class-status"),
  studentPicker: document.querySelector("#student-picker"),
  studentForm: document.querySelector("#student-form"),
  studentClassInput: document.querySelector("#student-class-input"),
  studentSeatInput: document.querySelector("#student-seat-input"),
  studentStatus: document.querySelector("#student-status"),
  studentPanel: document.querySelector("#student-panel"),
  studentTitle: document.querySelector("#student-title"),
  studentSummary: document.querySelector("#student-summary"),
  studentBody: document.querySelector("#student-body"),
  status: document.querySelector("#data-status"),
  panel: document.querySelector("#class-panel"),
  classTitle: document.querySelector("#class-title"),
  classSummary: document.querySelector("#class-summary"),
  episodeViewRecent: document.querySelector("#episode-view-recent"),
  episodeViewAll: document.querySelector("#episode-view-all"),
  tableCaption: document.querySelector("#table-caption"),
  scoreHead: document.querySelector("#score-head"),
  scoreBody: document.querySelector("#score-body"),
  issuePanel: document.querySelector("#issue-panel"),
  issueSummary: document.querySelector("#issue-summary"),
  issueBody: document.querySelector("#issue-body"),
  reviewPanel: document.querySelector("#review-panel"),
  reviewSummary: document.querySelector("#review-summary"),
  reviewBody: document.querySelector("#review-body"),
  updatedAt: document.querySelector("#updated-at")
};

let data;
let currentClassName = null;
let episodeView = "recent";
let activating = false;

const RECENT_EPISODE_COUNT = 6;

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptEnvelope(url, password, defaultAad) {
  el.gateStatus.textContent = "讀取加密資料…";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const envelope = await response.json();
  el.gateStatus.textContent = "建立解密金鑰…";
  if (envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA-256" || envelope.cipher !== "AES-256-GCM") {
    throw new Error("Unsupported encrypted data format");
  }

  const textEncoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: decodeBase64(envelope.salt),
      iterations: envelope.iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  el.gateStatus.textContent = "解密成績資料…";

  const ciphertext = decodeBase64(envelope.ciphertext);
  const tag = decodeBase64(envelope.tag);
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext);
  encrypted.set(tag, ciphertext.length);
  const plainBytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(envelope.iv),
      additionalData: textEncoder.encode(envelope.aad || defaultAad),
      tagLength: 128
    },
    key,
    encrypted
  );
  el.gateStatus.textContent = "解密完成，整理資料…";
  return JSON.parse(new TextDecoder().decode(plainBytes));
}

async function decryptPayload(password) {
  const payload = await decryptEnvelope(DATA_URL, password, DEFAULT_AAD);
  if (!Array.isArray(payload.classes) || !Array.isArray(payload.episodes) || !Array.isArray(payload.students)) {
    throw new Error("Invalid grade payload");
  }
  return payload;
}

function readSessionPassword() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (saved && typeof saved.password === "string" && saved.password && Number(saved.expiresAt) > Date.now()) return saved.password;
    clearSessionPassword();
  } catch {
    clearSessionPassword();
  }
  return null;
}

function saveSessionPassword(password) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ password, expiresAt: Date.now() + SESSION_TTL_MS }));
  } catch {
    // Private browsing can deny sessionStorage; manual login still works for this page load.
  }
}

function clearSessionPassword() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}


function getCounts(className, episodeId) {
  const counts = { published: 0, pending: 0, missing: 0 };
  for (const student of data.students) {
    if (student.class !== className) continue;
    const status = getEntryStatus(student.scores?.[episodeId]);
    if (status === "published") counts.published += 1;
    else if (status === "pending_review") counts.pending += 1;
    else counts.missing += 1;
  }
  return counts;
}

function hasAnySubmission(entry) {
  if (!entry) return false;
  if (Number(entry.attempt_count) > 0) return true;
  if (Array.isArray(entry.attempts) && entry.attempts.length > 0) return true;
  if (parseScore(entry.value) !== null) return true;
  return entry.status && entry.status !== "no_response";
}

function getAvailableEpisodes() {
  return data.episodes.filter((episode) => data.students.some((student) => hasAnySubmission(student.scores?.[episode.id])));
}

function getVisibleEpisodes() {
  if (episodeView === "all") return data.episodes;
  const availableEpisodes = getAvailableEpisodes();
  return availableEpisodes.slice(-Math.min(RECENT_EPISODE_COUNT, availableEpisodes.length));
}

function formatEpisodeRange(episodes) {
  if (!episodes.length) return "目前沒有 EP";
  if (episodes.length === 1) return episodes[0].label;
  return `${episodes[0].label}–${episodes.at(-1).label}`;
}

function renderClassSummary(className, episodes) {
  el.classSummary.replaceChildren();
  for (const episode of episodes) {
    const counts = getCounts(className, episode.id);
    const item = document.createElement("span");
    item.className = "class-summary__item";
    appendText(item, "strong", episode.label);
    const details = [`${counts.published} 筆已確認`];
    if (counts.pending) details.push(`${counts.pending} 筆待確認`);
    if (counts.missing) details.push(`${counts.missing} 人尚無回覆`);
    appendText(item, "span", details.join("、"));
    el.classSummary.append(item);
  }
}

function updateEpisodeViewControls() {
  const availableEpisodes = getAvailableEpisodes();
  const recentEpisodes = availableEpisodes.slice(-Math.min(RECENT_EPISODE_COUNT, availableEpisodes.length));
  el.episodeViewRecent.textContent = recentEpisodes.length ? `最新 ${recentEpisodes.length} 次（${formatEpisodeRange(recentEpisodes)}）` : "最新 6 次（尚無已導入成績）";
  el.episodeViewAll.textContent = `查看全部（${formatEpisodeRange(data.episodes)}）`;
  el.episodeViewRecent.setAttribute("aria-pressed", String(episodeView === "recent"));
  el.episodeViewAll.setAttribute("aria-pressed", String(episodeView === "all"));
}

function renderClassView() {
  if (!currentClassName) return;
  const episodes = getVisibleEpisodes();
  el.classTitle.textContent = `${currentClassName} 班`;
  renderClassSummary(currentClassName, episodes);
  el.tableCaption.textContent = `${currentClassName} 班｜${formatEpisodeRange(episodes)} 成績`;
  renderScoreHead(episodes);
  renderRows(currentClassName, episodes);
}

function renderHeader() {
  el.title.textContent = REVIEW_MODE ? "回覆核對紀錄" : data.title;
  el.subtitle.textContent = REVIEW_MODE ? "查看需要核對的表單回覆。" : "輸入班級號碼，查看本班各 EP 成績。";
  const availableEpisodes = getAvailableEpisodes();
  el.status.textContent = REVIEW_MODE ? `${data.review_submissions?.length ?? 0} 筆回覆需要核對` : `${availableEpisodes.length} 個 EP 已有成績 · 請輸入班級號碼查看成績`;
  el.updatedAt.textContent = `更新日期：${data.updated_at}`;
}

const reviewCategoryLabels = {
  class_or_seat_mismatch: "班級或座號與名單不同",
  name_mismatch: "姓名無法對上名單",
  invalid_response: "回覆資料不完整",
  duplicate_submission: "同一 EP 重複送出"
};

function formatReviewReason(item) {
  const categories = item.categories ?? [item.category];
  return categories.map((category) => reviewCategoryLabels[category] ?? category).join("、");
}

function formatReviewMatch(item) {
  if (!item.matched_name) return "姓名無法對上目前名單";
  return `名單：${item.roster_class} 班 ${item.roster_seat} 號 ${item.matched_name}`;
}

function renderReview() {
  const submissions = Array.isArray(data.review_submissions) ? data.review_submissions : [];
  const formLabels = new Map((data.forms ?? []).map((form) => [form.form_key, form.label ?? form.form_key]));
  el.reviewPanel.hidden = false;
  el.reviewSummary.textContent = submissions.length ? `${submissions.length} 筆需要核對` : "目前沒有需要核對的回覆";
  el.reviewBody.replaceChildren();
  if (!submissions.length) {
    const row = document.createElement("tr");
    const cell = appendText(row, "td", "目前沒有需要核對的回覆", "empty-state");
    cell.colSpan = 8;
    el.reviewBody.append(row);
    return;
  }
  for (const submission of submissions) {
    const row = document.createElement("tr");
    appendText(row, "td", `${submission.episode} · ${formLabels.get(submission.form_key) ?? submission.form_key}`);
    appendText(row, "td", formatSubmittedAt(submission.submitted_at));
    appendText(row, "td", submission.input_class ?? "—");
    appendText(row, "td", submission.input_seat ?? "—");
    appendText(row, "td", submission.input_name ?? "—", "student-name");
    appendText(row, "td", submission.score === null || submission.score === undefined ? "—" : `${submission.score}/${submission.score_max ?? 100}`);
    appendText(row, "td", formatReviewMatch(submission));
    appendText(row, "td", formatReviewReason(submission));
    el.reviewBody.append(row);
  }
}

function renderScoreHead(episodes) {
  const row = document.createElement("tr");
  appendText(row, "th", "座號");
  appendText(row, "th", "姓名");
  for (const episode of episodes) appendText(row, "th", `${episode.label}（最高分／送出時間）`);
  el.scoreHead.replaceChildren(row);
}

function parseScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function getAttemptTime(attempt) {
  return attempt?.submitted_at ?? attempt?.submittedAt ?? attempt?.time ?? null;
}

function formatSubmittedAt(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(上午|下午)(?:\s+GMT[+-]\d+)?$/u);
  if (!match) return text.replace(/\s+GMT[+-]\d+$/u, "");
  let hour = Number(match[4]);
  if (match[7] === "下午" && hour < 12) hour += 12;
  if (match[7] === "上午" && hour === 12) hour = 0;
  return `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")} ${String(hour).padStart(2, "0")}:${match[5]}:${match[6]}`;
}

function parseAttemptTimestamp(value) {
  const match = String(value ?? "").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(上午|下午)/u);
  if (!match) return null;
  let hour = Number(match[4]);
  if (match[7] === "下午" && hour < 12) hour += 12;
  if (match[7] === "上午" && hour === 12) hour = 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, Number(match[5]), Number(match[6]));
}

function getPublishedResult(entry) {
  const attempts = Array.isArray(entry?.attempts) ? entry.attempts : [];
  let selected = null;
  for (const attempt of attempts) {
    const score = parseScore(attempt?.score ?? attempt?.value);
    const submittedAt = getAttemptTime(attempt);
    const submittedAtValue = parseAttemptTimestamp(submittedAt);
    if (score === null) continue;
    if (!selected || score > selected.score || (score === selected.score && submittedAtValue !== null && submittedAtValue > selected.submittedAtValue)) {
      selected = { score, submittedAt, submittedAtValue };
    }
  }
  if (selected) return selected;

  const score = parseScore(entry?.value);
  return score === null ? null : { score, submittedAt: getAttemptTime(entry) };
}

function getEntryStatus(entry) {
  return getPublishedResult(entry) ? "published" : entry?.status ?? "no_response";
}

function scoreCell(entry) {
  const cell = document.createElement("td");
  const status = getEntryStatus(entry);
  const className = status === "published" ? "score-pill--published" : status === "pending_review" ? "score-pill--pending" : "score-pill--missing";
  const result = status === "published" ? getPublishedResult(entry) : null;
  const text = status === "published" ? `${result?.score ?? "—"}` : status === "pending_review" ? "待確認" : "—";
  const pill = appendText(cell, "span", text, `score-pill ${className}`);
  if (status === "pending_review") pill.title = "此 EP 有多次回覆，尚待確認正式分數";
  if (status === "no_response") pill.title = "目前沒有回覆資料";
  if (result?.submittedAt) {
    const time = appendText(cell, "time", formatSubmittedAt(result.submittedAt), "score-time");
    time.title = "最高分回覆送出時間";
  }
  return cell;
}

function renderRows(className, episodes) {
  const rows = data.students.filter((student) => student.class === className);
  el.scoreBody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = appendText(row, "td", "目前沒有名單資料", "empty-state");
    cell.colSpan = episodes.length + 2;
    el.scoreBody.append(row);
    return;
  }
  for (const student of rows) {
    const row = document.createElement("tr");
    appendText(row, "td", student.seat);
    appendText(row, "td", student.name, "student-name");
    for (const episode of episodes) row.append(scoreCell(student.scores[episode.id]));
    el.scoreBody.append(row);
  }
}

function normalizeSeatInput(value) {
  const digits = String(value ?? "").normalize("NFKC").replace(/\D/gu, "");
  return digits ? String(Number(digits)) : "";
}

function renderStudentResults(student) {
  el.studentBody.replaceChildren();
  for (const episode of data.episodes) {
    const row = document.createElement("tr");
    appendText(row, "td", episode.label);
    row.append(scoreCell(student.scores?.[episode.id]));
    el.studentBody.append(row);
  }
}

function lookupStudent(event) {
  event.preventDefault();
  const className = normalizeClassInput(el.studentClassInput.value);
  const seat = normalizeSeatInput(el.studentSeatInput.value);
  el.studentClassInput.value = className;
  if (!/^\d{3}$/u.test(className)) {
    el.studentPanel.hidden = true;
    el.studentStatus.textContent = "請輸入三位數班級號碼。";
    return;
  }
  if (!data.classes.includes(className)) {
    el.studentPanel.hidden = true;
    el.studentStatus.textContent = "查無此班級，請確認班級號碼。";
    return;
  }
  if (!/^\d{1,2}$/u.test(seat)) {
    el.studentPanel.hidden = true;
    el.studentStatus.textContent = "請輸入一至兩位數座號。";
    return;
  }

  const student = data.students.find((candidate) => candidate.class === className && normalizeSeatInput(candidate.seat) === seat);
  if (!student) {
    el.studentPanel.hidden = true;
    el.studentStatus.textContent = "查無此班級與座號，請確認輸入內容。";
    return;
  }

  el.studentTitle.textContent = `${student.class} 班 ${student.seat} 號｜${student.name}`;
  el.studentSummary.textContent = `共 ${data.episodes.length} 個 EP；每個 EP 顯示最高分與該次送出時間。`;
  renderStudentResults(student);
  el.studentPanel.hidden = false;
  el.studentStatus.textContent = `已找到 ${student.name} 的成績。`;
}

function renderIssues() {
  const issues = data.issues;
  el.issuePanel.hidden = issues.length === 0;
  if (!issues.length) return;
  el.issueSummary.textContent = `待核對資料（${issues.length} 筆，未列入正式成績）`;
  el.issueBody.replaceChildren();
  for (const issue of issues) {
    const row = document.createElement("tr");
    appendText(row, "td", issue.class);
    appendText(row, "td", issue.seat);
    appendText(row, "td", issue.name, "student-name");
    appendText(row, "td", issue.message);
    el.issueBody.append(row);
  }
}

function selectClass(className) {
  currentClassName = className;
  renderClassView();
  el.panel.hidden = false;
}

function setEpisodeView(view) {
  episodeView = view === "all" ? "all" : "recent";
  updateEpisodeViewControls();
  renderClassView();
}

function normalizeClassInput(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, "").replace(/班$/u, "");
}

function lookupClass(event) {
  event.preventDefault();
  const className = normalizeClassInput(el.classInput.value);
  el.classInput.value = className;
  if (!/^\d{3}$/u.test(className)) {
    el.panel.hidden = true;
    el.classStatus.textContent = "請輸入三位數班級號碼。";
    return;
  }
  if (!data.classes.includes(className)) {
    el.panel.hidden = true;
    el.classStatus.textContent = "查無此班級成績，請確認班級號碼。";
    return;
  }
  el.classStatus.textContent = `目前顯示 ${className} 班成績。`;
  selectClass(className);
}

async function activate(password, restored = false) {
  if (activating) return;
  activating = true;
  const button = el.gateForm.querySelector("button");
  el.gateStatus.textContent = restored ? "載入登入狀態…" : "驗證中…";
  el.passwordInput.disabled = true;
  button.disabled = true;
  try {
    data = await decryptPayload(password);
    if (!restored) saveSessionPassword(password);
    el.passwordInput.value = "";
    el.gate.hidden = true;
    el.protectedContent.hidden = false;
    renderHeader();
    if (REVIEW_MODE) {
      el.classPicker.hidden = true;
      el.studentPicker.hidden = true;
      el.studentPanel.hidden = true;
      el.panel.hidden = true;
      el.issuePanel.hidden = true;
      renderReview();
    } else {
      el.reviewPanel.hidden = true;
      updateEpisodeViewControls();
      el.classStatus.textContent = "請輸入班級號碼查看成績。";
      el.classInput.focus();
      renderIssues();
    }
  } catch {
    if (restored) clearSessionPassword();
    el.gateStatus.textContent = restored ? "登入狀態已失效，請重新輸入密碼。" : "密碼不正確或資料無法解密。";
    el.gate.hidden = false;
    el.protectedContent.hidden = true;
    el.passwordInput.value = "";
    el.passwordInput.disabled = false;
    button.disabled = false;
    el.passwordInput.focus();
  } finally {
    activating = false;
  }
}

async function unlock(event) {
  event.preventDefault();
  const password = el.passwordInput.value.normalize("NFKC").trim();
  if (password) await activate(password);
}

el.gateForm.addEventListener("submit", unlock);
el.classForm.addEventListener("submit", lookupClass);
el.studentForm.addEventListener("submit", lookupStudent);
el.episodeViewRecent.addEventListener("click", () => setEpisodeView("recent"));
el.episodeViewAll.addEventListener("click", () => setEpisodeView("all"));

const savedSessionPassword = readSessionPassword();
if (savedSessionPassword) void activate(savedSessionPassword, true);
