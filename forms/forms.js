const DATA_URL = "manifest.enc.json?v=20260913-1";
const VIDEO_DATA_URL = "../data/videos.json?v=20260915-2";
const DEFAULT_AAD = "xinghua-chemistry-forms-v1";
const SESSION_KEY = "xinghua-chemistry-session-v1";
const SESSION_TTL_MS = 60 * 60 * 1000;
const params = new URLSearchParams(location.search);
const requestedFormKey = params.get("key");

const episodePicker = document.querySelector("#episode-picker");
const episodeButtons = document.querySelector("#episode-buttons");
const episodeDetail = document.querySelector("#episode-detail");
const episodeTitle = document.querySelector("#episode-title");
const episodeSummary = document.querySelector("#episode-summary");
const episodeForms = document.querySelector("#episode-forms");
const videoFrameWrap = document.querySelector("#video-frame-wrap");
const videoCaption = document.querySelector("#video-caption");
const videoOpenLink = document.querySelector("#video-open-link");
const status = document.querySelector("#status");
const gate = document.querySelector("#access-gate");
const gateForm = document.querySelector("#gate-form");
const passwordInput = document.querySelector("#password-input");
const gateStatus = document.querySelector("#gate-status");

let formManifest;
let videos = [];
let formsByEpisode = new Map();
let currentEpisode = null;

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

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptManifest(password) {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const envelope = await response.json();
  if (envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA-256" || envelope.cipher !== "AES-256-GCM") {
    throw new Error("Unsupported encrypted form manifest");
  }

  const textEncoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const cryptoKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: decodeBase64(envelope.salt), iterations: envelope.iterations, hash: "SHA-256" },
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
    { name: "AES-GCM", iv: decodeBase64(envelope.iv), additionalData: textEncoder.encode(envelope.aad || DEFAULT_AAD), tagLength: 128 },
    cryptoKey,
    encrypted
  );
  const manifest = JSON.parse(new TextDecoder().decode(plainBytes));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.forms)) throw new Error("Invalid form manifest");
  return manifest;
}

function safeFormUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.google.com" && url.pathname.startsWith("/forms/") ? url.href : null;
  } catch {
    return null;
  }
}

function safeQrPath(value) {
  const path = String(value ?? "");
  return /^assets\/qr\/[a-z0-9-]+\.png$/u.test(path) ? path : null;
}

function addText(parent, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function normalizeVideoEntry(entry) {
  const episode = Number(entry?.episode);
  const label = String(entry?.label ?? `EP${String(episode).padStart(2, "0")}`).trim();
  const fileId = String(entry?.file_id ?? "");
  const title = String(entry?.title ?? "").trim();
  const embedUrl = new URL(String(entry?.embed_url ?? ""));
  if (!Number.isInteger(episode) || episode < 1 || !/^EP\d{2}$/u.test(label) || !fileId || !title) throw new Error("Invalid video entry");
  if (!/^[A-Za-z0-9_-]+$/u.test(fileId)) throw new Error("Invalid Drive file id");
  if (embedUrl.protocol !== "https:" || embedUrl.hostname !== "drive.google.com" || embedUrl.pathname !== `/file/d/${fileId}/preview` || embedUrl.search || embedUrl.hash) {
    throw new Error("Invalid Drive preview URL");
  }
  return { episode, label, fileId, title, embedUrl: embedUrl.href };
}

async function loadVideos() {
  const response = await fetch(VIDEO_DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const entries = Array.isArray(payload) ? payload : payload.videos;
  const loaded = entries.map(normalizeVideoEntry).sort((a, b) => a.episode - b.episode);
  if (loaded.length !== 54 || loaded.some((video, index) => video.episode !== index + 1)) throw new Error("Expected EP01-EP54");
  return loaded;
}

function getEpisodeLabel(form) {
  const match = String(form?.episode ?? form?.form_key ?? "").match(/EP\d{2}/u);
  return match?.[0] ?? null;
}

function episodeNumber(label) {
  return Number(String(label).replace(/^EP/u, ""));
}

function getEpisodeTitle(label, video, forms) {
  const title = video?.title ?? forms[0]?.display_name ?? label;
  return title.startsWith(`${label}-`) ? title.slice(label.length + 1) : title;
}

function updateEpisodeButtonState() {
  for (const button of episodeButtons.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.episode === currentEpisode));
  }
}

function renderForm(form) {
  const card = document.createElement("article");
  card.className = "form-card";
  addText(card, "h3", `${form.form_key ?? form.label ?? "課堂表單"}｜${form.display_name ?? "學生填寫表單"}`, "form-card-title");

  const actions = document.createElement("div");
  actions.className = "form-card-actions";
  const link = safeFormUrl(form.fill_url);
  if (link) {
    const open = document.createElement("a");
    open.className = "form-button";
    open.href = link;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "開啟填寫表單";
    actions.append(open);
  } else {
    addText(card, "p", "此表單入口無效。", "error");
  }
  card.append(actions);

  const qrPath = safeQrPath(form.qr_path);
  if (!qrPath) {
    addText(card, "p", "此表單沒有可顯示的 QR code。", "error");
    return card;
  }

  const qr = document.createElement("img");
  qr.className = "form-card-qr";
  qr.src = `../${qrPath}`;
  qr.alt = `${form.form_key ?? form.label ?? "課堂表單"} 填寫表單 QR code`;
  qr.loading = "eager";
  card.append(qr);

  const sizes = document.createElement("div");
  sizes.className = "qr-sizes";
  addText(sizes, "span", "QR 大小：", "qr-size-label");
  for (const size of [240, 360, 480]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${size}px`;
    button.addEventListener("click", () => {
      qr.style.width = `${size}px`;
      qr.style.height = `${size}px`;
    });
    sizes.append(button);
  }
  card.append(sizes);
  return card;
}

function renderVideo(video, label) {
  videoFrameWrap.replaceChildren();
  if (!video) {
    videoFrameWrap.hidden = true;
    videoOpenLink.hidden = true;
    videoCaption.textContent = `${label} 尚未設定影片。`;
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = video.embedUrl;
  iframe.title = `${video.label}｜${video.title}`;
  iframe.allow = "autoplay; fullscreen";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  videoFrameWrap.append(iframe);
  videoFrameWrap.hidden = false;
  videoCaption.textContent = video.title;
  videoOpenLink.href = `https://drive.google.com/file/d/${video.fileId}/view`;
  videoOpenLink.hidden = false;
}

function renderEpisodeButtons(episodes) {
  episodeButtons.replaceChildren();
  for (const label of episodes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "episode-button";
    button.dataset.episode = label;
    button.textContent = label;
    button.title = videos.find((video) => video.label === label)?.title ?? label;
    button.setAttribute("aria-pressed", String(label === currentEpisode));
    button.addEventListener("click", () => selectEpisode(label));
    episodeButtons.append(button);
  }
}

function selectEpisode(label) {
  const forms = formsByEpisode.get(label) ?? [];
  const video = videos.find((candidate) => candidate.label === label);
  currentEpisode = label;
  updateEpisodeButtonState();
  episodeTitle.textContent = `${label}｜${getEpisodeTitle(label, video, forms)}`;
  episodeSummary.textContent = `${forms.length} 份表單；${video ? "對應影片已載入" : "目前沒有對應影片"}`;
  episodeForms.replaceChildren();
  for (const form of forms) episodeForms.append(renderForm(form));
  renderVideo(video, label);
  episodeDetail.hidden = false;
  episodeDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function activate(password, restored = false) {
  gateStatus.textContent = restored ? "載入登入狀態…" : "驗證中…";
  passwordInput.disabled = true;
  const button = gateForm.querySelector("button");
  button.disabled = true;
  try {
    formManifest = await decryptManifest(password);
    videos = await loadVideos().catch((error) => {
      console.error("Unable to load video manifest", error);
      return [];
    });
    const selected = requestedFormKey ? formManifest.forms.find((form) => form.form_key === requestedFormKey) : null;
    if (requestedFormKey && selected && safeFormUrl(selected.fill_url)) {
      if (!restored) saveSessionPassword(password);
      location.replace(safeFormUrl(selected.fill_url));
      return;
    }

    formsByEpisode = new Map();
    for (const form of formManifest.forms) {
      const label = getEpisodeLabel(form);
      if (!label) continue;
      const group = formsByEpisode.get(label) ?? [];
      group.push(form);
      formsByEpisode.set(label, group);
    }
    for (const forms of formsByEpisode.values()) forms.sort((a, b) => String(a.form_key).localeCompare(String(b.form_key)));

    const episodes = [...new Set([...formsByEpisode.keys(), ...videos.map((video) => video.label)])].sort((a, b) => episodeNumber(a) - episodeNumber(b));
    renderEpisodeButtons(episodes);
    if (!restored) saveSessionPassword(password);
    gate.hidden = true;
    passwordInput.value = "";
    status.textContent = `${episodes.length} 個 EP、${formManifest.forms.length} 份表單、${videos.length} 支影片；請點選對應 EP。`;
    episodePicker.hidden = false;
    episodeDetail.hidden = true;
  } catch {
    if (restored) clearSessionPassword();
    gateStatus.textContent = restored ? "登入狀態已失效，請重新輸入密碼。" : "密碼不正確或資料無法解密。";
    passwordInput.value = "";
    passwordInput.disabled = false;
    button.disabled = false;
    passwordInput.focus();
  }
}

async function unlock(event) {
  event.preventDefault();
  const password = passwordInput.value.normalize("NFKC").trim();
  if (password) await activate(password);
}

gateForm.addEventListener("submit", unlock);

const savedSessionPassword = readSessionPassword();
if (savedSessionPassword) void activate(savedSessionPassword, true);
