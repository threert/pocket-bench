// Writes the SVG art of the Units' labels and of the parts tray (room/art/units/*.svg) from room/catalog.ts.
//   bun tools/unit-art.ts && bun tools/art.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TRAY_POCKETS, TRAY_SIZE, UNIT_SPECS } from "../room/catalog.ts";

const out = resolve(import.meta.dir, "../room/art/units");
mkdirSync(out, { recursive: true });
const PX = 16; // texels a millimetre

for (const unit of UNIT_SPECS) {
  // The sticker covers the top face inside a 1.2 mm margin; the socket end is on the left.
  const w = Math.round((unit.size[0] - 2.4) * PX), h = Math.round((unit.size[1] - 2.4) * PX);
  const band = Math.round(h * 0.46);
  const title = Math.min(band * 0.62, (w - 40) / (unit.name.length * 0.62));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="${PX * 1.4}" fill="#f5f5f2"/>
  <rect x="0" y="0" width="${w}" height="${band}" rx="${PX * 1.4}" fill="${unit.tint}"/>
  <rect x="0" y="${band / 2}" width="${w}" height="${band / 2}" fill="${unit.tint}"/>
  <text x="${w / 2}" y="${band * 0.72}" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="700" font-size="${title.toFixed(1)}" letter-spacing="1.5" fill="#ffffff">${unit.name}</text>
  <text x="${PX * 1.6}" y="${band + (h - band) * 0.46}" font-family="PingFang SC, Helvetica" font-weight="600" font-size="${((h - band) * 0.34).toFixed(1)}" fill="#1c1d20">${unit.zh}</text>
  <text x="${PX * 1.6}" y="${band + (h - band) * 0.86}" font-family="Menlo, monospace" font-size="${((h - band) * 0.25).toFixed(1)}" fill="#5c6067">I2C ${unit.addresses}</text>
  <text x="${w - PX * 1.4}" y="${band + (h - band) * 0.86}" text-anchor="end" font-family="Menlo, monospace" font-size="${((h - band) * 0.22).toFixed(1)}" fill="#9a9da3">${unit.sku}</text>
</svg>`;
  writeFileSync(join(out, `${unit.id}.svg`), svg);
}

// The tray's top: charcoal foam with each pocket's outline and what belongs in it.
{
  const k = 5; // texels a millimetre
  const [tw, th] = TRAY_SIZE;
  const W = tw * k, H = th * k;
  let body = `<rect width="${W}" height="${H}" fill="#24262a"/>`;
  body += `<text x="${10 * k}" y="${H - 7 * k}" font-family="Helvetica Neue, Arial" font-weight="700" font-size="${6 * k}" letter-spacing="2.5" fill="#8f949c">UNIT KIT · PORT A</text>`;
  body += `<text x="${W - 10 * k}" y="${H - 7 * k}" text-anchor="end" font-family="PingFang SC, Helvetica" font-size="${4.8 * k}" fill="#6f747c">点一下，或拖到绿色底座上</text>`;
  for (const unit of UNIT_SPECS) {
    const [cx, cz] = TRAY_POCKETS[unit.id]!;
    const x = (cx + tw / 2 - unit.size[0] / 2 - 2) * k, y = (cz + th / 2 - unit.size[1] / 2 - 2) * k;
    const w = (unit.size[0] + 4) * k, h = (unit.size[1] + 4) * k;
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${3 * k}" fill="#17181b" stroke="#4b5058" stroke-width="${0.5 * k}"/>`;
    const ly = y + h + 6.2 * k;
    body += `<text x="${x + w / 2}" y="${ly}" text-anchor="middle" font-family="PingFang SC, Helvetica" font-weight="600" font-size="${4.6 * k}" fill="#d7dae0">${unit.zh}</text>`;
    body += `<text x="${x + w / 2}" y="${ly + 5 * k}" text-anchor="middle" font-family="Helvetica Neue, Arial" font-size="${3.3 * k}" letter-spacing="1" fill="${unit.tint === "#3c4654" ? "#9aa3b0" : unit.tint}">${unit.name}</text>`;
  }
  writeFileSync(join(out, "tray.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
}
console.log(`unit art: ${UNIT_SPECS.length + 1} files`);
writeFileSync(join(out, "hub.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="288" viewBox="0 0 640 288">
  <rect width="640" height="288" rx="22" fill="#f5f5f2"/><rect width="640" height="130" rx="22" fill="#3a3f48"/><rect y="66" width="640" height="64" fill="#3a3f48"/>
  <text x="320" y="92" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="700" font-size="76" letter-spacing="3" fill="#fff">HUB 1 → 3</text>
  <text x="26" y="198" font-family="PingFang SC, Helvetica" font-weight="600" font-size="46" fill="#1c1d20">分线器 · 同一条 I2C 总线</text>
  <text x="26" y="258" font-family="Menlo, monospace" font-size="36" fill="#5c6067">PORT A  SDA G53 · SCL G54</text>
</svg>`);
