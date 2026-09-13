const DATA_URL = "manifest.enc.json?v=20260913-1";
const DEFAULT_AAD = "xinghua-chemistry-forms-v1";
const params = new URLSearchParams(location.search);
const key = params.get("key");
const root = document.querySelector("#forms");
const status = document.querySelector("#status");
const gate = document.querySelector("#access-gate");
const gateForm = document.querySelector("#gate-form");
const passwordInput = document.querySelector("#password-input");
const gateStatus = document.querySelector("#gate-status");

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

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.google.com" && url.pathname.startsWith("/forms/") ? url.href : null;
  } catch { return null; }
}

function addText(parent, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function renderForm(form) {
  const card = document.createElement("article");
  card.className = "form-card";
  addText(card, "h2", `${form.label ?? form.form_key} · ${form.display_name ?? "學生填寫表單"}`);
  const link = safeUrl(form.fill_url);
  if (!link) { addText(card, "p", "此表單入口無效。", "error"); return card; }
  const actions = document.createElement("p");
  const open = document.createElement("a");
  open.href = link; open.target = "_blank"; open.rel = "noopener noreferrer";
  open.textContent = "開啟填寫頁";
  actions.append(open);
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.textContent = "顯示 QR code";
  toggle.setAttribute("aria-expanded", "false");
  const qr = document.createElement("img");
  qr.src = `../${form.qr_path}`; qr.alt = `${form.label ?? form.form_key} 填寫表單 QR code`;
  qr.hidden = true; qr.loading = "lazy";
  const sizes = document.createElement("div"); sizes.className = "qr-sizes"; sizes.hidden = true;
  for (const size of [240, 360, 480]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${size}px`;
    button.addEventListener("click", () => { qr.style.width = `${size}px`; }); sizes.append(button);
  }
  toggle.addEventListener("click", () => { const show = qr.hidden; qr.hidden = !show; sizes.hidden = !show; toggle.textContent = show ? "隱藏 QR code" : "顯示 QR code"; toggle.setAttribute("aria-expanded", String(show)); });
  actions.append(document.createTextNode(" "), toggle); card.append(actions, qr, sizes); return card;
}

async function unlock(event) {
  event.preventDefault();
  const password = passwordInput.value.normalize("NFKC").trim();
  if (!password) return;
  gateStatus.textContent = "驗證中…";
  passwordInput.disabled = true;
  const button = gateForm.querySelector("button");
  button.disabled = true;
  try {
    const manifest = await decryptManifest(password);
    const selected = key ? manifest.forms.find((form) => form.form_key === key) : null;
    gate.hidden = true;
    passwordInput.value = "";
    if (key && selected && safeUrl(selected.fill_url)) {
      location.replace(safeUrl(selected.fill_url));
      return;
    }
    status.textContent = `${manifest.forms.length} 份表單；請選擇要填寫的 EP。`;
    root.hidden = false;
    for (const form of manifest.forms) root.append(renderForm(form));
  } catch {
    gateStatus.textContent = "密碼不正確或資料無法解密。";
    passwordInput.value = "";
    passwordInput.disabled = false;
    button.disabled = false;
    passwordInput.focus();
  }
}

gateForm.addEventListener("submit", unlock);
