// Records between the worker and the UI without DataView code. A channel
// carries bytes; a schema names the fields once and both sides share it
// (put it in protocol.ts and import it from main.tsx and worker.ts).
//
//   export const State = record({ celsius: "f32", humidity: "f32", ok: "bool", history: "f32[60]" });
//   export const Command = commands({ reset: {}, setAlarm: { celsius: "f32" } });
//
//   worker:  io.channel("state").publish(State.encode({ celsius, humidity, ok: true, history }));
//            for await (const bytes of io.channel("commands").observe()) { const c = Command.decode(bytes); ... }
//   UI:      const state = useChannel("state", State);            // ui/index.tsx
//            send("commands", Command.encode("setAlarm", { celsius: 30 }));
//
// Little endian. This file imports nothing, so it loads in both realms.

export type Scalar = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32" | "bool";
type Numeric = Exclude<Scalar, "bool">;
/** A scalar, a fixed list of numbers ("f32[60]"), or a text of at most N bytes of UTF-8 ("utf8[24]"). */
export type Field = Scalar | `${Numeric}[${number}]` | `utf8[${number}]`;
export type Schema = Record<string, Field>;
export type FieldValue<F extends Field> = F extends "bool" ? boolean : F extends Scalar ? number : F extends `utf8[${number}]` ? string : number[];
export type Values<S extends Schema> = { [K in keyof S]: FieldValue<S[K]> };

const SIZE: Record<Scalar, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, bool: 1 };

interface Slot { key: string; kind: Scalar | "utf8"; count: number; list: boolean; offset: number; size: number }

function layout(schema: Schema): { slots: Slot[]; bytes: number } {
  const slots: Slot[] = [];
  let offset = 0;
  for (const [key, field] of Object.entries(schema)) {
    const match = /^(u8|i8|u16|i16|u32|i32|f32|bool|utf8)(?:\[(\d+)\])?$/.exec(field);
    if (!match) throw new Error(`channel: field ${key} has no type "${field}"`);
    const kind = match[1] as Slot["kind"], list = match[2] !== undefined, count = list ? Number(match[2]) : 1;
    if (kind === "utf8" && !list) throw new Error(`channel: field ${key} needs a size, "utf8[24]"`);
    if (list && count < 1) throw new Error(`channel: field ${key} has no room`);
    // A text is one length byte and its bytes; a list is its numbers.
    const size = kind === "utf8" ? 1 + count : SIZE[kind] * count;
    slots.push({ key, kind, count, list, offset, size });
    offset += size;
  }
  return { slots, bytes: offset };
}

function put(view: DataView, kind: Scalar, at: number, value: number | boolean): void {
  const n = typeof value === "boolean" ? (value ? 1 : 0) : Number.isFinite(value) ? value : 0;
  switch (kind) {
    case "u8": view.setUint8(at, clamp(n, 0, 0xff)); break;
    case "i8": view.setInt8(at, clamp(n, -0x80, 0x7f)); break;
    case "u16": view.setUint16(at, clamp(n, 0, 0xffff), true); break;
    case "i16": view.setInt16(at, clamp(n, -0x8000, 0x7fff), true); break;
    case "u32": view.setUint32(at, clamp(n, 0, 0xffffffff), true); break;
    case "i32": view.setInt32(at, clamp(n, -0x80000000, 0x7fffffff), true); break;
    case "f32": view.setFloat32(at, n, true); break;
    case "bool": view.setUint8(at, n ? 1 : 0); break;
  }
}
function get(view: DataView, kind: Scalar, at: number): number | boolean {
  switch (kind) {
    case "u8": return view.getUint8(at);
    case "i8": return view.getInt8(at);
    case "u16": return view.getUint16(at, true);
    case "i16": return view.getInt16(at, true);
    case "u32": return view.getUint32(at, true);
    case "i32": return view.getInt32(at, true);
    case "f32": return view.getFloat32(at, true);
    case "bool": return view.getUint8(at) !== 0;
  }
}
/** Whole numbers are rounded and kept inside the field's range. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

/** UTF-8 without TextEncoder (the worker realm has none), cut at a character boundary. */
function utf8(text: string, limit: number): number[] {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const bytes = cp < 0x80 ? [cp]
      : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
      : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
      : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    if (out.length + bytes.length > limit) break;
    out.push(...bytes);
  }
  return out;
}
function text(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = at; i < at + length;) {
    const b = bytes[i]!;
    const extra = b < 0x80 ? 0 : b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3;
    let cp = extra === 0 ? b : b & (0x3f >> extra);
    for (let k = 1; k <= extra; ++k) cp = (cp << 6) | (bytes[i + k]! & 63);
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

export interface RecordCodec<S extends Schema> {
  /** The record's size: the channel's `recordBytes` must be at least this. */
  readonly bytes: number;
  /** A record with every field at zero, false, "" or a list of zeros. */
  empty(): Values<S>;
  /** Missing fields are written as zero. A list shorter than its field is padded with zeros at the end. */
  encode(value: Partial<Values<S>>, into?: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): Values<S>;
}

/** A fixed layout of named fields, in the order written. */
export function record<const S extends Schema>(schema: S): RecordCodec<S> {
  const { slots, bytes } = layout(schema);
  const empty = () => {
    const value: Record<string, unknown> = {};
    for (const slot of slots) value[slot.key] = slot.kind === "utf8" ? "" : slot.list ? new Array<number>(slot.count).fill(0) : slot.kind === "bool" ? false : 0;
    return value as Values<S>;
  };
  return {
    bytes, empty,
    encode(value, into = new Uint8Array(bytes)) {
      if (into.length < bytes) throw new RangeError(`channel: the record needs ${bytes} bytes, the buffer has ${into.length}`);
      into.fill(0, 0, bytes);
      const view = new DataView(into.buffer, into.byteOffset, into.byteLength);
      for (const slot of slots) {
        const given = (value as Record<string, unknown>)[slot.key];
        if (given === undefined || given === null) continue;
        if (slot.kind === "utf8") {
          const encoded = utf8(String(given), slot.count);
          into[slot.offset] = encoded.length;
          into.set(encoded, slot.offset + 1);
        } else if (slot.list) {
          const list = given as ArrayLike<number>;
          for (let i = 0; i < Math.min(slot.count, list.length); ++i) put(view, slot.kind, slot.offset + i * SIZE[slot.kind], list[i]!);
        } else put(view, slot.kind, slot.offset, given as number | boolean);
      }
      return into;
    },
    decode(source) {
      if (source.length < bytes) return empty();
      const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
      const value: Record<string, unknown> = {};
      for (const slot of slots) {
        if (slot.kind === "utf8") value[slot.key] = text(source, slot.offset + 1, Math.min(source[slot.offset]!, slot.count));
        else if (slot.list) {
          const list: number[] = [];
          for (let i = 0; i < slot.count; ++i) list.push(get(view, slot.kind, slot.offset + i * SIZE[slot.kind]) as number);
          value[slot.key] = list;
        } else value[slot.key] = get(view, slot.kind, slot.offset);
      }
      return value as Values<S>;
    },
  };
}

export type CommandSet = Record<string, Schema>;
export type CommandOf<C extends CommandSet> = { [K in keyof C]: { name: K } & Values<C[K]> }[keyof C];

export interface CommandCodec<C extends CommandSet> {
  /** The longest command: the channel's `recordBytes` must be at least this. */
  readonly bytes: number;
  encode<K extends keyof C & string>(name: K, ...args: {} extends Values<C[K]> ? [value?: Values<C[K]>] : [value: Values<C[K]>]): Uint8Array;
  /** The command with its fields, or undefined for bytes that are none of them. */
  decode(bytes: Uint8Array): CommandOf<C> | undefined;
}

/** Named commands with their own fields: one byte says which, the fields follow. */
export function commands<const C extends CommandSet>(set: C): CommandCodec<C> {
  const names = Object.keys(set);
  if (names.length > 255) throw new Error("channel: at most 255 commands");
  const codecs = names.map(name => record(set[name]!));
  const bytes = 1 + Math.max(0, ...codecs.map(codec => codec.bytes));
  return {
    bytes,
    encode(name, ...args) {
      const index = names.indexOf(name);
      if (index < 0) throw new Error(`channel: no command ${name}`);
      const codec = codecs[index]!, out = new Uint8Array(1 + codec.bytes);
      out[0] = index + 1;
      codec.encode((args[0] ?? {}) as never, out.subarray(1));
      return out;
    },
    decode(source) {
      const index = (source[0] ?? 0) - 1, codec = codecs[index];
      if (!codec || source.length < 1 + codec.bytes) return undefined;
      return { name: names[index]!, ...codec.decode(source.subarray(1)) } as CommandOf<C>;
    },
  };
}

/** The last `count` values of a growing list, oldest first, for a chart field ("f32[60]"). */
export function tail(values: readonly number[], count: number, fill = Number.NaN): number[] {
  const out = values.slice(-count);
  while (out.length < count) out.unshift(fill);
  return out;
}
