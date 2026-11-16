// Messages between the sidecar and the thread that runs one simulated Tab5.
import type { AppBuild, LogLine } from "./tab5.ts";
import type { BusTrace } from "./i2c.ts";

export interface PluggedUnit {
  /** The instance's id in the room ("env3-1"). */
  uid: string;
  type: string;
  /** What the room last set on it. */
  inputs: Record<string, unknown>;
}

export type ToSim =
  | { t: "boot"; build: AppBuild; units: PluggedUnit[]; network: boolean; board?: Partial<BoardState> }
  | { t: "touch"; point: { x: number; y: number } | null }
  | { t: "text"; text: string }
  | { t: "plug"; unit: PluggedUnit }
  | { t: "unplug"; uid: string }
  | { t: "set"; uid: string; key: string; value: unknown }
  | { t: "board"; key: string; value: unknown }
  | { t: "pause"; paused: boolean }
  | { t: "trace"; on: boolean }
  | { t: "inspect"; id: number; want: "tree" | "frame" };

export interface BoardState {
  brightness: number;
  volume: number;
  switches: Record<string, boolean>;
  pins: Record<string, number>;
}

export type FromSim =
  | { t: "ready"; title: string }
  | { t: "frame"; n: number; rgba: ArrayBuffer }
  | { t: "logs"; lines: LogLine[] }
  | { t: "failure"; domain: "ui" | "worker" | "host"; message: string; stack: string }
  | { t: "state"; at: number; frames: number; turns: number; units: Record<string, Record<string, unknown>>; board: BoardState; addresses: number[] }
  | { t: "bus"; entries: BusTrace[] }
  | { t: "inspected"; id: number; tree?: unknown; rgba?: ArrayBuffer };
