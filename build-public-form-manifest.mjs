import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [registryArg = "../表單連結表.json", outputArg = "forms/manifest.enc.json"] = process.argv.slice(2);
const password = process.env.GRADE_SITE_PASSWORD;
if (!password) throw new Error("GRADE_SITE_PASSWORD is required");
const registry = JSON.parse(fs.readFileSync(registryArg, "utf8"));
if (!Array.isArray(registry.forms)) throw new Error("Registry forms must be an array");
const forms = registry.forms.filter((form) => form.status === "published" && form.fill_url).map((form) => ({
  episode: form.episode,
  form_key: form.form_key,
  label: form.label,
  display_name: form.display_name,
  fill_url: form.fill_url,
  qr_path: form.qr_path
}));
if (forms.length !== 55) throw new Error(`Expected 55 published forms, got ${forms.length}`);

const aad = "xinghua-chemistry-forms-v1";
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, 250000, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from(aad, "utf8"));
const payload = Buffer.from(JSON.stringify({ schema_version: 1, forms }), "utf8");
const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = {
  version: 1,
  kdf: "PBKDF2-SHA-256",
  iterations: 250000,
  cipher: "AES-256-GCM",
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  ciphertext: ciphertext.toString("base64"),
  aad
};
fs.mkdirSync(path.dirname(outputArg), { recursive: true });
fs.writeFileSync(outputArg, `${JSON.stringify(envelope)}\n`, "utf8");
console.log(JSON.stringify({ forms: forms.length, output: outputArg }));
