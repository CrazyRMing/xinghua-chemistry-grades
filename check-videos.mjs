import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "videos.json"), "utf8"));
const videos = manifest.videos;

if (!Array.isArray(videos) || videos.length !== 54) throw new Error("Expected 54 videos");
const ids = new Set();
for (const [index, video] of videos.entries()) {
  if (video.episode !== index + 1) throw new Error(`Missing or out-of-order episode at index ${index}`);
  if (!/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/preview$/u.test(video.embed_url)) throw new Error(`Invalid preview URL for ${video.label}`);
  if (ids.has(video.file_id)) throw new Error(`Duplicate Drive file id for ${video.label}`);
  ids.add(video.file_id);
}

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
for (const marker of ["id=\"video-panel\"", "id=\"video-controls\"", "id=\"video-frame-wrap\""]) {
  if (!indexHtml.includes(marker)) throw new Error(`Missing UI marker: ${marker}`);
}
for (const marker of ["const VIDEOS_URL", "async function loadVideos", "function renderVideo"]) {
  if (!appJs.includes(marker)) throw new Error(`Missing app marker: ${marker}`);
}

console.log(`Video playback check passed: ${videos.length} Drive videos, EP01–EP54.`);
