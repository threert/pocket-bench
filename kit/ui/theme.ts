// The look every screen shares: two palettes, spacing, radii, type sizes.
// Components read `theme()`; `setTheme("light")` repaints all of them.
import { createSignal } from "solid-js";

/** Every character the app may draw is baked into its fonts at build time,
 *  from the string literals of the source. A text built at run time (a
 *  number, a card's name read from the card) can only use characters that
 *  appear in some literal: this one covers printable ASCII, the degree sign
 *  and a few symbols. Keep `export const GLYPHS = ...` reachable from
 *  main.tsx (importing anything from ui/ does that). */
export const GLYPHS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  "°±×÷·•…–—←↑→↓≤≥≈µΩ✓✗";
export interface Palette {
  /** The screen behind everything. */
  bg: string;
  /** A card. */
  panel: string;
  /** A control on a card: a button, a track. */
  raised: string;
  /** Hairlines and empty tracks. */
  line: string;
  text: string;
  /** Labels and secondary text. */
  muted: string;
  /** Hints, axis labels. */
  faint: string;
  /** The one colour that means "this app": primary buttons, live values. */
  accent: string;
  /** Text on an accent, good, warn or bad fill. */
  onAccent: string;
  good: string;
  warn: string;
  bad: string;
  info: string;
}

export const dark: Palette = {
  bg: "#0b0f14", panel: "#151b24", raised: "#222b38", line: "#2c3746",
  text: "#f2f5f8", muted: "#9aa7b8", faint: "#5f6e82",
  accent: "#4c9dff", onAccent: "#06121f", good: "#3ddc97", warn: "#ffb020", bad: "#ff5d5d", info: "#5ad1e6",
};

export const light: Palette = {
  bg: "#eef1f5", panel: "#ffffff", raised: "#e6ebf1", line: "#d3dae3",
  text: "#10161d", muted: "#566273", faint: "#8f9bab",
  accent: "#1f6feb", onAccent: "#ffffff", good: "#0f9960", warn: "#b76e00", bad: "#d92d20", info: "#0b7a94",
};

const [current, setCurrent] = createSignal<Palette>(dark);

/** The palette in use. Call it where a colour is needed so the node follows a change of theme. */
export const theme = current;
export function setTheme(next: "dark" | "light" | Palette): void {
  setCurrent(next === "dark" ? dark : next === "light" ? light : next);
}
export const isDark = () => current() === dark;

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info";
/** The colour of a tone in the palette in use. */
export function toneColor(tone: Tone | undefined): string {
  const palette = current();
  switch (tone) {
    case "accent": return palette.accent;
    case "good": return palette.good;
    case "warn": return palette.warn;
    case "bad": return palette.bad;
    case "info": return palette.info;
    default: return palette.muted;
  }
}
/** A colour with an alpha, 0..1: `alpha("#4c9dff", 0.2)` is "#4c9dff33". */
export function alpha(color: string, amount: number): string {
  const hex = color.length === 4 ? `#${[...color.slice(1)].map(c => c + c).join("")}` : color.slice(0, 7);
  return `${hex}${Math.round(Math.max(0, Math.min(1, amount)) * 255).toString(16).padStart(2, "0")}`;
}

/** Two colours blended: `mix(theme().panel, theme().bad, 0.15)` is a panel with a red tint.
 *  Use it for a tinted card: a see-through fill on a node that also has a border shows the border's colour. */
export function mix(from: string, to: string, amount: number): string {
  const parse = (color: string) => { const hex = color.length === 4 ? [...color.slice(1)].map(c => c + c).join("") : color.slice(1, 7); return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16)); };
  const a = parse(from), b = parse(to), t = Math.max(0, Math.min(1, amount));
  return `#${a.map((channel, index) => Math.round(channel + (b[index]! - channel) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The screen is 640 x 360 logical pixels, shown at 1280 x 720. */
export const SCREEN = { w: 640, h: 360 } as const;
/** Steps of 4 px. `space.md` is the gap between cards and the padding of a screen. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
/** The smallest thing a finger hits reliably on the 5-inch screen. */
export const TOUCH = 44;

/** Font sizes the framework bakes: there is no other size. */
export type Size = "2xs" | "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "4xl" | "5xl";
/** Pixels of each size, and the height of its line box. */
export const FONT: Record<Size, { px: number; line: number }> = {
  "2xs": { px: 10, line: 13 }, xs: { px: 12, line: 15 }, sm: { px: 14, line: 18 }, base: { px: 16, line: 20 },
  lg: { px: 18, line: 22 }, xl: { px: 20, line: 24 }, "2xl": { px: 24, line: 29 }, "4xl": { px: 36, line: 43 }, "5xl": { px: 54, line: 64 },
};
