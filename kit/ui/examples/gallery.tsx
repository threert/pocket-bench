// Every part of ui/ on three pages, for the pictures in ui/README.md and for
// trying a change to a part. To see it on the Tab5, make main.tsx this line:
//   import "./ui/examples/gallery";
import { createSignal, Match, Switch } from "solid-js";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import {
  Bar, Button, Card, Chart, Chip, Col, Dot, Field, Gauge, Header, Label, Notice, Row, Screen, Slider, Sparkline, Spacer, Stat,
  Toggle, setTheme, toast, isDark,
} from "../index";

mount(() => {
  const [page, setPage] = createSignal(0);
  const [level, setLevel] = createSignal(0.62);
  const [on, setOn] = createSignal(true);
  const [history, setHistory] = createSignal<number[]>(Array.from({ length: 48 }, (_, i) => 24 + Math.sin(i / 5) * 2 + (i > 36 ? (i - 36) * 0.5 : 0)));
  let frame = 0;
  onFrame(() => {
    if (++frame % 30) return;
    const last = history()[history().length - 1]!;
    setHistory([...history().slice(1), last + Math.sin(frame / 40) * 0.4]);
  });
  const next = () => setPage((page() + 1) % 3);

  return <Screen>
    <Header title="ui/" subtitle={["values and meters", "controls", "states"][page()]} status="page" tone="accent">
      <Button label="Next" h={32} onPress={next} />
    </Header>
    <Switch>
      <Match when={page() === 0}>
        <Row gap={12} grow align="stretch">
          <Card title="STAT" w={190} justify="between">
            <Stat value={history()[47]!.toFixed(1)} unit="°C" />
            <Row gap={16}>
              <Stat value="48" unit="%" label="HUMIDITY" size="sm" />
              <Stat value="1012" unit="hPa" label="PRESSURE" size="sm" />
            </Row>
          </Card>
          <Card title="CHART, SPARKLINE, BAR" grow justify="between">
            <Chart values={history()} h={84} unit="°" mark={30} />
            <Row gap={12}>
              <Label tone="muted">trend</Label>
              <Sparkline values={history()} grow tone="good" />
            </Row>
            <Bar value={level()} tone="warn" />
          </Card>
          <Card title="GAUGE" w={150} align="center" justify="center">
            <Gauge value={level()} size={112} tone="good">
              <Stat value={Math.round(level() * 100)} unit="%" size="sm" />
            </Gauge>
          </Card>
        </Row>
      </Match>
      <Match when={page() === 1}>
        <Row gap={12} grow align="stretch">
          <Card title="BUTTON" grow justify="between">
            <Button label="Accent" tone="accent" onPress={() => toast("Saved", "good")} />
            <Row gap={8}>
              <Button label="Neutral" grow onPress={() => toast("A plain toast")} />
              <Button label="Stop" tone="bad" grow onPress={() => toast("Stopped", "bad")} />
            </Row>
            <Button label="Ghost" tone="ghost" onPress={() => setTheme(isDark() ? "light" : "dark")} />
          </Card>
          <Card title="TOGGLE, SLIDER" grow justify="between">
            <Toggle label="Lamp" value={on()} onChange={setOn} />
            <Col gap={0}>
              <Field label="Brightness" value={`${Math.round(level() * 100)} %`} />
              <Slider value={level()} onChange={setLevel} w={260} />
            </Col>
            <Field label="Field" value="a name and its value" />
          </Card>
        </Row>
      </Match>
      <Match when={page() === 2}>
        <Row gap={12} grow align="stretch">
          <Notice title="No Unit on Port A" lines={["Plug the ENV III into the red socket.", "The app starts by itself."]} />
          <Card title="CHIP, DOT" w={220} justify="between">
            <Row gap={8}><Chip tone="good" dot>live</Chip><Chip tone="warn">hot</Chip><Chip tone="bad" solid>alarm</Chip></Row>
            <Row gap={8}><Chip>idle</Chip><Chip tone="info">I2C 0x44</Chip></Row>
            <Row gap={10}><Dot tone="good" /><Dot tone="warn" /><Dot tone="bad" pulse /><Dot tone="info" size={12} /><Spacer /><Label tone="faint">Label, faint</Label></Row>
          </Card>
        </Row>
      </Match>
    </Switch>
  </Screen>;
});
