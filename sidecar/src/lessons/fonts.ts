// The font an app's Chinese text is baked from: <workspace>/.bench/fonts/cjk.otf,
// which the blank template's fonts.json names as its fallback face.
//
// PocketJS bakes a glyph from the first face that has it: Inter, then the
// fallback faces of fonts.json. Its font reader takes one-face files only,
// and macOS ships its Chinese fonts as collections (.ttc), so the face is
// taken out of the collection once, when the workspace is made:
//   1. Hiragino Sans GB W6 from /System/Library/Fonts/Hiragino Sans GB.ttc
//   2. else a link to Arial Unicode (one light weight; a one-face file already)
//   3. else the framework's Noto Sans CJK demo subset, so that a build still
//      succeeds (most characters then draw as hollow boxes)
// The glyphs are system fonts': fine on this Mac, not to be shipped. An app
// that leaves the bench names a font of its own in fonts.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COLLECTIONS = ["/System/Library/Fonts/Hiragino Sans GB.ttc"];
const SINGLE = ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"];

interface Table { tag: string; checksum: number; offset: number; length: number }

function tablesAt(view: DataView, offset: number): Table[] {
  const count = view.getUint16(offset + 4), tables: Table[] = [];
  for (let index = 0; index < count; index++) {
    const at = offset + 12 + index * 16;
    tables.push({
      tag: String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)),
      checksum: view.getUint32(at + 4), offset: view.getUint32(at + 8), length: view.getUint32(at + 12),
    });
  }
  return tables;
}

/** The faces of a TrueType or OpenType collection: where each begins and how heavy it is (OS/2 usWeightClass). */
export function collectionFaces(bytes: Uint8Array): { offset: number; weight: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || view.getUint32(0) !== 0x74746366) return [];
  const faces: { offset: number; weight: number }[] = [];
  for (let index = 0; index < view.getUint32(8); index++) {
    const offset = view.getUint32(12 + index * 4);
    const os2 = tablesAt(view, offset).find(table => table.tag === "OS/2");
    faces.push({ offset, weight: os2 ? view.getUint16(os2.offset + 4) : 400 });
  }
  return faces;
}

/** One face of a collection as a font file of its own: its table directory, then its tables, each on a 4-byte boundary. */
export function extractFace(bytes: Uint8Array, offset: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesAt(view, offset);
  const head = 12 + tables.length * 16;
  const out = new Uint8Array(tables.reduce((size, table) => size + ((table.length + 3) & ~3), head));
  const to = new DataView(out.buffer);
  out.set(bytes.subarray(offset, offset + 12));
  let at = head;
  tables.forEach((table, index) => {
    const entry = 12 + index * 16;
    for (let k = 0; k < 4; k++) to.setUint8(entry + k, table.tag.charCodeAt(k));
    to.setUint32(entry + 4, table.checksum); to.setUint32(entry + 8, at); to.setUint32(entry + 12, table.length);
    out.set(bytes.subarray(table.offset, table.offset + table.length), at);
    at += (table.length + 3) & ~3;
  });
  return out;
}

export const cjkFontPath = (workspace: string) => join(workspace, ".bench", "fonts", "cjk.otf");

/** Makes <workspace>/.bench/fonts/cjk.otf when it is not there. Returns where it came from. */
export function ensureFonts(workspace: string, demo?: string): string {
  const target = cjkFontPath(workspace);
  try { if (statSync(target).size > 0) return "kept"; } catch { /* not made yet */ }
  mkdirSync(join(workspace, ".bench", "fonts"), { recursive: true });
  for (const collection of COLLECTIONS) {
    try {
      const bytes = new Uint8Array(readFileSync(collection));
      const faces = collectionFaces(bytes);
      // The first semibold face: W6 reads well at 12 px and holds up as a 54 px number's neighbour.
      const face = faces.find(item => item.weight >= 500) ?? faces[0];
      if (!face) continue;
      // Written beside the target and renamed: a build never reads half a font.
      writeFileSync(`${target}.part`, extractFace(bytes, face.offset));
      renameSync(`${target}.part`, target);
      return collection;
    } catch { /* the next source */ }
  }
  for (const font of SINGLE) {
    if (!existsSync(font)) continue;
    try { symlinkSync(font, target); return font; } catch { /* the next source */ }
  }
  if (demo && existsSync(demo)) { copyFileSync(demo, target); return demo; }
  return "none";
}
