// Unit Encoder (U135): a 30-detent rotary encoder with a push switch and two
// SK6812 LEDs behind an STM32F030 at 0x40. The register map is M5Stack's
// (M5UnitEncoder_Firmware, Unit-Encoder_Protocol.pdf); what each register
// does was read from the disassembly of firmware v1.1:
//
//   0x00  W    mode: 0 (default) counts with the timer in quadrature mode,
//              four counts a cycle of the A/B signals; 1 counts the rising
//              edges of A, upwards whichever way the knob turns. A change of
//              mode zeroes the counter.
//   0x10  R/W  the counter, i16 little endian
//   0x20  R    the switch's pin level: 0 pressed, 1 released
//   0x30  W    LED index, R, G, B. Index 1 or 2 is one LED; any other value both.
//   0x40  W    a non-zero byte zeroes the counter
//
// The encoder part has 30 detents and, as modelled here, 15 A/B cycles a
// turn: one detent is two counts in the default mode.
import { Stm32Unit, type Rgb } from "./stm32.ts";

export const COUNTS_PER_DETENT = 2;

export class Encoder extends Stm32Unit {
  pressed = false;
  readonly pixels: [Rgb, Rgb] = [[0, 0, 0], [0, 0, 0]];
  private mode = 0;
  private counter = 0;
  private detents = 0;
  /** Detents turned since the last rising edge of A (mode 1). */
  private travel = 0;
  constructor(address = 0x40) { super(address, "Encoder STM32", "hal", 20, 20); }

  override reset(now: number): void {
    super.reset(now);
    this.mode = 0; this.counter = 0; this.travel = 0;
    for (const pixel of this.pixels) pixel.fill(0);
  }

  /** The knob's position in detents since the unit was made, clockwise positive. */
  turnTo(detents: number): void {
    const moved = detents - this.detents;
    this.detents = detents;
    if (this.mode === 0) {
      this.counter = (this.counter + moved * COUNTS_PER_DETENT) & 0xffff;
    } else {
      this.travel += Math.abs(moved);
      const edges = Math.floor(this.travel / 2);
      this.travel -= edges * 2;
      this.counter = (this.counter + edges) & 0xffff;
    }
  }
  get position(): number { return this.detents; }

  protected receive(length: number, _now: number): void {
    const register = this.rx[0]!;
    if (register === 0x00) {
      const mode = this.rx[1]!;
      if ((mode === 0 || mode === 1) && mode !== this.mode) { this.mode = mode; this.counter = 0; this.travel = 0; }
    } else if (register === 0x10) {
      if (length === 1) this.sendWord(this.counter);
      else this.counter = this.rx[1]! | (this.rx[2]! << 8);
    } else if (register === 0x20) {
      if (length === 1) this.send([this.pressed ? 0 : 1]);
    } else if (register === 0x30) {
      const index = this.rx[1]!, color: Rgb = [this.rx[2]!, this.rx[3]!, this.rx[4]!];
      if (index === 1 || index === 2) this.pixels[index - 1] = color;
      else { this.pixels[0] = [...color]; this.pixels[1] = [...color]; }
    } else if (register === 0x40) {
      if (this.rx[1]) this.counter = 0;
    }
  }
}
