import { MiniScale } from "../chips/miniscale.ts";
import { clamp } from "../chips/util.ts";
import { follow, type UnitType } from "./unit.ts";

export const scales: UnitType = {
  id: "scales", name: "Mini Scales", sku: "U177",
  blurb: "Weight up to 5 kg, with a button and an RGB LED",
  use: "A kitchen scale, a coffee dose timer, counting parts by weight.",
  port: "A", addresses: [0x26], size: [40, 24, 18],
  inputs: [
    { key: "grams", label: "Load on the pan", unit: "g", min: 0, max: 5000, default: 0 },
    { key: "button", label: "Button pressed", unit: "", min: 0, max: 1, default: 0, kind: "switch" },
  ],
  driver: "kit/drivers/scales.ts",
  datasheet: `Mini Scales = STM32F030 + HX711 + 5 kg load cell (0x26) on Port A, one button, one SK6812 LED.
A read returns from the selected register to the end of its group. Select the register with [write(register)], then [receive(...)];
this firmware also answers read(register, ...) after a repeated START. Multi-byte values are little endian.
  0x00  R    raw ADC, i32
  0x10  R    weight in grams, f32 = (raw - offset) / gap
  0x20  R    button: 0 = pressed, 1 = released
  0x30  R/W  LED: R, G, B (3 bytes)
  0x40  R/W  gap, f32: raw counts a gram (factory calibrated, kept in flash). gap = (raw at 100 g - raw at 0 g) / 100.
  0x50  W    write 1: take the present raw value as the offset (tare)
  0x60  R    weight * 100, i32
  0x70  R    weight as text, zero terminated, at most 15 characters
  0x80  R/W  filters, 3 bytes: low-pass on (0..1, default 1), averaging level (0..50, default 10), EMA alpha (0..99, default 10)
  0xFE  R    firmware version      0xFF  R/W  I2C address
The load cell settles in about 0.3 s after the load changes; readings carry a few hundredths of a gram of noise.
The unit takes its offset when it powers up. Shares 0x26 with 4-Relay: only one of the two can be on the port.`,
  create() {
    const chip = new MiniScale(), seen = new Set<string>();
    return {
      chips: [chip],
      set(key, value, now) {
        const number = Number(value);
        if (key === "button") chip.pressed = !!number;
        else if (key === "grams" && Number.isFinite(number)) follow(seen, key, chip.grams, clamp(number, 0, 7500), now);
      },
      state(now) { return { grams: chip.grams.read(now), button: chip.pressed ? 1 : 0, led: [...chip.led] }; },
    };
  },
};
