// The UI: what the Tab5 shows, 640 x 360, touch. It draws with ui/ and reads
// the worker's `state` channel; it never touches hardware itself.
import { createSignal } from "solid-js";
import { mount } from "@pocketjs/framework/solid";
import { Button, Card, Col, Header, Label, Row, Screen, Stat, useChannel } from "./ui";
import { State } from "./protocol";

mount(() => {
  const state = useChannel("state", State);
  const [count, setCount] = createSignal(0);
  const portA = () => state().found
    ? `${state().found} I2C address${state().found === 1 ? "" : "es"} on Port A`
    : "Nothing on Port A yet";

  return <Screen>
    <Header title="Hello, Tab5" subtitle="A blank Pocket Bench app" status={portA()} tone={state().found ? "good" : "neutral"} />
    <Row gap={12} grow align="stretch">
      <Card title="TAPS" grow justify="between">
        <Stat value={count()} unit={count() === 1 ? "tap" : "taps"} />
        <Button label="Tap me" tone="accent" onPress={() => setCount(count() + 1)} />
      </Card>
      <Card title="WORKER" grow justify="between">
        <Stat value={state().uptime.toFixed(0)} unit="s up" size="md" />
        <Col gap={2}>
          <Label tone="muted">worker.ts publishes 4 times a second</Label>
          <Label tone="muted">and scans Port A every second.</Label>
        </Col>
      </Card>
    </Row>
  </Screen>;
});
