// A virtual I2C bus. Chips are modelled at the transaction level: what the
// controller writes after the address, and what it reads. A PocketJS worker
// reaches the bus through its `i2c` node with scripts of read / write /
// receive steps (framework/src/io/i2c.ts); the same bytes travel here as on
// the wires of the Tab5.

export interface I2CChip {
  /** 7-bit address. */
  readonly address: number;
  /** A name for traces ("SHT30"). */
  readonly name: string;
  /** Bytes written after the address was acknowledged. False = NACK. */
  write(data: Uint8Array, now: number): boolean;
  /** Bytes read after address+R. Undefined = the address was not acknowledged. */
  read(length: number, now: number): Uint8Array | undefined;
  /** Whether the address is acknowledged at all right now (default: yes). */
  acks?(now: number): boolean;
  /** The transaction ended with STOP. Parts that act on a write only then, or
   *  that tell a repeated START from a new transaction, hook this. */
  stop?(now: number): void;
  /** The bus lost power or the unit was plugged in: back to the power-on state. */
  reset?(now: number): void;
}

/** Status values of contracts/spec/worker.ts ResourceStatus. */
export const Status = { ok: 0, failed: -1, cancelled: -2, unknown: -3, busy: -4, invalid: -5, unsupported: -6 } as const;

export interface Transfer {
  status: number;
  data: Uint8Array;
  /** Bus time the transfer took, microseconds. */
  micros: number;
}

export interface BusTrace {
  at: number;
  address: number;
  op: "probe" | "write" | "read" | "receive";
  register?: number;
  bytes: number[];
  ack: boolean;
}

export class I2CBus {
  private readonly chips = new Map<number, I2CChip>();
  /** Port A is fed from the EXT 5V rail: without it nothing answers. */
  powered = true;
  trace: ((entry: BusTrace) => void) | undefined;

  constructor(readonly name: string, readonly hz: number) {}

  attach(chip: I2CChip, now = 0): void {
    if (this.chips.has(chip.address)) throw new Error(`${this.name}: address 0x${chip.address.toString(16)} is taken by ${this.chips.get(chip.address)!.name}`);
    this.chips.set(chip.address, chip);
    chip.reset?.(now);
  }
  detach(chip: I2CChip): void {
    if (this.chips.get(chip.address) === chip) this.chips.delete(chip.address);
  }
  has(address: number): boolean { return this.chips.has(address); }
  addresses(): number[] { return [...this.chips.keys()].sort((a, b) => a - b); }
  setPower(on: boolean, now: number): void {
    if (on && !this.powered) for (const chip of this.chips.values()) chip.reset?.(now);
    this.powered = on;
  }

  private chip(address: number, now: number): I2CChip | undefined {
    if (!this.powered) return undefined;
    const chip = this.chips.get(address);
    if (!chip) return undefined;
    if (chip.acks && !chip.acks(now)) return undefined;
    return chip;
  }
  private byteMicros(bytes: number): number {
    // 9 clocks a byte, plus start and stop.
    return Math.ceil(((bytes * 9 + 2) * 1_000_000) / this.hz);
  }

  probe(address: number, now: number): Transfer {
    const chip = this.chip(address, now);
    this.trace?.({ at: now, address, op: "probe", bytes: [], ack: !!chip });
    chip?.stop?.(now);
    return { status: chip ? Status.ok : Status.failed, data: new Uint8Array(0), micros: this.byteMicros(1) };
  }

  /** One script as io/i2c.ts encodeI2CScript packs it: its steps follow each
   *  other after repeated STARTs, and one STOP ends it. */
  run(address: number, payload: Uint8Array, now: number): Transfer {
    const transfer = this.steps(address, payload, now);
    this.chip(address, now + transfer.micros)?.stop?.(now + transfer.micros);
    return transfer;
  }
  private steps(address: number, payload: Uint8Array, now: number): Transfer {
    if (payload.length < 4 || payload[0] !== 1) return { status: Status.invalid, data: new Uint8Array(0), micros: 0 };
    const steps = payload[1]!;
    const out: number[] = [];
    let offset = 4, micros = 0, t = now;
    for (let i = 0; i < steps; i++) {
      if (offset + 4 > payload.length) return { status: Status.invalid, data: new Uint8Array(0), micros };
      const op = payload[offset]!, register = payload[offset + 1]!;
      const length = payload[offset + 2]! | (payload[offset + 3]! << 8);
      offset += 4;
      const chip = this.chip(address, t);
      if (op === 2) {
        const data = payload.subarray(offset, offset + length);
        offset += length;
        const frame = new Uint8Array(1 + length);
        frame[0] = register; frame.set(data, 1);
        const ack = !!chip && chip.write(frame, t);
        this.trace?.({ at: t, address, op: "write", register, bytes: [...data], ack });
        const cost = this.byteMicros(2 + length);
        micros += cost; t += cost;
        if (!ack) return { status: Status.failed, data: new Uint8Array(0), micros };
      } else if (op === 1) {
        const ack = !!chip && chip.write(Uint8Array.of(register), t);
        const data = ack ? chip!.read(length, t) : undefined;
        this.trace?.({ at: t, address, op: "read", register, bytes: data ? [...data] : [], ack: !!data });
        const cost = this.byteMicros(3 + length);
        micros += cost; t += cost;
        if (!data) return { status: Status.failed, data: new Uint8Array(0), micros };
        for (let n = 0; n < length; n++) out.push(data[n] ?? 0xff);
      } else if (op === 3) {
        const data = chip ? chip.read(length, t) : undefined;
        this.trace?.({ at: t, address, op: "receive", bytes: data ? [...data] : [], ack: !!data });
        const cost = this.byteMicros(1 + length);
        micros += cost; t += cost;
        if (!data) return { status: Status.failed, data: new Uint8Array(0), micros };
        for (let n = 0; n < length; n++) out.push(data[n] ?? 0xff);
      } else {
        return { status: Status.invalid, data: new Uint8Array(0), micros };
      }
    }
    return { status: Status.ok, data: Uint8Array.from(out), micros };
  }
}

/** A chip that is a table of registers with an auto-incrementing pointer:
 *  a write sets the pointer and stores what follows; a read returns from the
 *  pointer on. Subclasses hook `load` and `store` for registers with meaning. */
export class RegisterChip implements I2CChip {
  protected readonly reg = new Uint8Array(256);
  protected pointer = 0;
  constructor(readonly address: number, readonly name: string) {}
  /** The value a read of `register` returns. */
  protected load(register: number, _now: number): number { return this.reg[register]!; }
  /** A write of `value` to `register`. */
  protected store(register: number, value: number, _now: number): void { this.reg[register] = value; }
  /** Called once before a read burst, to latch multi-byte values. */
  protected latch(_register: number, _length: number, _now: number): void {}
  write(data: Uint8Array, now: number): boolean {
    if (!data.length) return true;
    this.pointer = data[0]!;
    for (let i = 1; i < data.length; i++) this.store((this.pointer + i - 1) & 0xff, data[i]!, now);
    if (data.length > 1) this.pointer = (this.pointer + data.length - 1) & 0xff;
    return true;
  }
  read(length: number, now: number): Uint8Array {
    this.latch(this.pointer, length, now);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.load((this.pointer + i) & 0xff, now);
    return out;
  }
  reset(_now: number): void { this.reg.fill(0); this.pointer = 0; }
}

/** A chip that only acknowledges its address: the parts of the board an app
 *  sees in a scan but does not drive through the worker. */
export class PresentChip implements I2CChip {
  constructor(readonly address: number, readonly name: string) {}
  write(): boolean { return true; }
  read(length: number): Uint8Array { return new Uint8Array(length); }
}
