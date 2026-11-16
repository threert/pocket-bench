// Unit 4-Relay (U097): four relays, each with an LED, behind an STM32F030 at
// 0x26. The register map is from M5Stack's documentation and its Arduino and
// UiFlow libraries (Unit_4RELAY, relay4.py):
//
//   0x10  R/W  bit 0: LED mode. 0 = the LED bits of 0x11 drive the LEDs,
//              1 = each LED follows its relay.
//   0x11  R/W  bits 0..3: relay 1..4 (1 = coil on). bits 4..7: LED 1..4.
//
// The firmware of this unit is not published. Its I2C slave is taken to be
// the one of M5Stack's other STM32F030 units of that generation (see
// stm32.ts): a write acts at STOP, a read returns from the selected register.
import { Stm32Unit } from "./stm32.ts";

export class Relay4 extends Stm32Unit {
  private mode = 0;
  private control = 0;
  constructor(address = 0x26) { super(address, "4-Relay STM32", "hal", 16, 16); }

  override reset(now: number): void { super.reset(now); this.mode = 0; this.control = 0; }

  get sync(): boolean { return (this.mode & 1) === 1; }
  get relays(): boolean[] { return [0, 1, 2, 3].map(bit => (this.control & (1 << bit)) !== 0); }
  get leds(): boolean[] { return this.sync ? this.relays : [4, 5, 6, 7].map(bit => (this.control & (1 << bit)) !== 0); }

  protected receive(length: number, _now: number): void {
    const register = this.rx[0]!;
    if (register !== 0x10 && register !== 0x11) return;
    if (length === 1) {
      this.send(register === 0x10 ? [this.mode, this.control] : [this.control]);
      return;
    }
    // Bytes after the register byte fill 0x10, then 0x11.
    let at = register;
    for (const byte of this.rx.subarray(1, length)) {
      if (at === 0x10) this.mode = byte;
      else if (at === 0x11) this.control = byte;
      ++at;
    }
  }
}
