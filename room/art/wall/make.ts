// Writes the wall's printed art as SVG files next to this script: the drawer-label and sticker atlas, the
// whiteboard's writing and the six placeholder quest cards. Deterministic; run it when the copy changes, then
// `vendor/bin/bun tools/art.ts`.
//   vendor/bin/bun room/art/wall/make.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const out = (name: string, svg: string) => writeFileSync(join(import.meta.dir, name), svg.trim() + "\n");
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const SANS = `font-family="Helvetica Neue, Arial"`, MONO = `font-family="Menlo, monospace"`, HAN = `font-family="PingFang SC, Helvetica Neue"`;

// ------------------------------------------------------------------------------------------- label atlas
// 1024 x 1024. Rows 0-4 (y 0..510): twenty drawer labels in cells of 256 x 102. Rows at y 512..704: eight tool
// stickers in cells of 256 x 96. y 704..832: asset tags (128 x 128) and two reel labels (256 x 128).
// wall.ts reads the same layout (ATLAS in wall.ts).
const DRAWER_LABELS: [string, string, string, string][] = [
  ["R 0603", "10k 1%", "A-01", "red"], ["R 0603", "4.7k 1%", "A-02", "red"], ["R 0805", "220R 5%", "A-07", "red"], ["R 1206", "0R1 1W", "A-11", "red"],
  ["C 0603", "100nF X7R", "B-01", "red"], ["C 0805", "10uF 25V", "B-04", "red"], ["C 1206", "22uF 16V", "B-09", "blue"], ["L 0630", "4.7uH 5A", "B-14", "red"],
  ["D SOD-123", "1N4148W", "C-02", "red"], ["D SMA", "SS34", "C-03", "red"], ["LED 0603", "GREEN", "C-08", "green"], ["Q SOT-23", "2N7002", "C-12", "red"],
  ["U SOP-8", "LM358", "D-01", "red"], ["MCU QFN56", "S3 N16R8", "D-05", "blue"], ["CONN", "GROVE 4P", "E-01", "green"], ["CONN", "PH2.0 2P", "E-02", "red"],
  ["CONN", "USB-C 16P", "E-06", "red"], ["SW", "TACT 6x6", "F-03", "red"], ["M3", "SPACER 10", "G-04", "amber"], ["HDR 2.54", "1x40 PIN", "E-10", "red"],
];
const BAND: Record<string, string> = { red: "#d4222b", green: "#1f8f4e", blue: "#1d5fc2", amber: "#e09a12" };
function atlas(): string {
  const parts: string[] = [];
  DRAWER_LABELS.forEach(([kind, value, bin, colour], i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 102;
    parts.push(`<g transform="translate(${x} ${y})">
  <rect width="256" height="102" fill="#f6f5f0"/>
  <rect width="256" height="36" fill="${BAND[colour]}"/>
  <rect y="36" width="256" height="3" fill="${BAND[colour]}" opacity="0.35"/>
  <text x="12" y="27" ${SANS} font-weight="700" font-size="25" fill="#fff">${esc(kind)}</text>
  <text x="244" y="26" text-anchor="end" ${MONO} font-size="17" fill="#fff" opacity="0.9">${bin}</text>
  <text x="12" y="74" ${SANS} font-weight="700" font-size="32" fill="#16171a">${esc(value)}</text>
  <rect x="12" y="86" width="${90 + (i * 37) % 80}" height="5" fill="#8b8e94"/>
  <rect x="${190 + (i * 13) % 30}" y="52" width="38" height="38" fill="none" stroke="#2a2b2e" stroke-width="2"/>
  <path d="M${198 + (i * 13) % 30} 60h8v8h-8zm14 0h8v8h-8zm-14 14h8v8h-8zm11 3h4v4h-4zm7 -5h4v4h-4z" fill="#2a2b2e"/>
</g>`);
  });
  const STICKERS: [string, string][] = [["压线钳", "CRIMP SN-28B"], ["剥线钳", "STRIP 0.2-6"], ["端子钳", "CRIMP JST/PH"], ["尖嘴钳", "LONG NOSE"], ["斜口钳", "FLUSH CUT"], ["棘轮钳", "FERRULE 0.25-6"], ["胶带", "TAPE"], ["线材", "WIRE AWG22-28"]];
  STICKERS.forEach(([han, latin], i) => {
    const x = (i % 4) * 256, y = 512 + Math.floor(i / 4) * 96;
    parts.push(`<g transform="translate(${x} ${y})">
  <rect width="256" height="96" fill="#fbfbf8"/>
  <rect x="5" y="5" width="246" height="86" rx="7" fill="none" stroke="#25262a" stroke-width="3"/>
  <text x="128" y="50" text-anchor="middle" ${HAN} font-weight="600" font-size="38" fill="#141518">${han}</text>
  <text x="128" y="78" text-anchor="middle" ${MONO} font-size="19" fill="#3a3c40">${latin}</text>
</g>`);
  });
  for (let i = 0; i < 4; i++) {
    const x = i * 128, y = 704;
    parts.push(`<g transform="translate(${x} ${y})">
  <rect width="128" height="128" fill="#f2c319"/>
  <rect x="6" y="6" width="116" height="116" fill="none" stroke="#1c1c1c" stroke-width="3"/>
  <text x="64" y="38" text-anchor="middle" ${SANS} font-weight="700" font-size="22" fill="#1c1c1c">LAB-0${i + 3}</text>
  <text x="64" y="64" text-anchor="middle" ${HAN} font-weight="600" font-size="21" fill="#1c1c1c">${["元件柜", "元件柜", "工具墙", "白板"][i]}</text>
  <path d="${Array.from({ length: 17 }, (_, k) => `M${16 + k * 6} 78v30`).join("")}" stroke="#1c1c1c" stroke-width="${2 + (i % 2)}" stroke-dasharray="30 0"/>
  <path d="${Array.from({ length: 8 }, (_, k) => `M${19 + k * 12 + (k * i) % 3} 78v30`).join("")}" stroke="#1c1c1c" stroke-width="1"/>
</g>`);
  }
  parts.push(`<g transform="translate(512 704)">
  <rect width="256" height="128" fill="#fafaf7"/>
  <rect x="0" y="0" width="256" height="34" fill="#20242b"/>
  <text x="12" y="25" ${SANS} font-weight="700" font-size="22" fill="#fff">LED STRIP 5 m</text>
  <text x="12" y="66" ${MONO} font-size="20" fill="#16171a">SK6812 60/m 5V</text>
  <text x="12" y="94" ${MONO} font-size="18" fill="#55585e">IP30 10 mm RGBW</text>
  <text x="12" y="118" ${HAN} font-size="17" fill="#55585e">灯带 · 请勿带电插拔</text>
</g>
<g transform="translate(768 704)">
  <rect width="256" height="128" fill="#fafaf7"/>
  <rect x="0" y="0" width="256" height="128" fill="none" stroke="#c22" stroke-width="10"/>
  <text x="128" y="52" text-anchor="middle" ${HAN} font-weight="600" font-size="34" fill="#c22">用后归位</text>
  <text x="128" y="92" text-anchor="middle" ${SANS} font-weight="700" font-size="24" fill="#16171a">RETURN TOOLS</text>
</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n<rect width="1024" height="1024" fill="#f6f5f0"/>\n${parts.join("\n")}\n</svg>`;
}

// ------------------------------------------------------------------------------------------- handwriting
// Block capitals as single strokes on a 4 x 6 grid, drawn with a wobble so they read as marker on a board.
const GLYPHS: Record<string, number[][][]> = {
  A: [[[0, 0], [2, 6], [4, 0]], [[1, 2.2], [3, 2.2]]],
  B: [[[0, 0], [0, 6], [2.6, 6], [3.6, 5], [3.6, 4], [2.6, 3.1], [0, 3.1]], [[2.6, 3.1], [4, 2.2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1.2, 6], [0, 4.6], [0, 1.4], [1.2, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2.4, 6], [4, 4.4], [4, 1.6], [2.4, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3.1], [3, 3.1]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3.1], [3, 3.1]]],
  G: [[[4, 5], [3, 6], [1.2, 6], [0, 4.6], [0, 1.4], [1.2, 0], [3, 0], [4, 1.2], [4, 2.8], [2.2, 2.8]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3.1], [4, 3.1]]],
  I: [[[2, 0], [2, 6]], [[1, 0], [3, 0]], [[1, 6], [3, 6]]],
  J: [[[3.4, 6], [3.4, 1.4], [2.4, 0], [1, 0], [0, 1.2]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2.6]], [[1.4, 3.6], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 2.6], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1.2, 0], [0, 1.4], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.6], [4, 1.4], [2.8, 0], [1.2, 0]]],
  P: [[[0, 0], [0, 6], [2.8, 6], [4, 5], [4, 3.8], [2.8, 2.8], [0, 2.8]]],
  Q: [[[1.2, 0], [0, 1.4], [0, 4.6], [1.2, 6], [2.8, 6], [4, 4.6], [4, 1.4], [2.8, 0], [1.2, 0]], [[2.4, 1.6], [4.2, -0.4]]],
  R: [[[0, 0], [0, 6], [2.8, 6], [4, 5], [4, 3.8], [2.8, 2.8], [0, 2.8]], [[2, 2.8], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3.1], [3, 3.1], [4, 2.2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1.4], [1.2, 0], [2.8, 0], [4, 1.4], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3.6], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  "0": [[[1.2, 0], [0.2, 1.4], [0.2, 4.6], [1.2, 6], [2.6, 6], [3.6, 4.6], [3.6, 1.4], [2.6, 0], [1.2, 0]]],
  "1": [[[1, 4.8], [2.2, 6], [2.2, 0]], [[1, 0], [3.4, 0]]],
  "2": [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 3.8], [0, 0], [4, 0]]],
  "3": [[[0, 5.2], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3.1], [1.6, 3.1]], [[3, 3.1], [4, 2.2], [4, 1], [3, 0], [1, 0], [0, 0.8]]],
  "4": [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  "5": [[[3.8, 6], [0.6, 6], [0.4, 3.5], [2.4, 3.8], [4, 2.7], [4, 1.2], [2.8, 0], [1, 0], [0, 0.7]]],
  "6": [[[3.6, 6], [1.6, 5.2], [0, 3], [0, 1.2], [1.2, 0], [2.8, 0], [4, 1.2], [4, 2.4], [2.8, 3.4], [1.2, 3.4], [0, 2.4]]],
  "7": [[[0, 6], [4, 6], [1.6, 0]]],
  "8": [[[1, 3.2], [0, 4.2], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4.2], [3, 3.2], [1, 3.2], [0, 2.2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.2], [3, 3.2]]],
  "9": [[[4, 3.6], [2.8, 2.6], [1.2, 2.6], [0, 3.6], [0, 4.8], [1.2, 6], [2.8, 6], [4, 4.8], [4, 3], [2.4, 0.8], [0.4, 0]]],
  "-": [[[0.6, 3], [3.4, 3]]],
  "=": [[[0.6, 3.9], [3.4, 3.9]], [[0.6, 2.1], [3.4, 2.1]]],
  ".": [[[1.8, 0], [2.2, 0.35]]],
  ":": [[[1.8, 1], [2.2, 1.35]], [[1.8, 4], [2.2, 4.35]]],
  "/": [[[0.4, 0], [3.6, 6]]],
  "+": [[[0.6, 3], [3.4, 3]], [[2, 1.4], [2, 4.6]]],
  ">": [[[0, 3], [4, 3]], [[2.4, 4.6], [4, 3], [2.4, 1.4]]],
  "?": [[[0.4, 4.8], [1.4, 6], [2.8, 6], [3.8, 4.8], [3.6, 3.6], [2, 2.6], [2, 1.6]], [[1.9, 0], [2.1, 0.3]]],
  "!": [[[2, 6], [2, 1.8]], [[1.9, 0], [2.1, 0.3]]],
  "#": [[[1.2, 0.4], [1.8, 5.6]], [[2.8, 0.4], [3.4, 5.6]], [[0.2, 2], [4, 2]], [[0.4, 4], [4.2, 4]]],
};
/** A stroke through `points`, corners rounded as a hand would. */
function stroke(points: number[][]): string {
  const f = (p: number[]) => `${p[0]!.toFixed(1)} ${p[1]!.toFixed(1)}`;
  let d = `M${f(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, p = points[i]!, n = points[i + 1]!, t = 0.3;
    d += `L${f([p[0]! + (a[0]! - p[0]!) * t, p[1]! + (a[1]! - p[1]!) * t])}Q${f(p)} ${f([p[0]! + (n[0]! - p[0]!) * t, p[1]! + (n[1]! - p[1]!) * t])}`;
  }
  return d + `L${f(points[points.length - 1]!)}`;
}
function write(text: string, x: number, y: number, size: number, colour: string, random: () => number, width = 5): string {
  const unit = size / 6;
  let d = "", cx = x, cy = y;
  for (const ch of text.toUpperCase()) {
    if (ch === " ") { cx += unit * (3.2 + random()); continue; }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const slant = 0.10 + (random() - 0.5) * 0.08, scale = 1 + (random() - 0.5) * 0.14;
    cy += (random() - 0.5) * unit * 0.25;
    for (const line of glyph) {
      d += stroke(line.map(([gx, gy]) => {
        const jx = (random() - 0.5) * 0.42, jy = (random() - 0.5) * 0.42;
        return [cx + (gx! * scale + jx + gy! * slant) * unit, cy - (gy! * scale + jy) * unit];
      }));
    }
    cx += unit * (5.3 + (random() - 0.5) * 0.7) * scale;
  }
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`;
}
/** A hand-drawn line through points: wobbling a little, never quite straight. */
function sketch(points: number[][], colour: string, random: () => number, width = 5, close = false): string {
  const pts: number[][] = [];
  const all = close ? [...points, points[0]!] : points;
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i]!, b = all[i + 1]!, steps = Math.max(2, Math.round(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 45));
    for (let k = 0; k < steps; k++) pts.push([a[0]! + ((b[0]! - a[0]!) * k) / steps + (random() - 0.5) * 3.4, a[1]! + ((b[1]! - a[1]!) * k) / steps + (random() - 0.5) * 3.4]);
  }
  pts.push(all[all.length - 1]!.map(v => v + (random() - 0.5) * 4));
  return `<path d="M${pts.map(p => p.map(v => v.toFixed(1)).join(" ")).join("L")}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
}

function whiteboard(): string {
  const r = rng(41);
  const black = "#1c1d24", blue = "#1a45b4", red = "#c3262b", green = "#1c7c3e";
  const box = (x: number, y: number, w: number, h: number, colour: string) => sketch([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], colour, r, 5, true);
  const parts = [
    // What an eraser leaves: faint clouds of old ink.
    `<g filter="url(#soft)" opacity="0.5"><ellipse cx="760" cy="150" rx="210" ry="70" fill="#d9dbe0"/><ellipse cx="300" cy="640" rx="240" ry="60" fill="#dcdde2"/><ellipse cx="820" cy="560" rx="120" ry="90" fill="#e0dfe4"/><path d="M560 90q120 30 300 -10" stroke="#b9bfd2" stroke-width="16" fill="none"/></g>`,
    write("BENCH 1", 46, 96, 62, black, r, 7),
    sketch([[44, 116], [330, 110]], red, r, 6),
    write("- PORT A = I2C", 50, 190, 40, black, r),
    write("- ENV 0X44 OK", 50, 254, 40, black, r),
    write("- 5V RAIL 4.96", 50, 318, 40, blue, r),
    write("- BUY GROVE X5", 50, 382, 40, black, r),
    write("- RGB DATA > G2 ?", 50, 446, 40, red, r),
    // The wiring sketch: the Tab5, a hub, three Units.
    box(560, 250, 170, 110, black), write("TAB5", 588, 322, 38, black, r),
    box(600, 440, 96, 70, blue), write("HUB", 612, 490, 26, blue, r, 4),
    sketch([[645, 362], [648, 438]], red, r, 5),
    box(470, 590, 100, 70, green), write("ENV", 484, 640, 26, green, r, 4),
    box(640, 600, 100, 70, green), write("LED", 656, 650, 26, green, r, 4),
    box(820, 580, 120, 70, green), write("KNOB", 832, 630, 26, green, r, 4),
    sketch([[620, 512], [540, 560], [522, 588]], black, r, 4),
    sketch([[650, 512], [684, 598]], black, r, 4),
    sketch([[690, 500], [800, 540], [868, 578]], black, r, 4),
    write("4P", 700, 410, 24, red, r, 4),
    write("FRI: DEMO", 600, 120, 46, blue, r, 6),
    sketch([[596, 142], [880, 134]], blue, r, 5),
    write("3V3", 780, 300, 28, red, r, 4), sketch([[732, 300], [772, 296]], red, r, 4),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="752" viewBox="0 0 1024 752">
<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter></defs>
<rect width="1024" height="752" fill="#f5f6f6"/>
${parts.join("\n")}
</svg>`;
}

// ------------------------------------------------------------------------------------------- quest cards
// Placeholders for the lesson cards the app prints: 720 x 1008 for a 200 x 280 mm sheet.
const QUESTS: { title: string; sub: string; colour: string; steps: string[]; diagram: string }[] = [
  {
    title: "Hello, Tab5", sub: "Power up and draw on the screen", colour: "#e4572e", steps: ["Plug the USB-C cable into the Tab5", "Run hello.py from the editor", "Change the text and the colour"],
    diagram: `<rect x="150" y="40" width="300" height="190" rx="16" fill="#23262b"/><rect x="170" y="58" width="246" height="154" rx="4" fill="#bfe3ff"/><circle cx="434" cy="135" r="6" fill="#4a4f57"/><text x="293" y="146" text-anchor="middle" ${SANS} font-weight="700" font-size="34" fill="#16406b">Hello!</text><path d="M150 180h-60v60" fill="none" stroke="#23262b" stroke-width="8" stroke-linecap="round"/>`,
  },
  {
    title: "Read a sensor", sub: "Temperature and humidity over I2C", colour: "#1d6fd1", steps: ["Connect the ENV Unit to Port A", "Scan the bus: find 0x44", "Show the reading on the screen"],
    diagram: `<rect x="70" y="80" width="150" height="110" rx="12" fill="#1d6fd1"/><text x="145" y="145" text-anchor="middle" ${SANS} font-weight="700" font-size="30" fill="#fff">ENV</text><path d="M220 135c60 0 60 -40 130 -40" fill="none" stroke="#c22" stroke-width="7"/><path d="M220 147c60 0 60 -40 130 -40" fill="none" stroke="#222" stroke-width="7"/><path d="M220 159c60 0 60 -40 130 -40" fill="none" stroke="#e3b800" stroke-width="7"/><path d="M220 171c60 0 60 -40 130 -40" fill="none" stroke="#eee" stroke-width="7"/><rect x="350" y="60" width="190" height="130" rx="12" fill="#23262b"/><text x="445" y="120" text-anchor="middle" ${MONO} font-size="30" fill="#7dffb2">23.4 C</text><text x="445" y="160" text-anchor="middle" ${MONO} font-size="30" fill="#7dc8ff">48 %</text>`,
  },
  {
    title: "Light it up", sub: "Drive an RGB LED strip", colour: "#1f9d55", steps: ["Connect the RGB Unit to the hub", "Set one pixel, then all of them", "Make a rainbow that moves"],
    diagram: `<rect x="60" y="110" width="480" height="50" rx="8" fill="#f0f0ea" stroke="#999" stroke-width="3"/>${["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#af52de"].map((c, i) => `<rect x="${86 + i * 64}" y="120" width="30" height="30" rx="5" fill="${c}"/>`).join("")}<path d="M60 135h-40" stroke="#222" stroke-width="7"/><path d="M300 60v40M240 70l14 34M360 70l-14 34" stroke="#e0a800" stroke-width="6" stroke-linecap="round"/>`,
  },
  {
    title: "Make a sound", sub: "Play tones through the speaker", colour: "#8e44ad", steps: ["Play one note: 440 Hz", "Write a scale with a loop", "Play a tune when the screen is touched"],
    diagram: `<path d="M90 110h50l60 -50v170l-60 -50h-50z" fill="#23262b"/><path d="M240 100q36 45 0 90M280 70q64 75 0 150" fill="none" stroke="#8e44ad" stroke-width="9" stroke-linecap="round"/><path d="M350 145${Array.from({ length: 12 }, (_, i) => `q10 ${i % 2 ? 70 : -70} 20 0`).join("")}" fill="none" stroke="#23262b" stroke-width="5"/>`,
  },
  {
    title: "Turn a knob", sub: "Read an encoder, change a value", colour: "#d98e04", steps: ["Connect the Encoder Unit", "Print the count as you turn it", "Use it to dim the screen"],
    diagram: `<circle cx="200" cy="140" r="82" fill="#2b2e33"/><circle cx="200" cy="140" r="62" fill="#4b5058"/><path d="M200 140l36 -42" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="M96 90a120 120 0 0 1 208 0" fill="none" stroke="#d98e04" stroke-width="8" stroke-linecap="round"/><path d="M304 90l-4 -26M304 90l-25 5" stroke="#d98e04" stroke-width="8" stroke-linecap="round"/><rect x="360" y="70" width="190" height="34" rx="6" fill="#e6e6e0"/><rect x="360" y="70" width="120" height="34" rx="6" fill="#d98e04"/><text x="455" y="160" text-anchor="middle" ${MONO} font-size="40" fill="#23262b">63</text>`,
  },
  {
    title: "Log and plot", sub: "Draw a live chart of a reading", colour: "#c0392b", steps: ["Sample the sensor every second", "Keep the last sixty values", "Plot them as a line on the screen"],
    diagram: `<path d="M80 40v190h460" fill="none" stroke="#23262b" stroke-width="6"/><path d="M80 180l50 -20l50 10l50 -60l50 20l50 -70l50 40l50 -30l50 -40l50 20" fill="none" stroke="#c0392b" stroke-width="7" stroke-linejoin="round"/>${[130, 230, 330, 430, 530].map(x => `<path d="M${x} 230v12" stroke="#23262b" stroke-width="4"/>`).join("")}<path d="M80 105h460" stroke="#999" stroke-width="2" stroke-dasharray="8 8"/>`,
  },
];
function quest(i: number): string {
  const q = QUESTS[i]!;
  const steps = q.steps.map((step, k) => `
  <rect x="64" y="${604 + k * 96}" width="44" height="44" rx="8" fill="none" stroke="#23262b" stroke-width="5"/>
  ${k < (i % 3) ? `<path d="M72 ${626 + k * 96}l12 14l24 -32" fill="none" stroke="${q.colour}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  <text x="130" y="${637 + k * 96}" ${SANS} font-size="29" fill="#23262b">${esc(step)}</text>
  <path d="M130 ${660 + k * 96}h526" stroke="#c9c9c2" stroke-width="2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1008" viewBox="0 0 720 1008">
<rect width="720" height="1008" fill="#fbfaf5"/>
<rect x="0" y="0" width="720" height="18" fill="${q.colour}"/>
<circle cx="112" cy="140" r="58" fill="${q.colour}"/>
<text x="112" y="164" text-anchor="middle" ${SANS} font-weight="700" font-size="70" fill="#fff">${i + 1}</text>
<text x="196" y="130" ${SANS} font-weight="700" font-size="54" fill="#17181b">${esc(q.title)}</text>
<text x="198" y="176" ${SANS} font-size="27" fill="#5c5f66">${esc(q.sub)}</text>
<rect x="56" y="244" width="608" height="290" rx="18" fill="#f0efe8" stroke="#d6d5cc" stroke-width="3"/>
<g transform="translate(60 254)">${q.diagram}</g>
<text x="64" y="582" ${SANS} font-weight="700" font-size="24" letter-spacing="3" fill="${q.colour}">CHECKLIST</text>${steps}
<path d="M56 910h608" stroke="#23262b" stroke-width="3"/>
<text x="64" y="952" ${MONO} font-size="22" fill="#5c5f66">POCKET BENCH · QUEST ${i + 1}/6</text>
<text x="656" y="952" text-anchor="end" ${MONO} font-size="22" fill="#5c5f66">${["10", "15", "15", "20", "20", "25"][i]} min</text>
</svg>`;
}

out("labels.svg", atlas());
out("whiteboard.svg", whiteboard());
for (let i = 0; i < 6; i++) out(`quest-${i}.svg`, quest(i));
console.log("wall art: labels.svg, whiteboard.svg, quest-0..5.svg");
