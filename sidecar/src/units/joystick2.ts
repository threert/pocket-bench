import { Joystick2 } from "../chips/joystick2.ts";
import { clamp } from "../chips/util.ts";
import { follow, type UnitType } from "./unit.ts";

export const joystick2: UnitType = {
  id: "joystick2", name: "Joystick2", sku: "U024-V2",
  blurb: "Hall-effect stick with a push button and an RGB LED",
  use: "Steering a cursor, a game character, a pan-tilt head.",
  port: "A", addresses: [0x63], size: [40, 24, 23.9],
  inputs: [
    { key: "x", label: "Stick, left to right", unit: "", min: -1, max: 1, default: 0 },
    { key: "y", label: "Stick, down to up", unit: "", min: -1, max: 1, default: 0 },
    { key: "button", label: "Stick pressed", unit: "", min: 0, max: 1, default: 0, kind: "switch" },
  ],
  driver: "kit/drivers/joystick2.ts",
  datasheet: `Joystick2 = STM32G030 (0x63) on Port A: a Hall-effect stick (X, Y), its push button, one WS2812 LED.
A read returns from the selected register to the end of its group. Select the register with [write(register)], then [receive(...)];
this firmware also answers read(register, ...) after a repeated START.
  0x00..0x03  R    X then Y raw, u16 little endian each, 0..65535, about 33665 at rest
  0x10..0x11  R    X, Y raw as 8 bits
  0x20        R    button: 0 = pressed, 1 = released
  0x30..0x33  R/W  LED: blue, green, red, 0 (the little-endian bytes of 0x00RRGGBB). No brightness byte.
  0x40..0x4F  R/W  calibration, 8 x u16 LE: X neg min, X neg max, X pos min, X pos max, then Y (defaults 130, 33330, 34000, 65440). Kept in flash.
  0x50..0x53  R    X then Y calibrated, i16 little endian each, -4095..4095; exactly 0 inside the dead band
  0x60..0x61  R    X, Y calibrated as i8, -127..127
  0xFC bootloader version, 0xFE firmware version (1), 0xFF I2C address
deflection -1..1 = calibrated / 4095. Which way is positive depends on how the unit is mounted.`,
  create() {
    const chip = new Joystick2(), seen = new Set<string>();
    return {
      chips: [chip],
      set(key, value, now) {
        const number = Number(value);
        if (key === "button") chip.pressed = !!number;
        else if ((key === "x" || key === "y") && Number.isFinite(number)) follow(seen, key, chip[key], clamp(number, -1, 1), now);
      },
      state(now) {
        return { x: chip.x.read(now), y: chip.y.read(now), button: chip.pressed ? 1 : 0, led: chip.led };
      },
    };
  },
};
