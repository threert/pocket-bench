import { Bh1750 } from "../chips/bh1750.ts";
import { clamp } from "../chips/util.ts";
import { follow, type UnitType } from "./unit.ts";

export const dlight: UnitType = {
  id: "dlight", name: "DLight", sku: "U136",
  blurb: "Ambient light in lux",
  use: "A light meter, a lamp that follows daylight, a drawer alarm.",
  port: "A", addresses: [0x23], size: [32, 24, 8],
  inputs: [{ key: "lux", label: "Light on the sensor", unit: "lx", min: 0, max: 65535, default: 320 }],
  driver: "kit/drivers/dlight.ts",
  datasheet: `DLight = BH1750FVI (0x23) on Port A. No registers: write one opcode byte, read 2 data bytes with a bare read.
  [write(opcode)] sends the opcode (it travels as the "register" byte); [receive([u16be])] reads the result.
Opcodes: 0x00 power down, 0x01 power on, 0x07 reset the data register (only while powered),
  0x10 continuous high resolution (1 lx steps, 120 ms a conversion, 180 ms at most),
  0x11 continuous high resolution 2 (0.5 lx, 120 ms), 0x13 continuous low resolution (4 lx, 16 ms),
  0x20 / 0x21 / 0x23 the same once, after which the part powers down (the result stays readable),
  0x40 | MT[7:5] and 0x60 | MT[4:0]: measurement time register MT, 31..254, default 69; time and sensitivity scale with MT / 69.
lux = raw / 1.2 (modes 0x10, 0x13, 0x20, 0x23), raw / 2.4 (0x11, 0x21), each times 69 / MT.
The data register reads 0 until the first conversion ends: wait 180 ms after the mode opcode. In mode 0x10 the reading tops out at 54612 lx (raw 65535).`,
  create() {
    const chip = new Bh1750(), seen = new Set<string>();
    return {
      chips: [chip],
      set(key, value, now) { if (key === "lux" && Number.isFinite(Number(value))) follow(seen, key, chip.lux, clamp(Number(value), 0, 200_000), now); },
      state(now) { return { lux: chip.lux.read(now) }; },
    };
  },
};
