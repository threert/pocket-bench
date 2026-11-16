// The checks of a lesson's steps: data (types.ts) evaluated against a view of
// the live bench. `then` and `hold` remember what they saw between two
// evaluations in a Memory the caller keeps for the step being checked.
import type { BenchView, Check, Compare, Source } from "./types.ts";

export type Memory = Map<string, unknown>;

const KINDS = ["plugged", "running", "changed", "text", "shows", "input", "output", "all", "any", "then", "hold", "not"] as const;
type Kind = typeof KINDS[number];

export function kindOf(check: Check): Kind {
  const found = KINDS.filter(kind => kind in (check as object));
  if (found.length !== 1) throw new Error(`a check has exactly one of ${KINDS.join(", ")}: ${JSON.stringify(check)}`);
  return found[0]!;
}

export interface ParsedSource { unit: string; key: string; index: number | undefined }
export function parseSource(source: string): ParsedSource {
  const match = /^([a-z0-9]+)\.([A-Za-z0-9_]+)(?:\[(\d+)\])?$/.exec(source);
  if (!match) throw new Error(`"${source}" is not <unit>.<key> or <unit>.<key>[index]`);
  return { unit: match[1]!, key: match[2]!, index: match[3] === undefined ? undefined : Number(match[3]) };
}

/** The value a source names in one state of the bench; undefined when the Unit is not plugged or has no such key. */
export function read(source: Source, view: Pick<BenchView, "units">, sim: BenchView["sim"]): unknown {
  const { unit, key, index } = parseSource(source);
  let value: unknown;
  if (unit === "tab5") value = sim.tab5?.[key];
  else {
    const plugged = view.units.find(item => item.type === unit);
    if (!plugged) return undefined;
    value = sim[plugged.uid]?.[key];
    if (value === undefined) value = plugged.inputs[key];
  }
  if (index === undefined) return value;
  return Array.isArray(value) ? value[index] : undefined;
}

function compare(value: unknown, rule: Compare): boolean {
  if (rule.eq !== undefined && !same(value, rule.eq)) return false;
  if (rule.ne !== undefined && same(value, rule.ne)) return false;
  const numeric = rule.gt !== undefined || rule.gte !== undefined || rule.lt !== undefined || rule.lte !== undefined || rule.between !== undefined;
  if (!numeric) return true;
  const number = typeof value === "boolean" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return false;
  if (rule.gt !== undefined && !(number > rule.gt)) return false;
  if (rule.gte !== undefined && !(number >= rule.gte)) return false;
  if (rule.lt !== undefined && !(number < rule.lt)) return false;
  if (rule.lte !== undefined && !(number <= rule.lte)) return false;
  if (rule.between !== undefined && !(number >= rule.between[0] && number <= rule.between[1])) return false;
  return true;
}
function same(value: unknown, wanted: number | boolean | string): boolean {
  if (typeof wanted === "boolean") return Boolean(value) === wanted;
  if (typeof wanted === "number") return Number(value) === wanted;
  return String(value) === wanted;
}
const hasCompare = (rule: Compare) => ["gt", "gte", "lt", "lte", "between", "eq", "ne"].some(key => (rule as Record<string, unknown>)[key] !== undefined);

const hexUid = (uid: unknown) => Array.isArray(uid) ? uid.map(byte => Number(byte).toString(16).padStart(2, "0")).join("").toUpperCase() : "";
const plainUid = (text: string) => text.replace(/[^0-9a-fA-F]/g, "").toUpperCase();

function inputHolds(check: Extract<Check, { input: Source }>, value: unknown): boolean {
  if (check.present !== undefined && (value !== null && value !== undefined) !== check.present) return false;
  if (check.uid !== undefined && hexUid((value as { uid?: unknown } | null)?.uid) !== plainUid(check.uid)) return false;
  if (hasCompare(check)) return compare(value, check);
  // With nothing to compare with, the value itself is the test: a pressed button, a card.
  return check.present !== undefined || check.uid !== undefined ? true : Boolean(value);
}

const isColour = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(channel => typeof channel === "number");
/** A value as the list of things it holds: a list of relays, of LEDs, or the one value. */
function entries(value: unknown): unknown[] {
  if (isColour(value)) return [value];
  return Array.isArray(value) ? value : [value];
}

function outputHolds(check: Extract<Check, { output: Source }>, value: unknown): boolean {
  if (value === undefined) return false;
  const list = entries(value);
  if (check.on !== undefined && list.some(Boolean) !== check.on) return false;
  if (check.lit !== undefined) {
    const lit = list.some(entry => isColour(entry) ? Math.max(...entry) > (check.min ?? 0) : Number(entry) > (check.min ?? 0));
    if (lit !== check.lit) return false;
  }
  if (check.dominant !== undefined) {
    const channel = "rgb".indexOf(check.dominant);
    const leads = (entry: number[]) => entry[channel]! > (check.min ?? 0) && entry.every((other, index) => index === channel || entry[channel]! >= other * 1.5);
    if (!list.some(entry => isColour(entry) && leads(entry))) return false;
  }
  if (check.near !== undefined) {
    const tolerance = check.tolerance ?? 60;
    if (!list.some(entry => isColour(entry) && entry.every((channel, index) => Math.abs(channel - check.near![index]!) <= tolerance))) return false;
  }
  if (hasCompare(check)) return compare(value, check);
  return check.on !== undefined || check.lit !== undefined || check.near !== undefined || check.dominant !== undefined ? true : list.some(Boolean);
}

/** The states of the last `seconds`, the present one last. */
function window(view: BenchView, seconds: number): BenchView["sim"][] {
  const from = view.at - seconds * 1000;
  return [...view.recent.filter(sample => sample.at >= from && sample.at <= view.at).map(sample => sample.sim), view.sim];
}

/** Every number written on the screen. `pattern`'s first group says which. */
export function numbersOn(texts: readonly string[], pattern?: string): number[] {
  const normal = texts.map(text => text.replace(/−/g, "-"));
  const found: number[] = [];
  if (pattern) {
    for (const text of [...normal, normal.join(" ")]) {
      for (const match of text.matchAll(new RegExp(pattern, "gi"))) {
        const number = Number(match[1]);
        if (match[1] !== undefined && match[1] !== "" && Number.isFinite(number)) found.push(number);
      }
    }
    return found;
  }
  for (const text of normal) for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) found.push(Number(match[0]));
  return found;
}

export function evaluate(check: Check, view: BenchView, memory: Memory = new Map(), path = "$"): boolean {
  switch (kindOf(check)) {
    case "plugged": return view.units.some(unit => unit.type === (check as { plugged: string }).plugged);
    case "running": return view.running;
    case "changed": return view.changed;
    case "text": {
      const { text, flags } = check as Extract<Check, { text: string }>;
      const pattern = new RegExp(text, flags ?? "i");
      return view.texts.some(line => pattern.test(line)) || pattern.test(view.texts.join(" "));
    }
    case "shows": {
      const rule = check as Extract<Check, { shows: Source | number }>;
      const value = typeof rule.shows === "number" ? rule.shows : read(rule.shows, view, view.sim);
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      const wanted = value * (rule.scale ?? 1) + (rule.offset ?? 0);
      const allowed = Math.max(rule.tolerance, Math.abs(wanted) * (rule.percent ?? 0) / 100);
      return numbersOn(view.texts, rule.pattern).some(number => Math.abs(number - wanted) <= allowed);
    }
    case "input": {
      const rule = check as Extract<Check, { input: Source }>;
      return window(view, rule.withinSeconds ?? 1.5).some(sim => inputHolds(rule, read(rule.input, view, sim)));
    }
    case "output": {
      const rule = check as Extract<Check, { output: Source }>;
      return window(view, rule.withinSeconds ?? 1.5).some(sim => outputHolds(rule, read(rule.output, view, sim)));
    }
    case "all": {
      // Every part is evaluated, so that a `then` or a `hold` among them keeps counting.
      const results = (check as { all: Check[] }).all.map((part, index) => evaluate(part, view, memory, `${path}.${index}`));
      return results.every(Boolean);
    }
    case "any": {
      const results = (check as { any: Check[] }).any.map((part, index) => evaluate(part, view, memory, `${path}.${index}`));
      return results.some(Boolean);
    }
    case "then": {
      const parts = (check as { then: Check[] }).then;
      let reached = (memory.get(path) as number | undefined) ?? 0;
      // One part an evaluation: the next one has to hold at a later moment.
      if (reached < parts.length && evaluate(parts[reached]!, view, memory, `${path}.${reached}`)) memory.set(path, ++reached);
      return reached >= parts.length;
    }
    case "hold": {
      const { hold, seconds } = check as Extract<Check, { hold: Check }>;
      if (!evaluate(hold, view, memory, `${path}.0`)) { memory.delete(path); return false; }
      const since = (memory.get(path) as number | undefined) ?? view.at;
      memory.set(path, since);
      return view.at - since >= seconds * 1000;
    }
    case "not": return !evaluate((check as { not: Check }).not, view, memory, `${path}.0`);
  }
}

const rule = (check: Compare): string => {
  const parts: string[] = [];
  if (check.gt !== undefined) parts.push(`> ${check.gt}`);
  if (check.gte !== undefined) parts.push(`>= ${check.gte}`);
  if (check.lt !== undefined) parts.push(`< ${check.lt}`);
  if (check.lte !== undefined) parts.push(`<= ${check.lte}`);
  if (check.between !== undefined) parts.push(`in ${check.between[0]}..${check.between[1]}`);
  if (check.eq !== undefined) parts.push(`= ${String(check.eq)}`);
  if (check.ne !== undefined) parts.push(`!= ${String(check.ne)}`);
  return parts.join(" and ");
};

/** One line that says what a check wants. */
export function describe(check: Check): string {
  switch (kindOf(check)) {
    case "plugged": return `${(check as { plugged: string }).plugged} is plugged in`;
    case "running": return "the app builds and runs";
    case "changed": return "the project's sources changed";
    case "text": return `the screen says /${(check as { text: string }).text}/`;
    case "shows": {
      const c = check as Extract<Check, { shows: Source | number }>;
      return `the screen shows ${c.shows}${c.scale !== undefined ? ` x ${c.scale}` : ""}${c.offset !== undefined ? ` + ${c.offset}` : ""} within ${c.tolerance}`;
    }
    case "input": {
      const c = check as Extract<Check, { input: Source }>;
      const parts = [c.present === undefined ? "" : c.present ? "is there" : "is away", c.uid ? `has UID ${c.uid}` : "", rule(c)].filter(Boolean);
      return `${c.input} ${parts.join(", ") || "is set"}`;
    }
    case "output": {
      const c = check as Extract<Check, { output: Source }>;
      const parts = [c.on === undefined ? "" : c.on ? "is on" : "is off", c.lit === undefined ? "" : c.lit ? "is lit" : "is dark", c.dominant ? `is mostly ${c.dominant}` : "", c.near ? `is near rgb(${c.near.join(", ")})` : "", rule(c)].filter(Boolean);
      return `${c.output} ${parts.join(", ") || "is on"}`;
    }
    case "all": return "all of these";
    case "any": return "one of these";
    case "then": return "these, one after the other";
    case "hold": return `for ${(check as { seconds: number }).seconds} s without a break`;
    case "not": return "not this";
  }
}

export interface Explained { path: string; depth: number; says: string; ok: boolean }
/** The check as lines, each with whether it holds now. It does not advance `then` or `hold`. */
export function explain(check: Check, view: BenchView, memory: Memory = new Map()): Explained[] {
  const lines: Explained[] = [];
  const walk = (node: Check, path: string, depth: number) => {
    const kind = kindOf(node);
    lines.push({ path, depth, says: describe(node), ok: evaluate(node, view, new Map(memory), path) });
    const children = kind === "all" ? (node as { all: Check[] }).all : kind === "any" ? (node as { any: Check[] }).any
      : kind === "then" ? (node as { then: Check[] }).then : kind === "hold" ? [(node as { hold: Check }).hold] : kind === "not" ? [(node as { not: Check }).not] : [];
    children.forEach((child, index) => walk(child, `${path}.${index}`, depth + 1));
  };
  walk(check, "$", 0);
  return lines;
}

/** What is wrong with a check as data: unknown shapes, sources no Unit has,
 *  expressions that do not compile. `keys` lists what each Unit reports. */
export function validate(check: Check, keys: Record<string, readonly string[]>): string[] {
  const problems: string[] = [];
  const source = (value: string) => {
    try {
      const { unit, key } = parseSource(value);
      if (!keys[unit]) problems.push(`${value}: no Unit "${unit}"`);
      else if (!keys[unit]!.includes(key)) problems.push(`${value}: ${unit} reports ${keys[unit]!.join(", ")}`);
    } catch (error) { problems.push(String((error as Error).message)); }
  };
  const expression = (value: string, flags?: string) => { try { new RegExp(value, flags); } catch (error) { problems.push(`/${value}/: ${(error as Error).message}`); } };
  const walk = (node: Check) => {
    let kind: Kind;
    try { kind = kindOf(node); } catch (error) { problems.push((error as Error).message); return; }
    switch (kind) {
      case "plugged": if (!keys[(node as { plugged: string }).plugged]) problems.push(`plugged: no Unit "${(node as { plugged: string }).plugged}"`); break;
      case "text": expression((node as { text: string }).text, (node as { flags?: string }).flags ?? "i"); break;
      case "shows": {
        const c = node as Extract<Check, { shows: Source | number }>;
        if (typeof c.shows !== "number") source(c.shows);
        if (!(c.tolerance >= 0)) problems.push(`${c.shows}: shows needs a tolerance`);
        if (c.pattern !== undefined) { expression(c.pattern); if (!/\((?!\?)/.test(c.pattern)) problems.push(`/${c.pattern}/: the pattern needs a group around the number`); }
        break;
      }
      case "input": source((node as { input: string }).input); break;
      case "output": source((node as { output: string }).output); break;
      case "all": case "any": case "then": {
        const parts = (node as Record<string, Check[]>)[kind]!;
        if (!Array.isArray(parts) || !parts.length) problems.push(`${kind}: needs a list of checks`);
        else parts.forEach(walk);
        break;
      }
      case "hold": if (!((node as { seconds: number }).seconds > 0)) problems.push("hold: needs seconds"); walk((node as { hold: Check }).hold); break;
      case "not": walk((node as { not: Check }).not); break;
      default: break;
    }
  };
  walk(check);
  return problems;
}
