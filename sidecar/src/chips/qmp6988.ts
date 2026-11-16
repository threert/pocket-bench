// QST QMP6988 barometric pressure sensor. The driver reads 25 bytes of OTP
// calibration from 0xA0 and compensates the raw 24-bit temperature and
// pressure words itself, so this model holds a set of coefficients and
// inverts the datasheet's polynomials to produce the raw words of a given
// temperature and pressure.
import { RegisterChip } from "../sim/i2c.ts";
import { Lagged, Noise } from "./util.ts";

// OTP as a part carries it: b00, bt1, bt2, bp1, b11, bp2, b12, b21, bp3, a0, a1, a2.
const OTP = { b00: 372_114, bt1: 2012, bt2: -1433, bp1: 1820, b11: 934, bp2: -611, b12: 421, b21: -208, bp3: 163, a0: 98_760, a1: -1907, a2: 812 };

function coefficients() {
  const k = (a: number, s: number, otp: number) => a + s * otp / 32767;
  return {
    b00: OTP.b00 / 16, bt1: k(1.0e-1, 9.1e-2, OTP.bt1), bt2: k(1.2e-8, 1.2e-6, OTP.bt2), bp1: k(3.3e-2, 1.9e-2, OTP.bp1),
    b11: k(2.1e-7, 1.4e-7, OTP.b11), bp2: k(-6.3e-10, 3.5e-10, OTP.bp2), b12: k(2.9e-13, 7.6e-13, OTP.b12),
    b21: k(2.1e-15, 1.2e-14, OTP.b21), bp3: k(1.3e-16, 7.9e-17, OTP.bp3),
    a0: OTP.a0 / 16, a1: k(-6.3e-3, 4.3e-4, OTP.a1), a2: k(-1.9e-11, 1.2e-10, OTP.a2),
  };
}
const C = coefficients();
const temperature = (dt: number) => C.a0 + C.a1 * dt + C.a2 * dt * dt;
const pressure = (tr: number, dp: number) => C.b00 + C.bt1 * tr + C.bp1 * dp + C.b11 * tr * dp + C.bt2 * tr * tr +
  C.bp2 * dp * dp + C.b12 * dp * tr * tr + C.b21 * dp * dp * tr + C.bp3 * dp * dp * dp;

/** The x in lo..hi where a monotonic f reaches the target. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number): number {
  const rising = f(hi) > f(lo);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < target) === rising) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export class Qmp6988 extends RegisterChip {
  readonly celsius = new Lagged(24.9, 8);
  readonly pascals = new Lagged(101_180, 0.4);
  private readonly noise = new Noise(0x9a11);
  private readyAt = 0;
  constructor(address = 0x70) { super(address, "QMP6988"); }

  override reset(now: number): void {
    super.reset(now);
    this.reg[0xd1] = 0x5c;
    const otp = this.reg.subarray(0xa0, 0xa0 + 25);
    const s16 = (offset: number, value: number) => { otp[offset] = (value >> 8) & 0xff; otp[offset + 1] = value & 0xff; };
    otp[0] = (OTP.b00 >> 12) & 0xff; otp[1] = (OTP.b00 >> 4) & 0xff;
    s16(2, OTP.bt1); s16(4, OTP.bt2); s16(6, OTP.bp1); s16(8, OTP.b11); s16(10, OTP.bp2); s16(12, OTP.b12); s16(14, OTP.b21); s16(16, OTP.bp3);
    otp[18] = (OTP.a0 >> 12) & 0xff; otp[19] = (OTP.a0 >> 4) & 0xff;
    s16(20, OTP.a1); s16(22, OTP.a2);
    otp[24] = ((OTP.b00 & 0x0f) << 4) | (OTP.a0 & 0x0f);
    this.convert(now);
  }

  private convert(now: number): void {
    const tr = (this.celsius.read(now) + this.noise.gauss() * 0.01) * 256;
    const dt = solve(temperature, tr, -8_388_608, 8_388_607);
    const exact = temperature(dt);
    const dp = solve(x => pressure(exact, x), this.pascals.read(now) + this.noise.gauss() * 1.2, -8_388_608, 8_388_607);
    const put = (offset: number, value: number) => {
      const raw = value + 0x800000;
      this.reg[offset] = (raw >> 16) & 0xff; this.reg[offset + 1] = (raw >> 8) & 0xff; this.reg[offset + 2] = raw & 0xff;
    };
    put(0xf7, dp); put(0xfa, dt);
  }

  protected override store(register: number, value: number, now: number): void {
    if (register === 0xe0) { if (value === 0xe6) this.reset(now); return; }
    if (register >= 0xa0 && register <= 0xb8 || register === 0xd1) return; // read only
    this.reg[register] = value;
    if (register === 0xf4) {
      const mode = value & 0b11;
      if (mode === 0b01 || mode === 0b10) {
        // Forced: one conversion, then back to sleep. Oversampling sets its length.
        const osrsT = (value >> 5) & 7, osrsP = (value >> 2) & 7;
        const samples = (osrsT ? 1 << (osrsT - 1) : 0) + (osrsP ? 1 << (osrsP - 1) : 0);
        this.readyAt = now + 1_000 + samples * 1_900;
      }
    }
  }
  protected override load(register: number, now: number): number {
    if (register === 0xf3) return now < this.readyAt ? 0x08 : 0x00;
    if (register === 0xf4) {
      const value = this.reg[0xf4]!;
      // A forced conversion returns the part to sleep; normal mode (0b11) stays.
      return now < this.readyAt || (value & 0b11) === 0b11 ? value : value & ~0b11;
    }
    return this.reg[register]!;
  }
  protected override latch(register: number, _length: number, now: number): void {
    if (register >= 0xf7 && register <= 0xfc && now >= this.readyAt) this.convert(now);
  }
}
