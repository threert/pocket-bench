// The UI: what the Tab5 shows, 640 x 360, touch. It draws with ui/ and reads
// the worker's `state` channel; it never touches hardware itself.
import { createSignal } from "solid-js";
import { mount } from "@pocketjs/framework/solid";
import { Command, State } from "./protocol";
import { Button, Card, Field, Header, Label, Row, Screen, Stat, send, useChannel } from "./ui";

const hex = (address: number) => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`;

mount(() => {
  // The worker's newest record, decoded; it changes four times a second.
  const state = useChannel("state", State);
  const [count, setCount] = createSignal(0);
  const addresses = () => state().addresses.slice(0, state().found).map(hex).join(" ");

  return <Screen>
    <Header title="Hello, Tab5" subtitle="A blank Pocket Bench app"
      status={state().found ? "Port A: a Unit answers" : "Port A: empty"} tone={state().found ? "good" : "neutral"} />
    <Row gap={12} grow align="stretch">
      <Card title="TOUCH" grow justify="between">
        <Stat value={count()} unit={count() === 1 ? "tap" : "taps"} />
        <Button label="Tap me" tone="accent" onPress={() => setCount(count() + 1)} />
      </Card>
      <Card title="WORKER" grow justify="between">
        <Row gap={0} align="stretch">
          <Label tone="muted" grow>worker.ts talks to the hardware.</Label>
        </Row>
        <Field label="Running for" value={`${state().uptime.toFixed(0)} s`} />
        <Field label="Records published" value={`${state().ticks} so far`} />
        <Field label="I2C on Port A" value={addresses() || "nothing answers"} />
        <Button label="Scan Port A now" onPress={() => send("commands", Command.encode("scan"))} />
      </Card>
    </Row>
  </Screen>;
});
