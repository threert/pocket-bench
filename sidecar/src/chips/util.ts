// Helpers shared by the chip models.

/** Sensirion CRC-8: polynomial 0x31, initial value 0xFF. */
export function crc8(bytes: ArrayLike<number>, offset = 0, length = bytes.length - offset): number {
  let crc = 0xff;
  for (let i = offset; i < offset + length; ++i) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; ++bit) crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** A physical quantity that follows its target with a first-order lag, the
 *  way a sensor's package follows the air around it. Evaluated lazily at the
 *  time of a read. */
export class Lagged {
  private value: number;
  private at = 0;
  constructor(public target: number, private readonly tauSeconds: number) { this.value = target; }
  set(target: number, now: number): void { this.read(now); this.target = target; }
  /** Jumps to a value with no lag (a reset, a first placement). */
  jump(value: number, now: number): void { this.value = value; this.target = value; this.at = now; }
  read(now: number): number {
    const dt = Math.max(0, (now - this.at) / 1e6);
    this.at = now;
    if (this.tauSeconds <= 0) this.value = this.target;
    else this.value += (this.target - this.value) * (1 - Math.exp(-dt / this.tauSeconds));
    return this.value;
  }
}

/** Deterministic noise: a small LCG, so two runs of a lesson read alike. */
export class Noise {
  private state: number;
  constructor(seed = 0x2f6e2b1) { this.state = seed >>> 0; }
  /** Uniform in -1..1. */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x80000000 - 1;
  }
  /** Roughly normal, sigma 1 (sum of three uniforms). */
  gauss(): number { return (this.next() + this.next() + this.next()) * 0.98; }
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
