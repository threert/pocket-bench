import { Mlx90614 } from "../chips/mlx90614.ts";
import { follow, type UnitType } from "./unit.ts";

export const ncir: UnitType = {
  id: "ncir", name: "NCIR", sku: "U028",
  blurb: "Contactless infrared thermometer",
  use: "A forehead thermometer, a kettle watcher, spotting a hot part.",
  port: "A", addresses: [0x5a], size: [32, 24, 8.6],
  inputs: [
    { key: "objectCelsius", label: "Surface in front of the sensor", unit: "°C", min: -40, max: 300, default: 24 },
    { key: "ambientCelsius", label: "Sensor's own temperature", unit: "°C", min: -10, max: 60, default: 24.5 },
  ],
  driver: "kit/drivers/ncir.ts",
  datasheet: `NCIR = MLX90614ESF-BAA (0x5A) on Port A, 90 degree field of view, 100 kHz SMBus.
SMBus "read word": command byte, repeated START, then 3 bytes: low, high, PEC. In one script: [read(command, [bytes(3)])].
A STOP between the command and the read ends the transaction: [write(command)] then [receive(...)] in two scripts does not work here.
  0x06  ambient temperature TA      0x07  object temperature TOBJ1
  0x24  emissivity (EEPROM, 0xFFFF = 1.0)      0x2E  SMBus address (EEPROM)
celsius = (low | high << 8) * 0.02 - 273.15. Resolution 0.02 C; object -70..380 C, ambient -40..125 C. Bit 15 of TOBJ1 set = error.
PEC = CRC-8 (polynomial 0x07, initial 0) over the 5 bytes 0xB4, command, 0xB5, low, high (0xB4 = address << 1).
Do not send command 0xFF: it puts the part to sleep until its power cycles.`,
  create() {
    const chip = new Mlx90614(), seen = new Set<string>();
    return {
      chips: [chip],
      set(key, value, now) {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        if (key === "objectCelsius") follow(seen, key, chip.object, number, now);
        else if (key === "ambientCelsius") follow(seen, key, chip.ambient, number, now);
      },
      state(now) { return { objectCelsius: chip.object.read(now), ambientCelsius: chip.ambient.read(now) }; },
    };
  },
};
