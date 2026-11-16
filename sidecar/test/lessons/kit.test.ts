// The kit's channel codec (kit/ui/channel.ts), which every project carries
// and both realms of an app import: records and commands as bytes.
import "./env.ts";
import { describe, expect, test } from "bun:test";
import { commands, record, tail } from "../../../kit/ui/channel.ts";

describe("record", () => {
  const State = record({ ok: "bool", celsius: "f32", count: "u32", level: "i16", history: "f32[4]", marks: "u8[3]", name: "utf8[12]" });

  test("has a fixed size and an empty value", () => {
    expect(State.bytes).toBe(1 + 4 + 4 + 2 + 16 + 3 + 13);
    expect(State.empty()).toEqual({ ok: false, celsius: 0, count: 0, level: 0, history: [0, 0, 0, 0], marks: [0, 0, 0], name: "" });
  });

  test("a value comes back as it went in", () => {
    const bytes = State.encode({ ok: true, celsius: 24.5, count: 4_000_000_000, level: -1234, history: [1.5, -2.25, 3, 4], marks: [1, 2, 3], name: "员工卡 #7" });
    expect(bytes.length).toBe(State.bytes);
    expect(State.decode(bytes)).toEqual({ ok: true, celsius: 24.5, count: 4_000_000_000, level: -1234, history: [1.5, -2.25, 3, 4], marks: [1, 2, 3], name: "员工卡 #7" });
  });

  test("missing fields are zero; short lists are padded; whole numbers stay in range", () => {
    const value = State.decode(State.encode({ celsius: 1, history: [9], marks: [300, -5], level: 99_999 }));
    expect(value.ok).toBe(false);
    expect(value.history).toEqual([9, 0, 0, 0]);
    expect(value.marks).toEqual([255, 0, 0]);
    expect(value.level).toBe(32767);
    expect(State.decode(State.encode({ level: 1.6 })).level).toBe(2);
  });

  test("an f32 keeps NaN: a gap in a chart's history", () => {
    const value = State.decode(State.encode({ celsius: Number.NaN, history: [Number.NaN, 1, Number.NaN, 2] }));
    expect(value.celsius).toBeNaN();
    expect(value.history.map(Number.isNaN)).toEqual([true, false, true, false]);
    expect(State.decode(State.encode({ count: Number.NaN })).count).toBe(0);
    expect(tail([1, 2], 4).map(item => Number.isNaN(item) ? "gap" : item)).toEqual(["gap", "gap", 1, 2]);
    expect(tail([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  test("a text is cut at a whole character", () => {
    expect(State.decode(State.encode({ name: "温湿度气压模块" })).name).toBe("温湿度气");     // 12 bytes: four characters of three
    expect(State.decode(State.encode({ name: "abcdefghijklmnop" })).name).toBe("abcdefghijkl");
  });

  test("a buffer that is too small is refused; bytes that are too short decode as empty", () => {
    expect(() => State.encode({}, new Uint8Array(8))).toThrow(RangeError);
    expect(State.decode(new Uint8Array(3))).toEqual(State.empty());
    expect(() => record({ wrong: "float" as never })).toThrow(/no type/);
    expect(() => record({ text: "utf8" as never })).toThrow(/size/);
  });

  test("encodes into a given buffer and decodes a view into a larger one", () => {
    const buffer = new Uint8Array(256);
    expect(State.encode({ celsius: 7 }, buffer)).toBe(buffer);
    expect(State.decode(buffer.subarray(0, 256)).celsius).toBe(7);
  });
});

describe("commands", () => {
  const Command = commands({ reset: {}, setAlarm: { celsius: "f32", on: "bool" }, rename: { text: "utf8[8]" } });

  test("one byte says which, the fields follow", () => {
    expect(Command.bytes).toBe(1 + 9);
    expect(Array.from(Command.encode("reset"))).toEqual([1]);
    expect(Command.decode(Command.encode("reset"))).toEqual({ name: "reset" });
    expect(Command.decode(Command.encode("setAlarm", { celsius: 30.5, on: true }))).toEqual({ name: "setAlarm", celsius: 30.5, on: true });
  });

  test("bytes that are no command decode as undefined", () => {
    expect(Command.decode(new Uint8Array(0))).toBeUndefined();
    expect(Command.decode(Uint8Array.of(0))).toBeUndefined();
    expect(Command.decode(Uint8Array.of(9, 1, 2))).toBeUndefined();
    expect(Command.decode(Uint8Array.of(2, 0))).toBeUndefined();      // setAlarm without its fields
    expect(() => (Command.encode as (name: string) => Uint8Array)("nope")).toThrow(/no command/);
    expect(() => commands({ rename: { name: "utf8[8]" } })).toThrow(/"name"/);   // decode() uses that key for the command
    expect(Command.decode(Command.encode("rename", { text: "备用钥匙" }))).toEqual({ name: "rename", text: "备用" });
  });
});
