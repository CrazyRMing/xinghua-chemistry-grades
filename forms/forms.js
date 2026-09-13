const params = new URLSearchParams(location.search);
const key = params.get("key");
const root = document.querySelector("#forms");
const status = document.querySelector("#status");

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

const manifest = await fetch("manifest.json", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); });
if (!Array.isArray(manifest.forms)) throw new Error("Invalid form manifest");
const selected = key ? manifest.forms.find((form) => form.form_key === key) : null;
if (key && selected && safeUrl(selected.fill_url)) { location.replace(safeUrl(selected.fill_url)); }
else { status.textContent = `${manifest.forms.length} 份表單；請選擇要填寫的 EP。`; for (const form of manifest.forms) root.append(renderForm(form)); }
