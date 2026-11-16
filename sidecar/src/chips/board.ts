// The chips on the Tab5's own bus (`sys`: G31 SDA, G32 SCL, 400 kHz) that an
// app drives from its worker: the BMI270 motion sensor, the RX8130CE clock
// and the INA226 power monitor. The room moves the board (tilt, shake) and
// the battery through `set`.
import { RegisterChip, type I2CBus } from "../sim/i2c.ts";
import { Lagged, Noise, clamp } from "./util.ts";

/** Bosch BMI270: accelerometer and gyroscope. The driver uploads an 8 KiB
 *  configuration blob to INIT_DATA before the part reports "initialised". */
export class Bmi270 extends RegisterChip {
  /** Acceleration in g, board axes: x to the right edge, y to the top edge, z out of the screen. */
  accel: [number, number, number] = [0, -0.5, 0.866];
  /** Angular rate, degrees a second. */
  gyro: [number, number, number] = [0, 0, 0];
  private readonly noise = new Noise(0xb270);
  private configBytes = 0;
  private initialised = false;
  constructor() { super(0x68, "BMI270"); }
  override reset(now: number): void {
    super.reset(now);
    this.reg[0x00] = 0x24;        // CHIP_ID
    this.reg[0x40] = 0xa8;        // ACC_CONF
    this.reg[0x41] = 0x02;        // ACC_RANGE: +-8 g
    this.reg[0x42] = 0xa9;        // GYR_CONF
    this.reg[0x43] = 0x00;        // GYR_RANGE: +-2000 dps
    this.reg[0x7c] = 0x03;        // PWR_CONF
    this.configBytes = 0; this.initialised = false;
  }
  protected override store(register: number, value: number, now: number): void {
    if (register === 0x7e) { if (value === 0xb6) this.reset(now); return; }  // CMD: soft reset
    if (register === 0x5e) { ++this.configBytes; return; }                   // INIT_DATA (burst)
    if (register === 0x59) { if (value === 1 && this.configBytes >= 4096) this.initialised = true; this.reg[0x59] = value; return; }
    this.reg[register] = value;
  }
  // A burst write to INIT_DATA does not advance the register pointer.
  override write(data: Uint8Array, now: number): boolean {
    if (data.length > 1 && data[0] === 0x5e) { this.configBytes += data.length - 1; this.pointer = 0x5e; return true; }
    return super.write(data, now);
  }
  protected override latch(register: number, length: number, _now: number): void {
    if (register > 0x17 || register + length <= 0x0c) return;
    const accRange = [2, 4, 8, 16][this.reg[0x41]! & 3]!;
    const gyrRange = [2000, 1000, 500, 250, 125][this.reg[0x43]! & 7] ?? 2000;
    const put = (offset: number, value: number) => {
      const raw = clamp(Math.round(value), -32768, 32767) & 0xffff;
      this.reg[offset] = raw & 0xff; this.reg[offset + 1] = raw >> 8;
    };
    const accOn = (this.reg[0x7d]! & 0x04) !== 0, gyrOn = (this.reg[0x7d]! & 0x02) !== 0;
    for (let i = 0; i < 3; i++) {
      put(0x0c + i * 2, accOn ? (this.accel[i]! + this.noise.gauss() * 0.002) * 32768 / accRange : 0);
      put(0x12 + i * 2, gyrOn ? (this.gyro[i]! + this.noise.gauss() * 0.05) * 32768 / gyrRange : 0);
    }
  }
  protected override load(register: number, _now: number): number {
    if (register === 0x21) return this.initialised ? 0x01 : 0x00;  // INTERNAL_STATUS: init ok
    if (register === 0x03) return 0xc0;                             // STATUS: data ready
    return this.reg[register]!;
  }
}

const bcd = (value: number) => ((Math.floor(value / 10) % 10) << 4) | (value % 10);

/** Epson RX8130CE real-time clock: BCD time at 0x10..0x16, kept by the host's clock. */
export class Rx8130 extends RegisterChip {
  /** Seconds the clock is ahead of the host's. */
  offsetSeconds = 0;
  constructor() { super(0x32, "RX8130CE"); }
  override reset(now: number): void { super.reset(now); this.reg[0x1d] = 0x00; this.reg[0x1e] = 0x00; this.reg[0x1f] = 0x00; }
  protected override latch(register: number, length: number): void {
    if (register > 0x16 || register + length <= 0x10) return;
    const date = new Date(Date.now() + this.offsetSeconds * 1000);
    this.reg[0x10] = bcd(date.getSeconds()); this.reg[0x11] = bcd(date.getMinutes()); this.reg[0x12] = bcd(date.getHours());
    this.reg[0x13] = 1 << date.getDay(); this.reg[0x14] = bcd(date.getDate()); this.reg[0x15] = bcd(date.getMonth() + 1);
    this.reg[0x16] = bcd(date.getFullYear() % 100);
  }
  protected override store(register: number, value: number): void {
    if (register >= 0x10 && register <= 0x16) {
      // Setting the time: keep the difference to the host's clock.
      this.reg[register] = value;
      if (register === 0x16 || register === 0x10) {
        const un = (v: number) => (v >> 4) * 10 + (v & 15);
        const set = new Date(2000 + un(this.reg[0x16]!), un(this.reg[0x15]!) - 1, un(this.reg[0x14]!), un(this.reg[0x12]!), un(this.reg[0x11]!), un(this.reg[0x10]!));
        if (!Number.isNaN(set.getTime()) && this.reg[0x15]) this.offsetSeconds = Math.round((set.getTime() - Date.now()) / 1000);
      }
      return;
    }
    this.reg[register] = value;
  }
}

/** TI INA226 on the battery rail: 16-bit big-endian registers, 1.25 mV a bit of bus voltage. */
export class Ina226 extends RegisterChip {
  readonly volts = new Lagged(7.9, 2);
  /** Positive while the pack discharges. */
  readonly amps = new Lagged(0.42, 0.5);
  private readonly noise = new Noise(0x1a26);
  constructor() { super(0x41, "INA226"); }
  private words = new Uint16Array(256);
  override reset(now: number): void {
    super.reset(now);
    this.words.fill(0);
    this.words[0x00] = 0x4127; this.words[0xfe] = 0x5449; this.words[0xff] = 0x2260;
  }
  override write(data: Uint8Array, _now: number): boolean {
    if (!data.length) return true;
    this.pointer = data[0]!;
    if (data.length >= 3) {
      const value = (data[1]! << 8) | data[2]!;
      if (this.pointer === 0x00 && value & 0x8000) this.reset(_now);
      else if (this.pointer === 0x00 || this.pointer === 0x05 || this.pointer === 0x06 || this.pointer === 0x07) this.words[this.pointer] = value;
    }
    return true;
  }
  override read(length: number, now: number): Uint8Array {
    const volts = this.volts.read(now) + this.noise.gauss() * 0.002, amps = this.amps.read(now) + this.noise.gauss() * 0.003;
    const calibration = this.words[0x05]!;
    // The Tab5's shunt is 5 milliohm; shunt LSB 2.5 uV.
    const shunt = clamp(Math.round(amps * 0.005 / 2.5e-6), -32768, 32767);
    let value = this.words[this.pointer]!;
    if (this.pointer === 0x01) value = shunt & 0xffff;
    else if (this.pointer === 0x02) value = clamp(Math.round(volts / 1.25e-3), 0, 0x7fff);
    else if (this.pointer === 0x04) value = calibration ? clamp(Math.round(shunt * calibration / 2048), -32768, 32767) & 0xffff : 0;
    else if (this.pointer === 0x03) value = calibration ? clamp(Math.round(Math.abs(shunt * calibration / 2048) * (volts / 1.25e-3) / 20000), 0, 0xffff) : 0;
    const out = new Uint8Array(length);
    if (length > 0) out[0] = value >> 8;
    if (length > 1) out[1] = value & 0xff;
    return out;
  }
}

export function boardChips(bus: I2CBus) {
  const imu = new Bmi270(), rtc = new Rx8130(), power = new Ina226();
  bus.attach(imu); bus.attach(rtc); bus.attach(power);
  return {
    imu, rtc, power,
    set(key: string, value: unknown, now: number): void {
      if (key === "accel" && Array.isArray(value) && value.length === 3) imu.accel = value.map(Number) as [number, number, number];
      else if (key === "gyro" && Array.isArray(value) && value.length === 3) imu.gyro = value.map(Number) as [number, number, number];
      else if (key === "volts") power.volts.set(Number(value), now);
      else if (key === "amps") power.amps.set(Number(value), now);
    },
    state(now: number): Record<string, unknown> {
      return { accel: imu.accel, gyro: imu.gyro, volts: power.volts.read(now), amps: power.amps.read(now) };
    },
  };
}
