import { expect, test } from "bun:test";
import { Rig, bytes, receive, transact, unanswered, write } from "./harness.ts";

test("4-Relay: identify, relays, LEDs, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("relay4", "identify")).toBe(false);
  const unit = rig.plug("relay4");
  expect(unit.state(rig.now)).toEqual({ relays: [false, false, false, false], leds: [false, false, false, false], sync: false });
  expect(await rig.call("relay4", "identify")).toBe(true);
  // A Mini Scales would answer on the same address; this is not one.
  expect(await rig.call("scales", "identify")).toBe(false);
  expect(unit.state(rig.now).sync).toBe(true);

  await rig.call("relay4", "set", 0, true);
  await rig.call("relay4", "set", 3, true);
  expect(await rig.call("relay4", "read")).toEqual([true, false, false, true]);
  expect(unit.state(rig.now)).toEqual({ relays: [true, false, false, true], leds: [true, false, false, true], sync: true });
  await rig.call("relay4", "set", 0, false);
  expect(unit.state(rig.now).relays).toEqual([false, false, false, true]);

  // Manual LEDs: the relays stay as they are.
  await rig.call("relay4", "setSync", false);
  await rig.call("relay4", "setLed", 1, true);
  expect(unit.state(rig.now)).toEqual({ relays: [false, false, false, true], leds: [false, true, false, false], sync: false });
  await rig.call("relay4", "setAll", true);
  expect(unit.state(rig.now)).toMatchObject({ relays: [true, true, true, true], leds: [false, true, false, false] });
  await rig.call("relay4", "setAll", false);
  expect(await rig.call("relay4", "read")).toEqual([false, false, false, false]);

  rig.unplug(unit);
  await unanswered(rig, "relay4", "set", 0, true);
  await unanswered(rig, "relay4", "read");
});

test("4-Relay registers, as M5Stack's library drives them", async () => {
  const rig = await Rig.start();
  const unit = rig.plug("relay4");
  // Init(sync): mode, then all off. relayWrite: read 0x11, change a bit, write it back.
  transact(rig, 0x26, [write(0x10, 1)]);
  transact(rig, 0x26, [write(0x11, 0)]);
  transact(rig, 0x26, [write(0x11)]);
  const control = transact(rig, 0x26, [receive([bytes(1)])]).data[0]!;
  transact(rig, 0x26, [write(0x11, control | (1 << 2))]);
  expect(unit.state(rig.now)).toEqual({ relays: [false, false, true, false], leds: [false, false, true, false], sync: true });
  // ledAll in manual mode: the high nibble.
  transact(rig, 0x26, [write(0x10, 0)]);
  transact(rig, 0x26, [write(0x11, 0xf0)]);
  expect(unit.state(rig.now)).toEqual({ relays: [false, false, false, false], leds: [true, true, true, true], sync: false });
});
