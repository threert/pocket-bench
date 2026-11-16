import { Angle8 } from "../chips/angle8.ts";
import { clamp } from "../chips/util.ts";
import { follow, type UnitType } from "./unit.ts";

export const angle8: UnitType = {
  id: "angle8", name: "8Angle", sku: "U154",
  blurb: "Eight knobs, a switch, nine RGB LEDs",
  use: "A mixing desk, a lighting console, eight parameters under your fingers.",
  port: "A", addresses: [0x43], size: [128, 24, 23],
  inputs: [
    { key: "knobs", label: "Knob positions", unit: "", min: 0, max: 1, default: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], kind: "numbers" },
    { key: "switch", label: "Toggle switch", unit: "", min: 0, max: 1, default: 0, kind: "switch" },
  ],
  driver: "kit/drivers/angle8.ts",
  datasheet: `8Angle = STM32F030 (0x43) on Port A: 8 potentiometers, 1 toggle switch, 9 SK6812 LEDs (LED 0..7 under the knobs, LED 8 by the switch).
The firmware acts on a write when the transaction ends, and does not answer a read after a repeated START:
  select a register with its own script [write(register)], then read with a second script [receive(...)]. Never read(register, ...).
Registers (one read returns one value, not a block):
  0x00 + 2n  R  knob n (0..7), 12 bits: 2 bytes little endian, 0..4095
  0x10 + n   R  knob n, 8 bits: 1 byte, 0..255
  0x20       R  switch: 1 byte, 0 or 1
  0x30 + 4n  W  LED n (0..8): 4 bytes R, G, B, brightness (0..100), all four in one write.
                The LED is driven at colour * brightness / 1000, so 255 at brightness 100 is the firmware's full output.
  0xFE       R  firmware version (1)        0xFF  R  I2C address (0x43)
position 0..1 = value / 4095. The 12-bit value has a count or two of noise.`,
  create() {
    const chip = new Angle8(), seen = new Set<string>();
    return {
      chips: [chip],
      set(key, value, now) {
        if (key === "knobs" && Array.isArray(value)) {
          value.slice(0, 8).forEach((position, index) => {
            if (Number.isFinite(Number(position))) follow(seen, `knob${index}`, chip.knobs[index]!, clamp(Number(position), 0, 1), now);
          });
        } else if (key === "switch") chip.toggle = Number(value) ? 1 : 0;
      },
      state(now) {
        return { knobs: chip.knobs.map(knob => knob.read(now)), switch: chip.toggle, leds: chip.pixels.map(pixel => [...pixel]) };
      },
    };
  },
};
