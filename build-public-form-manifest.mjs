import fs from "node:fs";

const [registryArg = "../表單連結表.json", outputArg = "forms/manifest.json"] = process.argv.slice(2);
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
fs.writeFileSync(outputArg, `${JSON.stringify({ schema_version: 1, forms }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ forms: forms.length, output: outputArg }));
