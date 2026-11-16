import { angle8 } from "./angle8.ts";
import { dlight } from "./dlight.ts";
import { encoder } from "./encoder.ts";
import { env3 } from "./env3.ts";
import { joystick2 } from "./joystick2.ts";
import { ncir } from "./ncir.ts";
import { relay4 } from "./relay4.ts";
import { rfid2 } from "./rfid2.ts";
import { scales } from "./scales.ts";
import { sonic } from "./sonic.ts";
import type { UnitType } from "./unit.ts";

export const UNITS: UnitType[] = [env3, sonic, rfid2, angle8, joystick2, encoder, dlight, ncir, scales, relay4];
export const unitType = (id: string): UnitType | undefined => UNITS.find(unit => unit.id === id);
export type { UnitType, UnitInstance, UnitInput } from "./unit.ts";
