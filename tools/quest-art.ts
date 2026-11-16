// The task cards on the wall's clipboards: one sheet per lesson (the first six), from the lessons' own words.
//   bun tools/quest-art.ts && bun tools/art.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LESSONS } from "../sidecar/src/lessons/catalog.ts";
import { UNIT_SPECS } from "../room/catalog.ts";

const out = resolve(import.meta.dir, "../room/art/quests");
mkdirSync(out, { recursive: true });
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const TINTS = ["#1f8f4e", "#2f6fd6", "#0f9d8a", "#7a4fd0", "#d08a12", "#c9a400", "#1f8f4e", "#d0473c", "#b83a6a", "#5a6bd8"];
/** Breaks a line of Chinese (and some Latin) text to a width in em. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "", used = 0;
  for (const ch of text) {
    const w = /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
    if (used + w > width) { lines.push(line); line = ""; used = 0; }
    line += ch; used += w;
  }
  if (line) lines.push(line);
  return lines;
}

LESSONS.slice(0, 6).forEach((lesson, index) => {
  const W = 800, H = 1120, tint = TINTS[index % TINTS.length]!;
  let y = 0;
  let body = `<rect width="${W}" height="${H}" fill="#fbfaf6"/>`;
  body += `<rect width="${W}" height="250" fill="${tint}"/>`;
  body += `<text x="60" y="128" font-family="Helvetica Neue, Arial" font-weight="800" font-size="76" fill="#ffffff" fill-opacity="0.55">${String(lesson.number).padStart(2, "0")}</text>`;
  body += `<text x="60" y="212" font-family="PingFang SC, Helvetica" font-weight="700" font-size="68" fill="#ffffff">${esc(lesson.title)}</text>`;
  body += `<text x="${W - 60}" y="128" text-anchor="end" font-family="PingFang SC, Helvetica" font-weight="600" font-size="30" fill="#ffffff" fill-opacity="0.85">${lesson.minutes} 分钟 · ${"★".repeat(lesson.level)}${"☆".repeat(3 - lesson.level)}</text>`;
  y = 320;
  for (const line of wrap(lesson.tagline, 19)) { body += `<text x="60" y="${y}" font-family="PingFang SC, Helvetica" font-size="35" fill="#33363b">${esc(line)}</text>`; y += 50; }
  y += 22;
  // What it needs.
  let x = 60;
  const units = lesson.units.length ? lesson.units.map(id => UNIT_SPECS.find(unit => unit.id === id)?.zh ?? id) : ["只用 Tab5"];
  for (const name of units) {
    const w = name.length * 31 + 44;
    body += `<rect x="${x}" y="${y - 38}" width="${w}" height="54" rx="27" fill="${tint}" fill-opacity="0.13" stroke="${tint}" stroke-opacity="0.5" stroke-width="2"/>`;
    body += `<text x="${x + w / 2}" y="${y}" text-anchor="middle" font-family="PingFang SC, Helvetica" font-weight="600" font-size="30" fill="${tint}">${esc(name)}</text>`;
    x += w + 16;
  }
  y += 78;
  body += `<line x1="60" y1="${y - 30}" x2="${W - 60}" y2="${y - 30}" stroke="#d9d6cc" stroke-width="2"/>`;
  y += 26;
  for (const step of lesson.steps.slice(0, 5)) {
    body += `<rect x="60" y="${y - 30}" width="34" height="34" rx="7" fill="none" stroke="#8a8d92" stroke-width="3"/>`;
    const lines = wrap(step.text, 17.5);
    lines.slice(0, 2).forEach((line, i) => { body += `<text x="116" y="${y + i * 44}" font-family="PingFang SC, Helvetica" font-size="32" fill="#1f2226">${esc(line)}</text>`; });
    y += Math.min(lines.length, 2) * 44 + 34;
  }
  body += `<text x="${W / 2}" y="${H - 48}" text-anchor="middle" font-family="PingFang SC, Helvetica" font-weight="600" font-size="28" fill="#9a9da3">点一下这张卡片开始</text>`;
  writeFileSync(join(out, `quest-${index}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
});
console.log("quest art: 6 sheets");
