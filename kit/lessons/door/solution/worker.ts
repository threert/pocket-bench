// 门禁打卡, the worker. Two Units share Port A and each has its own loop:
//
//   the RFID 2    is polled eight times a second. A card that was not there a moment ago is a
//                 swipe: it is looked up, let in or refused, and written to the log.
//   the 4-Relay   switches the "ON AIR" sign for a card that is let in and the amber beacon
//                 for one that is not, and switches them off again when their time is up.
//
// Either Unit may be missing or pulled while the app runs: its loop says so and keeps looking.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message, now } from "./drivers/bus";
import { Relay4 } from "./drivers/relay4";
import { Rfid2, hexUid } from "./drivers/rfid2";
import { BEACON, BEACON_SECONDS, LOG, SIGN, SIGN_SECONDS, State, Verdict, Who } from "./protocol";

/** The cards this door knows, by UID. Only a card with `allowed` gets in; any other card is a stranger. */
const CARDS: Record<string, { who: number; allowed: boolean }> = {
  "04A31B7C": { who: Who.staff, allowed: true },
  "9E12550D": { who: Who.visitor, allowed: false },
};

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
/** The worker's clock in seconds. */
const seconds = () => now() / 1e6;

/** Until when each relay is to stay on (seconds of the worker's clock). */
let signUntil = 0, beaconUntil = 0;
/** Until when the last swipe stays on the screen after its card is gone. */
let showUntil = 0;

function publish(): void {
  state.now = seconds();
  channel.publish(State.encode(state));
}

/** A card arrived over the reader. */
function swipe(uid: Uint8Array): void {
  const known = CARDS[hexUid(uid)];
  const who = known?.who ?? Who.unknown, verdict = known?.allowed ? Verdict.granted : Verdict.refused;
  const at = seconds();
  if (verdict === Verdict.granted) { signUntil = at + SIGN_SECONDS; beaconUntil = 0; showUntil = signUntil; }
  else { beaconUntil = at + BEACON_SECONDS; signUntil = 0; showUntil = beaconUntil; }
  Object.assign(state, { verdict, who, uid: [...uid], uidBytes: uid.length, at, swipes: state.swipes + 1 });
  // The log: the newest first, the oldest of five falls out.
  state.logWho = [who, ...state.logWho].slice(0, LOG);
  state.logVerdict = [verdict, ...state.logVerdict].slice(0, LOG);
  state.logAt = [at, ...state.logAt].slice(0, LOG);
  state.logged = Math.min(LOG, state.logged + 1);
  console.log(`${hexUid(uid)}: ${verdict === Verdict.granted ? "let in" : "refused"}`);
  publish();
}

/** The life of the reader: look for it, poll it until it stops answering, look again. */
async function reader(): Promise<void> {
  for (;;) {
    let rfid: Rfid2 | undefined;
    try {
      rfid = await Rfid2.open(bus);                  // rejects while the Unit is not on Port A
      console.log("RFID 2 found on Port A");
      state.reader = true;
      /** The UID of the card over the reader, "" when there is none. */
      let present = "";
      /** Polls in a row that found no card: one miss is not yet "the card was taken away". */
      let misses = 0;
      for (;;) {
        const card = await rfid.poll();              // null: no card; rejects when the Unit is pulled
        if (card) {
          misses = 0;
          // Another card than a moment ago, or a card after none: that is a swipe.
          if (hexUid(card.uid) !== present) { present = hexUid(card.uid); swipe(card.uid); }
        } else if (++misses >= 2) present = "";
        // The verdict stays while the card rests on the reader, and at least until its light went out.
        if (!present && state.verdict !== Verdict.none && seconds() > showUntil) { state.verdict = Verdict.none; publish(); }
        await sleep(100_000);
      }
    } catch (error) {
      if (state.reader) console.log(`RFID 2 gone: ${message(error)}`);
      Object.assign(state, { reader: false, verdict: Verdict.none });
      publish();
      await sleep(400_000);
    } finally {
      rfid?.close();                                 // a worker holds 8 handles: give this one back
    }
  }
}

/** The life of the relays: look for the Unit, keep its two lights as they should be, look again. */
async function relays(): Promise<void> {
  for (;;) {
    let unit: Relay4 | undefined;
    try {
      unit = await Relay4.open(bus);                 // rejects while the Unit is not on Port A
      console.log("4-Relay found on Port A");
      // Both lights off to begin with, whatever they were left at.
      await unit.set(SIGN, false);
      await unit.set(BEACON, false);
      Object.assign(state, { relay: true, sign: false, beacon: false });
      publish();
      for (let round = 0; ; ++round) {
        const sign = seconds() < signUntil, beacon = seconds() < beaconUntil;
        if (sign !== state.sign) { await unit.set(SIGN, sign); state.sign = sign; publish(); }
        if (beacon !== state.beacon) { await unit.set(BEACON, beacon); state.beacon = beacon; publish(); }
        // Nothing to switch most of the time: a read twice a second notices a Unit that was pulled.
        if (round % 10 === 0) await unit.read();
        await sleep(50_000);
      }
    } catch (error) {
      if (state.relay) console.log(`4-Relay gone: ${message(error)}`);
      Object.assign(state, { relay: false, sign: false, beacon: false });
      publish();
      await sleep(400_000);
    } finally {
      unit?.close();
    }
  }
}

/** The clock for the UI: "3 秒前" and the countdown under the lights follow it. */
async function tick(): Promise<void> {
  for await (const _ of io.timer(100_000)) publish();
}

async function main(): Promise<void> {
  await sleep(0);                                    // the clock starts with the first turn
  publish();
  void reader();
  void relays();
  void tick();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
