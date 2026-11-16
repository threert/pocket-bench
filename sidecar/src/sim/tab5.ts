// One simulated M5Stack Tab5: the UI realm of a PocketJS app on the wasm
// core, its worker realm, the board's two I2C buses and its `device` module.
// The app is the same bundle the Tab5 build produces before bytecode
// compilation: nothing in it knows it is not on the board.
import { bootBundle, type BundleWorld, type SimNode } from "../../../vendor/pocket-m5/third_party/pocketjs/programs/sim/sim.ts";
import { I2CBus, PresentChip, type BusTrace } from "./i2c.ts";
import { WorkerRealm, type UartPort, type WorkerDeclaration, type WorkerLog } from "./worker-realm.ts";

export const SCREEN = { width: 640, height: 360 } as const;
export const FRAME_HZ = 30;
const FRAME_MICROS = Math.round(1_000_000 / FRAME_HZ);

export interface AppBuild {
  /** <output>.js, <output>.pak and <output>.worker.js of a tab5-home build. */
  js: string;
  pak?: string;
  workerJs?: string;
  /** The app's manifest (pocket.app.json). */
  manifest: { id: string; title: string; app: { output: string; tickHz?: number }; domains?: { worker?: WorkerDeclaration } };
  /** The worker declaration as the build resolved it (channel sizes as numbers). */
  worker?: WorkerDeclaration;
}

export interface LogLine { at: number; domain: "ui" | "worker" | "host"; level: string; text: string }

/** The board's own controls, as contracts/spec/device.ts states them. */
export class Board {
  brightness = 80;
  volume = 60;
  switches: Record<string, boolean> = { charge: true, "quick-charge": false, "usb-5v": false, "ext-5v": false, antenna: false };
  ports: Record<string, boolean> = { "usb-c": true, "usb-a": false, headphone: false };
  /** Header pins an app may drive: level, or undefined when released. */
  pins = new Map<number, number>();
  error = "";
  onChange: ((what: string) => void) | undefined;
  static readonly PINS = [0, 1, 49, 50, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 35, 37, 38, 45, 47, 48, 51, 52];
  static readonly SWITCH_LABELS: Record<string, string> = { charge: "Charging", "quick-charge": "Quick charge", "usb-5v": "USB-A 5V", "ext-5v": "Ext 5V", antenna: "External antenna" };

  ops(clock: () => number) {
    const board = this;
    const ok = () => { board.error = ""; return true; };
    const refuse = (why: string) => { board.error = why; return false; };
    return {
      status(): string {
        return JSON.stringify({
          display: { brightness: board.brightness, panel: "ST7123" }, volume: board.volume,
          temperature: 41.5 + Math.sin(clock() / 7e6) * 0.8,
          switches: Object.entries(board.switches).map(([id, on]) => ({ id, label: Board.SWITCH_LABELS[id] ?? id, on })),
          ports: Object.entries(board.ports).map(([id, connected]) => ({ id, label: id, connected })),
          pins: Board.PINS, card: { mounted: false, totalBytes: 0, freeBytes: 0 }, error: board.error,
        });
      },
      setBrightness(percent: number): boolean { board.brightness = Math.max(0, Math.min(100, Math.round(percent))); board.onChange?.("brightness"); return ok(); },
      setVolume(percent: number): boolean { board.volume = Math.max(0, Math.min(100, Math.round(percent))); board.onChange?.("volume"); return ok(); },
      setSwitch(id: string, on: boolean): boolean {
        if (!(id in board.switches)) return refuse(`no switch ${id}`);
        board.switches[id] = !!on; board.onChange?.(`switch:${id}`); return ok();
      },
      setPin(pin: number, level: number): boolean {
        if (!Board.PINS.includes(pin)) return refuse(`pin ${pin} is not on a header`);
        board.pins.set(pin, level ? 1 : 0); board.onChange?.(`pin:${pin}`); return ok();
      },
      releasePin(pin: number): boolean {
        if (!Board.PINS.includes(pin)) return refuse(`pin ${pin} is not on a header`);
        board.pins.delete(pin); board.onChange?.(`pin:${pin}`); return ok();
      },
      listDirectory(): string { return ""; },
      powerOff(): boolean { board.onChange?.("power-off"); return ok(); },
    };
  }
}

export interface Tab5Options {
  build: AppBuild;
  /** Buses outlive an app: units stay plugged in across a rebuild. */
  buses: { sys: I2CBus; porta: I2CBus };
  board: Board;
  uarts?: Record<string, UartPort>;
  network?: boolean;
  log(line: LogLine): void;
}

export class Tab5 {
  now = 0;
  frames = 0;
  private world!: BundleWorld;
  private worker: WorkerRealm | undefined;
  private touch: { x: number; y: number } | null = null;
  private keys: { commit: string }[] = [];
  private seenLogs = 0;
  failure: { domain: "ui" | "worker"; message: string; stack: string } | null = null;

  constructor(private readonly options: Tab5Options) {}

  async boot(): Promise<void> {
    const { build, buses, board, log } = this.options;
    const g = globalThis as Record<string, unknown>;
    const declaration = build.worker ?? build.manifest.domains?.worker;
    if (declaration && build.workerJs) {
      this.worker = new WorkerRealm({
        source: await Bun.file(build.workerJs).text(), name: build.manifest.app.output, declaration, buses,
        uarts: this.options.uarts, network: this.options.network,
        log: (entry: WorkerLog) => log({ at: entry.at, domain: "worker", level: entry.level, text: entry.text }),
      });
      // The host starts the worker before the UI evaluates.
      this.worker.boot();
      g.__pocketWorkerChannels = this.worker.bridge();
    } else {
      g.__pocketWorkerChannels = undefined;
    }
    g.__pocketWorkerChannelFrame = undefined;
    g.device = board.ops(() => this.now);
    board.onChange = what => {
      if (what === "switch:ext-5v") buses.porta.setPower(board.switches["ext-5v"]!, this.now);
    };
    buses.porta.setPower(board.switches["ext-5v"]!, this.now);
    this.world = await bootBundle({
      js: build.js, pak: build.pak, app: build.manifest.app.output, hz: build.manifest.app.tickHz ?? FRAME_HZ,
      viewport: { width: 400, height: 240, auxiliary: [SCREEN.width, SCREEN.height] },
    });
    this.drainLogs();
    this.checkFailure();
  }

  setTouch(point: { x: number; y: number } | null): void { this.touch = point; }
  typeText(text: string): void { this.keys.push({ commit: text }); }

  private drainLogs(): void {
    const logs = this.world.logs;
    for (; this.seenLogs < logs.length; this.seenLogs++) {
      const entry = logs[this.seenLogs]!;
      this.options.log({ at: this.now, domain: "ui", level: entry.level, text: entry.text });
    }
  }
  private checkFailure(): void {
    if (this.failure) return;
    if (this.world.failure) {
      this.failure = { domain: "ui", message: this.world.failure.message, stack: this.world.failure.stack };
      this.options.log({ at: this.now, domain: "ui", level: "error", text: `${this.world.failure.phase} fault: ${this.world.failure.message}` });
    } else if (this.worker?.failure) {
      this.failure = { domain: "worker", ...this.worker.failure };
    }
  }

  /** One frame of the board: the worker's turns that are due, then the UI's frame. */
  async frame(): Promise<boolean> {
    if (this.failure) return false;
    this.now += FRAME_MICROS;
    if (this.worker) {
      await this.worker.runUntil(this.now);
      this.worker.latch();
      (globalThis as { __pocketWorkerChannelFrame?: () => void }).__pocketWorkerChannelFrame?.();
    }
    const text = this.keys.length ? this.keys.splice(0) : undefined;
    this.world.step({ touches: this.touch ? [{ x: this.touch.x, y: this.touch.y }] : [], surface: "auxiliary", text });
    ++this.frames;
    this.drainLogs();
    this.checkFailure();
    return !this.failure;
  }

  /** 640x360 RGBA of the screen. */
  pixels(): Uint8Array { return this.world.pixels("auxiliary").rgba; }
  tree(): SimNode | null { return this.world.tree("auxiliary"); }
  workerTurns(): number { return this.worker?.turns ?? 0; }
}

/** The chips soldered to the board that an I2C scan of `sys` finds. Those an
 *  app drives through the worker are modelled in chips/; the rest only answer. */
export function boardBus(): I2CBus {
  const bus = new I2CBus("sys", 400_000);
  for (const [address, name] of [[0x10, "ES8388"], [0x40, "ES7210"], [0x43, "PI4IOE5V6408 #1"], [0x44, "PI4IOE5V6408 #2"], [0x55, "ST7123 touch"], [0x36, "SC202CS"]] as const) {
    bus.attach(new PresentChip(address, name));
  }
  return bus;
}
export function portABus(): I2CBus { return new I2CBus("porta", 100_000); }
export type { BusTrace };
