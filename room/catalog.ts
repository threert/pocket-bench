// The Units the room has: their bodies' sizes and how they sit on a pad. The sidecar's catalogue
// (sidecar/src/units) has the same ids and says what each one is on the bus.
export interface UnitSpec {
  id: string;
  name: string;
  /** Chinese name for labels. */
  zh: string;
  sku: string;
  /** What it is, in a few words (the tray's print). */
  blurb: string;
  /** Body in millimetres: length along the cable (X), depth (Z), height (Y). */
  size: [number, number, number];
  /** The label's colour. */
  tint: string;
  addresses: string;
  /** Stands on its long edge facing the viewer when plugged in (it looks at things in front of it). */
  upright?: boolean;
}

export const UNIT_SPECS: UnitSpec[] = [
  { id: "env3", name: "ENV III", zh: "温湿度气压", sku: "U001-C", blurb: "温度 · 湿度 · 气压", size: [32, 24, 8], tint: "#2f6fd6", addresses: "0x44 0x70" },
  { id: "sonic", name: "ULTRASONIC", zh: "超声波测距", sku: "U098-B1", blurb: "测距 2 cm – 4.5 m", size: [56, 24, 12], tint: "#0f9d8a", addresses: "0x57", upright: true },
  { id: "rfid2", name: "RFID 2", zh: "射频读卡", sku: "U031-B", blurb: "13.56 MHz 读写卡", size: [48, 24, 8], tint: "#d08a12", addresses: "0x28" },
  { id: "angle8", name: "8ANGLE", zh: "八旋钮", sku: "U154", blurb: "8 旋钮 · 开关 · 9 灯", size: [128, 24, 13], tint: "#7a4fd0", addresses: "0x43" },
  { id: "joystick2", name: "JOYSTICK 2", zh: "摇杆", sku: "U024-V2", blurb: "双轴摇杆 · 按键 · 灯", size: [40, 24, 12], tint: "#d0473c", addresses: "0x63" },
  { id: "dlight", name: "DLIGHT", zh: "环境光", sku: "U136", blurb: "照度 1 – 65535 lx", size: [32, 24, 8], tint: "#c9a400", addresses: "0x23" },
  { id: "relay4", name: "4-RELAY", zh: "四路继电器", sku: "U097", blurb: "4 路开关 · 接台灯风扇", size: [80, 56, 18], tint: "#3c4654", addresses: "0x26" },
  { id: "scales", name: "MINI SCALES", zh: "电子秤", sku: "U177", blurb: "称重 0 – 5 kg", size: [40, 24, 14], tint: "#1f8f4e", addresses: "0x26" },
  { id: "ncir", name: "NCIR", zh: "红外测温", sku: "U028", blurb: "非接触测温", size: [32, 24, 8], tint: "#b83a6a", addresses: "0x5A", upright: true },
  { id: "encoder", name: "ENCODER", zh: "旋转编码器", sku: "U135", blurb: "旋钮 · 按键 · 2 灯", size: [32, 24, 12], tint: "#5a6bd8", addresses: "0x40" },
];
export const unitSpec = (id: string) => UNIT_SPECS.find(unit => unit.id === id);

/** The foam tray's pockets, millimetres from the tray's centre: where each Unit rests. */
export const TRAY_SIZE: [number, number] = [264, 214];
export const TRAY_POCKETS: Record<string, [number, number]> = (() => {
  // Three rows, back to front: [ids, the row's centre along Z].
  const rows: [string[], number][] = [
    [["relay4", "angle8"], -62],
    [["sonic", "rfid2", "scales", "joystick2"], 2],
    [["env3", "dlight", "ncir", "encoder"], 52],
  ];
  const out: Record<string, [number, number]> = {};
  for (const [ids, z] of rows) {
    const widths = ids.map(id => UNIT_SPECS.find(unit => unit.id === id)!.size[0]);
    const gap = (TRAY_SIZE[0] - 20 - widths.reduce((a, b) => a + b, 0)) / (ids.length - 1);
    let x = -TRAY_SIZE[0] / 2 + 10;
    ids.forEach((id, i) => { out[id] = [x + widths[i]! / 2, id === "angle8" ? z + 14 : z]; x += widths[i]! + gap; });
  }
  return out;
})();
