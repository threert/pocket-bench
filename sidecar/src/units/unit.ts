// A Unit: a part the user plugs into the Tab5. It owns the chips that answer
// on the bus, takes what the room does to it (`set`: warm air, a card held
// over it, a turned knob) and reports what it does to the room (`state`:
// LEDs, relays, and the true values its sensors are looking at).
import type { I2CChip } from "../sim/i2c.ts";
import type { Lagged } from "../chips/util.ts";

export interface UnitInput {
  key: string;
  label: string;
  unit: string;
  /** The range of the number, or of each number of a list. */
  min: number;
  max: number;
  /** What a newly plugged unit is given. */
  default: number | number[] | null;
  /** What the room sets: one number (when absent), a level that is 0 or 1,
   *  a list of numbers, or a card (`CardSpec` of chips/picc.ts, or null). */
  kind?: "number" | "switch" | "numbers" | "card";
  /** Whole numbers only. */
  integer?: boolean;
}

/** Gives a lagged quantity its input. The first value of a key is where the
 *  world already was when the unit appeared, so it takes it at once. */
export function follow(seen: Set<string>, key: string, quantity: Lagged, value: number, now: number): void {
  if (seen.has(key)) quantity.set(value, now);
  else { seen.add(key); quantity.jump(value, now); }
}

export interface UnitInstance {
  readonly chips: I2CChip[];
  /** The room acts on the unit. Unknown keys are ignored. */
  set(key: string, value: unknown, now: number): void;
  /** What the room and the panels show: outputs, and the truth behind the sensors. */
  state(now: number): Record<string, unknown>;
}

export interface UnitType {
  /** Catalogue id ("env3"). */
  id: string;
  name: string;
  sku: string;
  /** One line for the shelf label. */
  blurb: string;
  /** What it is good for, in the catalogue card. */
  use: string;
  /** Which socket it takes. Port A units share the I2C bus. */
  port: "A";
  addresses: number[];
  /** Body size in millimetres: width (along the cable), depth, height. */
  size: [number, number, number];
  inputs: UnitInput[];
  /** Register-level notes for whoever writes the driver (the agent reads this). */
  datasheet: string;
  /** Path of a ready driver in the kit, when there is one. */
  driver?: string;
  create(): UnitInstance;
}
