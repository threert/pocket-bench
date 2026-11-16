// The Chinese face of the kit (sidecar/src/lessons/fonts.ts): one face taken
// out of a font collection, and the file the workspace gets.
import "./env.ts";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cjkFontPath, collectionFaces, ensureFonts, extractFace } from "../../src/lessons/fonts.ts";

/** A collection of two faces that share a `head` table and have an `OS/2` each (weights 300 and 600). */
function collection(): Uint8Array {
  const bytes = new Uint8Array(256), view = new DataView(bytes.buffer);
  const tag = (at: number, name: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = name.charCodeAt(i); };
  tag(0, "ttcf"); view.setUint32(4, 0x00010000); view.setUint32(8, 2); view.setUint32(12, 20); view.setUint32(16, 64);
  const face = (at: number, os2: number) => {
    view.setUint32(at, 0x4f54544f); view.setUint16(at + 4, 2);                              // "OTTO", two tables
    tag(at + 12, "OS/2"); view.setUint32(at + 16, 111); view.setUint32(at + 20, os2); view.setUint32(at + 24, 10);
    tag(at + 28, "head"); view.setUint32(at + 32, 222); view.setUint32(at + 36, 140); view.setUint32(at + 40, 7);
  };
  face(20, 108); face(64, 124);
  view.setUint16(108 + 4, 300); view.setUint16(124 + 4, 600);
  bytes.set([1, 2, 3, 4, 5, 6, 7], 140);
  return bytes;
}

describe("a font collection", () => {
  test("lists its faces with their weights", () => {
    expect(collectionFaces(collection())).toEqual([{ offset: 20, weight: 300 }, { offset: 64, weight: 600 }]);
    expect(collectionFaces(new Uint8Array(64))).toEqual([]);           // not a collection
  });

  test("gives one face as a font of its own", () => {
    const font = extractFace(collection(), 64), view = new DataView(font.buffer);
    expect(view.getUint32(0)).toBe(0x4f54544f);
    expect(view.getUint16(4)).toBe(2);
    expect(font.length).toBe(12 + 32 + 12 + 8);                        // directory, OS/2 (10 -> 12), head (7 -> 8)
    expect(String.fromCharCode(...font.subarray(12, 16))).toBe("OS/2");
    expect(view.getUint32(16)).toBe(111);                              // the checksum travels with the table
    expect(view.getUint32(20)).toBe(44);
    expect(view.getUint16(44 + 4)).toBe(600);
    expect(String.fromCharCode(...font.subarray(28, 32))).toBe("head");
    expect(view.getUint32(36)).toBe(56);
    expect(Array.from(font.subarray(56, 63))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("the workspace's font", () => {
  test("is made once, from the first source there is", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pb-lessons-fonts-"));
    try {
      const demo = join(import.meta.dir, "../../../vendor/pocket-m5/third_party/pocketjs/assets/fonts/NotoSansCJK-Demo.otf");
      const source = ensureFonts(workspace, demo);
      expect(source).not.toBe("none");
      expect(existsSync(cjkFontPath(workspace))).toBe(true);
      expect(statSync(cjkFontPath(workspace)).size).toBeGreaterThan(100_000);
      // A font file of one face, whatever it came from: not a collection.
      const magic = new DataView(new Uint8Array(readFileSync(cjkFontPath(workspace))).buffer).getUint32(0);
      expect([0x4f54544f, 0x00010000, 0x74727565]).toContain(magic);
      expect(ensureFonts(workspace, demo)).toBe("kept");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
