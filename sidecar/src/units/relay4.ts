import { Relay4 } from "../chips/relay4.ts";
import type { UnitType } from "./unit.ts";

export const relay4: UnitType = {
  id: "relay4", name: "4-Relay", sku: "U097",
  blurb: "Four mains-rated relays with status LEDs",
  use: "Switching lamps, pumps, fans: anything with a plug.",
  port: "A", addresses: [0x26], size: [112, 23, 18],
  inputs: [],
  driver: "kit/drivers/relay4.ts",
  datasheet: `4-Relay = STM32F030 (0x26) on Port A: 4 relays (AC 250 V / DC 28 V, 10 A), each with an LED.
The firmware acts on a write when the transaction ends, and does not answer a read after a repeated START:
  select a register with its own script [write(register)], then read with a second script [receive([u8])]. Never read(register, ...).
  0x10  R/W  bit 0: LED mode. 0 = manual (bits 4..7 of 0x11 drive the LEDs), 1 = sync (each LED follows its relay).
  0x11  R/W  bit n (0..3): relay n+1, 1 = on.  bit 4+n: LED n+1, 1 = lit (manual mode).
To switch one relay: read 0x11, change its bit, write 0x11 back. Writing 0x11 = 0x00 opens all four.
Power-on state: mode 0, all relays off. Shares 0x26 with Mini Scales: only one of the two can be on the port.`,
  create() {
    const chip = new Relay4();
    return {
      chips: [chip],
      set() {},
      state() { return { relays: chip.relays, leds: chip.leds, sync: chip.sync }; },
    };
  },
};
