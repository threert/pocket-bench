import { env3 } from "./env3.ts";
import { sonic } from "./sonic.ts";
import type { UnitType } from "./unit.ts";

export const UNITS: UnitType[] = [env3, sonic];
export const unitType = (id: string): UnitType | undefined => UNITS.find(unit => unit.id === id);
export type { UnitType, UnitInstance, UnitInput } from "./unit.ts";
