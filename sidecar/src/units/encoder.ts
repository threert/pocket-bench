import { COUNTS_PER_DETENT, Encoder } from "../chips/encoder.ts";
import type { UnitType } from "./unit.ts";

export const encoder: UnitType = {
  id: "encoder", name: "Encoder", sku: "U135",
  blurb: "Endless knob with a push switch and two RGB LEDs",
  use: "A volume knob, a menu wheel, fine adjustment of a value.",
  port: "A", addresses: [0x40], size: [32, 24, 25.4],
  inputs: [
    { key: "steps", label: "Detents turned, clockwise positive", unit: "", min: -100_000, max: 100_000, default: 0, integer: true },
    { key: "button", label: "Knob pressed", unit: "", min: 0, max: 1, default: 0, kind: "switch" },
  ],
  driver: "kit/drivers/encoder.ts",
  datasheet: `Encoder = STM32F030 (0x40) on Port A: a rotary encoder with 30 detents a turn, its push switch, 2 SK6812 LEDs.
The firmware acts on a write when the transaction ends, and does not answer a read after a repeated START:
  select a register with its own script [write(register)], then read with a second script [receive(...)]. Never read(register, ...).
  0x00  W    mode: 0 = quadrature (default), 1 = count pulses upwards only. Changing it zeroes the counter.
  0x10  R/W  counter, i16 little endian. ${COUNTS_PER_DETENT} counts a detent in mode 0, so detents = counter / ${COUNTS_PER_DETENT}. It wraps at +-32768.
  0x20  R    switch: 0 = pressed, 1 = released
  0x30  W    4 bytes: LED index, R, G, B. Index 1 or 2 = one LED, 0 = both.
  0x40  W    write 1: zero the counter
The counter is 0 at power-on, whatever the knob's position.`,
  create() {
    const chip = new Encoder();
    return {
      chips: [chip],
      set(key, value) {
        const number = Number(value);
        if (key === "button") chip.pressed = !!number;
        else if (key === "steps" && Number.isFinite(number)) chip.turnTo(Math.round(number));
      },
      state() { return { steps: chip.position, button: chip.pressed ? 1 : 0, leds: chip.pixels.map(pixel => [...pixel]) }; },
    };
  },
};
