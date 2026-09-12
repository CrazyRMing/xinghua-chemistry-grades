const DATA_URL = "data/grades.enc.json";
const DEFAULT_AAD = "xinghua-chemistry-grades-v1";

const el = {
  title: document.querySelector("#page-title"),
  subtitle: document.querySelector("#page-subtitle"),
  gate: document.querySelector("#access-gate"),
  gateForm: document.querySelector("#gate-form"),
  passwordInput: document.querySelector("#password-input"),
  gateStatus: document.querySelector("#gate-status"),
  protectedContent: document.querySelector("#protected-content"),
  status: document.querySelector("#data-status"),
  tabs: document.querySelector("#class-tabs"),
  panel: document.querySelector("#class-panel"),
  classTitle: document.querySelector("#class-title"),
  classSummary: document.querySelector("#class-summary"),
  tableCaption: document.querySelector("#table-caption"),
  scoreHead: document.querySelector("#score-head"),
  scoreBody: document.querySelector("#score-body"),
  issuePanel: document.querySelector("#issue-panel"),
  issueSummary: document.querySelector("#issue-summary"),
  issueBody: document.querySelector("#issue-body"),
  updatedAt: document.querySelector("#updated-at")
};

let data;

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

async function decryptPayload(password) {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const envelope = await response.json();
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

  const ciphertext = decodeBase64(envelope.ciphertext);
  const tag = decodeBase64(envelope.tag);
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext);
  encrypted.set(tag, ciphertext.length);
  const plainBytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(envelope.iv),
      additionalData: textEncoder.encode(envelope.aad || DEFAULT_AAD),
      tagLength: 128
    },
    key,
    encrypted
  );
  const payload = JSON.parse(new TextDecoder().decode(plainBytes));
  if (!Array.isArray(payload.classes) || !Array.isArray(payload.episodes) || !Array.isArray(payload.students)) {
    throw new Error("Invalid grade payload");
  }
  return payload;
}

function getCounts(className, episodeId) {
  const counts = { published: 0, pending: 0, missing: 0 };
  for (const student of data.students) {
    if (student.class !== className) continue;
    const status = student.scores?.[episodeId]?.status ?? "no_response";
    if (status === "published") counts.published += 1;
    else if (status === "pending_review") counts.pending += 1;
    else counts.missing += 1;
  }
  return counts;
}

function formatClassSummary(className) {
  return data.episodes.map((episode) => {
    const counts = getCounts(className, episode.id);
    const details = [`${counts.published} 筆已確認`];
    if (counts.pending) details.push(`${counts.pending} 筆待確認`);
    if (counts.missing) details.push(`${counts.missing} 人尚無回覆`);
    return `${episode.label}：${details.join('、')}`;
  }).join("　");
}

function renderTabs() {
  el.tabs.replaceChildren();
  for (const className of data.classes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "class-tab";
    button.role = "tab";
    button.dataset.className = className;
    button.setAttribute("aria-controls", "class-panel");
    button.addEventListener("click", () => selectClass(className));
    appendText(button, "span", `${className} 班`);
    const meta = data.episodes.map((episode) => {
      const counts = getCounts(className, episode.id);
      return `${episode.label} ${counts.published}`;
    }).join(" · ");
    appendText(button, "span", `${meta} · ${data.students.filter((student) => student.class === className).length} 人`, "class-tab__meta");
    el.tabs.append(button);
  }
}

function renderHeader() {
  el.title.textContent = data.title;
  el.subtitle.textContent = "選擇班級，查看本班各 EP 成績。";
  el.status.textContent = `${data.classes.length} 個班級 · ${data.episodes.length} 個 EP · ${data.issues.length} 筆待核對資料`;
  el.updatedAt.textContent = `更新日期：${data.updated_at}`;
}

function renderScoreHead() {
  const row = document.createElement("tr");
  appendText(row, "th", "座號");
  appendText(row, "th", "姓名");
  for (const episode of data.episodes) appendText(row, "th", `${episode.label}（100 分）`);
  el.scoreHead.replaceChildren(row);
}

function scoreCell(entry) {
  const cell = document.createElement("td");
  const status = entry?.status ?? "no_response";
  const className = status === "published" ? "score-pill--published" : status === "pending_review" ? "score-pill--pending" : "score-pill--missing";
  const text = status === "published" ? `${entry.value}` : status === "pending_review" ? "待確認" : "—";
  const pill = appendText(cell, "span", text, `score-pill ${className}`);
  if (status === "pending_review") pill.title = "此 EP 有多次回覆，正式分數尚待確認";
  if (status === "no_response") pill.title = "目前沒有回覆資料";
  return cell;
}

function renderRows(className) {
  const rows = data.students.filter((student) => student.class === className);
  el.scoreBody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = appendText(row, "td", "目前沒有名單資料", "empty-state");
    cell.colSpan = data.episodes.length + 2;
    el.scoreBody.append(row);
    return;
  }
  for (const student of rows) {
    const row = document.createElement("tr");
    appendText(row, "td", student.seat);
    appendText(row, "td", student.name, "student-name");
    for (const episode of data.episodes) row.append(scoreCell(student.scores[episode.id]));
    el.scoreBody.append(row);
  }
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
  for (const button of el.tabs.querySelectorAll("button")) {
    const active = button.dataset.className === className;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  el.classTitle.textContent = `${className} 班`;
  el.classSummary.textContent = formatClassSummary(className);
  el.tableCaption.textContent = `${className} 班｜全班 EP 成績`;
  renderScoreHead();
  renderRows(className);
  el.panel.hidden = false;
}

async function unlock(event) {
  event.preventDefault();
  const password = el.passwordInput.value;
  if (!password) return;
  el.gateStatus.textContent = "驗證中…";
  el.passwordInput.disabled = true;
  const button = el.gateForm.querySelector("button");
  button.disabled = true;
  try {
    data = await decryptPayload(password);
    el.passwordInput.value = "";
    el.gate.hidden = true;
    el.protectedContent.hidden = false;
    renderHeader();
    renderTabs();
    selectClass(data.classes[0]);
    renderIssues();
  } catch {
    el.gateStatus.textContent = "密碼不正確或資料無法解密。";
    el.passwordInput.value = "";
    el.passwordInput.disabled = false;
    button.disabled = false;
    el.passwordInput.focus();
  }
}

el.gateForm.addEventListener("submit", unlock);
