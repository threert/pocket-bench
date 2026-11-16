// The I2C slave of the STM32 inside M5Stack's own Units, as their published
// firmware sources implement it. There are two generations, and they differ
// in when a write takes effect:
//
//   "hal" (Unit 8Angle, Unit Encoder; STM32F030, HAL listen mode: i2c_ex.c of
//         M5Unit-8Angle-Internal-FW): the bytes of a write are handed to the
//         firmware when the transaction ends with STOP. It then prepares a
//         reply of a fixed length for the next read. A read after a repeated
//         START finds the register byte unprocessed and the slave not
//         transmitting: it fails here, and M5Stack's libraries always send
//         STOP before they read.
//   "ll"  (Unit Joystick2; STM32G030, LL interrupt handler: i2c_ex.c of
//         M5Unit-Joystick2-Internal-FW): the bytes are handed over at STOP
//         or at the next address match, so a repeated START works. The reply
//         is a ring: reading past its end starts over.
//
// A register the firmware does not know leaves the previous reply in place.
import type { I2CChip } from "../sim/i2c.ts";

export abstract class Stm32Unit implements I2CChip {
  /** The firmware's receive buffer. It is never cleared, so a write shorter
   *  than the firmware expects reads the bytes of an earlier one behind it. */
  protected readonly rx: Uint8Array;
  private received = 0;
  private reply = new Uint8Array(0);
  private cursor = 0;

  constructor(readonly address: number, readonly name: string, private readonly slave: "hal" | "ll",
    rxBytes: number, private readonly txBytes: number) {
    this.rx = new Uint8Array(rxBytes);
  }

  /** The firmware's receive callback: `length` bytes of one write are in `rx`. */
  protected abstract receive(length: number, now: number): void;
  /** The firmware's i2c1_set_send_data: what the next read returns. */
  protected send(bytes: ArrayLike<number>): void {
    this.reply = Uint8Array.from(bytes).subarray(0, this.txBytes);
    this.cursor = 0;
  }
  protected sendWord(value: number): void { this.send([value & 0xff, (value >> 8) & 0xff]); }

  private commit(now: number): void {
    const length = this.received;
    this.received = 0;
    this.receive(length, now);
  }

  write(data: Uint8Array, _now: number): boolean {
    for (const byte of data) if (this.received < this.rx.length) this.rx[this.received++] = byte;
    return true;
  }
  read(length: number, now: number): Uint8Array | undefined {
    if (this.received) {
      // A repeated START: no STOP since the register byte.
      if (this.slave === "hal") return undefined;
      this.commit(now);
    }
    const out = new Uint8Array(length).fill(0xff);
    if (!this.reply.length) return out;
    if (this.slave === "hal") {
      // Bytes past the reply are not the firmware's: the bus reads high.
      out.set(this.reply.subarray(0, length));
    } else {
      for (let i = 0; i < length; i++) out[i] = this.reply[(this.cursor + i) % this.reply.length]!;
      // The peripheral has loaded one more byte by the time the controller NACKs.
      this.cursor = (this.cursor + length + 1) % this.reply.length;
    }
    return out;
  }
  stop(now: number): void { if (this.received) this.commit(now); }
  reset(_now: number): void { this.rx.fill(0); this.received = 0; this.reply = new Uint8Array(0); this.cursor = 0; }
}

/** The firmware's Arduino-style map(): C integer division, optionally limited to the output range. */
export function map(x: number, inMin: number, inMax: number, outMin: number, outMax: number, limit = false): number {
  const value = Math.trunc((x - inMin) * (outMax - outMin) / (inMax - inMin)) + outMin;
  return limit ? Math.min(outMax, Math.max(outMin, value)) : value;
}

export type Rgb = [number, number, number];
