// 倒车雷达, the UI: the tail of a car seen from above with seven arcs behind
// it, one for each distance, and the distance as the big number. Arcs light
// up as something comes closer: green far away, yellow within 50 cm, red
// within 20 cm. Under 10 cm the whole screen turns red and says 太近了.
import { createSignal, Match, Show, Switch } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import { CAUTION, DANGER, State, Status, TOO_CLOSE } from "./protocol";
import { Card, Chip, Col, Dot, Header, Label, Notice, Row, Screen, Spacer, Stat, mix, theme, toneColor, useChannel, type Tone } from "./ui";

/** The arcs, nearest first: each is lit while the distance is within its centimetres. */
const ARCS: { within: number; tone: Tone; label: string }[] = [
  { within: TOO_CLOSE, tone: "bad", label: "10" },
  { within: DANGER, tone: "bad", label: "20" },
  { within: 35, tone: "warn", label: "" },
  { within: CAUTION, tone: "warn", label: "50" },
  { within: 100, tone: "good", label: "100" },
  { within: 200, tone: "good", label: "200" },
  { within: 450, tone: "good", label: "450 cm" },
];

/** The picture: 300 x 260 pixels, the arcs' centre inside the car's tail. */
const W = 336, H = 260, CX = 46, CY = 130;
/** Radius of the first arc, the step to the next, an arc's thickness, and half of the angle it spans. */
const FIRST = 52, STEP = 38, THICK = 14, HALF = 24;

/** What the distance means. `clear`: nothing within the module's 4.5 m. */
type Zone = "clear" | "safe" | "caution" | "danger" | "stop";
const ZONES: Record<Zone, { tone: Tone; word: string }> = {
  clear: { tone: "good", word: "后方没有障碍" },
  safe: { tone: "good", word: "安全" },
  caution: { tone: "warn", word: "注意，慢一点" },
  danger: { tone: "bad", word: "很近了" },
  stop: { tone: "bad", word: "太近了" },
};

function Radar(props: { cm: number | undefined; stop: boolean }) {
  const lit = (within: number) => props.cm !== undefined && props.cm <= within;
  const braking = () => props.cm !== undefined && props.cm < DANGER;
  const slant = HALF * Math.PI / 180;
  return <View class="relative" style={{ width: W, height: H }}>
    {ARCS.map((arc, index) => {
      const outer = FIRST + index * STEP + THICK / 2;
      // An arc is a square node drawn as a ring segment: 0 degrees is 12 o'clock, so 90 points to the right.
      return <View class="absolute" style={{
        insetL: CX - outer, insetT: CY - outer, width: outer * 2, height: outer * 2,
        bgColor: lit(arc.within) ? (props.stop ? "#ffffff" : toneColor(arc.tone)) : props.stop ? "#00000040" : theme().line,
        arcStart: 90 - HALF, arcSweep: HALF * 2, arcWidth: THICK,
      }} />;
    })}
    {ARCS.map((arc, index) => {
      const r = FIRST + index * STEP;
      return <Text class="absolute text-2xs" style={{ insetL: CX + r * Math.cos(slant) - 6, insetT: CY + r * Math.sin(slant) + 7, textColor: props.stop ? "#ffffffb0" : theme().faint }}>{arc.label}</Text>;
    })}
    {/* The car's tail from above: body, rear window, two tail lights that glow when it is time to brake. */}
    <View class="absolute" style={{ insetL: 0, insetT: CY - 58, width: 74, height: 116, radius: 26, bgColor: props.stop ? "#2a0d10" : theme().raised }} />
    <View class="absolute" style={{ insetL: 0, insetT: CY - 58, width: 30, height: 116, bgColor: props.stop ? "#2a0d10" : theme().raised }} />
    <View class="absolute" style={{ insetL: 8, insetT: CY - 40, width: 30, height: 80, radius: 10, bgColor: props.stop ? "#120406" : theme().bg }} />
    <View class="absolute" style={{ insetL: 61, insetT: CY - 48, width: 9, height: 24, radius: 4, bgColor: braking() ? "#ff3b3b" : "#7a2630" }} />
    <View class="absolute" style={{ insetL: 61, insetT: CY + 24, width: 9, height: 24, radius: 4, bgColor: braking() ? "#ff3b3b" : "#7a2630" }} />
  </View>;
}

mount(() => {
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;
  /** The distance in centimetres, or undefined while there is none to show. */
  const cm = () => live() && state().inRange ? state().millimetres / 10 : undefined;
  const zone = (): Zone => {
    const value = cm();
    return value === undefined ? "clear" : value < TOO_CLOSE ? "stop" : value < DANGER ? "danger" : value < CAUTION ? "caution" : "safe";
  };
  const stop = () => zone() === "stop";
  const tone = () => ZONES[zone()].tone;
  // One decimal while it matters, whole centimetres from a metre on.
  const reading = () => { const value = cm(); return value === undefined ? ">450" : value < 100 ? value.toFixed(1) : value.toFixed(0); };
  /** Centimetres a second, negative while something comes closer. */
  const speed = () => state().speed / 10;

  // 太近了 blinks: the screen goes between two reds about twice a second.
  const [beat, setBeat] = createSignal(false);
  let frames = 0;
  onFrame(() => { if (++frames % 8 === 0) setBeat(!beat()); });
  const red = () => beat() ? "#c22a30" : "#9c1d24";
  const panel = () => stop() ? mix(red(), "#000000", 0.22) : theme().panel;

  return <Screen color={stop() ? red() : undefined}>
    <Header title="倒车雷达" subtitle="Ultrasonic · Port A" status={stop() ? undefined : live() ? "探测中" : "未连接"} tone={live() ? "good" : "neutral"}>
      <Show when={stop()}><Chip color="#ffffff" solid>停车</Chip></Show>
    </Header>
    <Show when={live()} fallback={
      <Notice title="请插上超声波模块" lines={["把『超声波』模块接到 Port A（红色接口），", "两只『眼睛』朝着要量的方向，雷达会自己开始。"]} />}>
      <Row gap={12} grow align="stretch">
        <Card grow align="center" justify="center" color={panel()}>
          <Radar cm={cm()} stop={stop()} />
        </Card>
        <Col w={216} gap={12}>
          <Card title="距离" grow justify="between" color={panel()} border={!stop() && zone() === "danger" ? theme().bad : undefined}>
            <Stat value={reading()} unit="cm" color={stop() ? "#ffffff" : cm() === undefined ? theme().muted : toneColor(tone())} />
            <Switch>
              <Match when={stop()}><Label size="4xl" bold color="#ffffff">太近了</Label></Match>
              <Match when={true}>
                <Row gap={8}>
                  <Chip tone={tone()} dot>{ZONES[zone()].word}</Chip>
                </Row>
              </Match>
            </Switch>
            <Label size="xs" color={stop() ? "#ffffffc0" : theme().muted}>
              {stop() ? "快停车！再退就要碰上了" : speed() < -3 ? `正在靠近，每秒 ${(-speed()).toFixed(0)} cm` : speed() > 3 ? `正在远离，每秒 ${speed().toFixed(0)} cm` : cm() === undefined ? "4.5 m 以内没有回声" : cm()! > 200 ? "后面很空，放心倒" : "障碍物没有在动"}
            </Label>
          </Card>
          <Card pad={10} gap={5} color={panel()}>
            <Legend tone="good" text="50 cm 以外" word="安全" on={zone() === "safe" || zone() === "clear"} stop={stop()} />
            <Legend tone="warn" text="50 cm 以内" word="注意" on={zone() === "caution"} stop={stop()} />
            <Legend tone="bad" text="20 cm 以内" word="危险" on={zone() === "danger" || stop()} stop={stop()} />
          </Card>
        </Col>
      </Row>
    </Show>
  </Screen>;
});

/** One line of the colour key; the zone the distance is in stands out. */
function Legend(props: { tone: Tone; text: string; word: string; on: boolean; stop: boolean }) {
  const ink = () => props.stop ? (props.on ? "#ffffff" : "#ffffff90") : props.on ? theme().text : theme().faint;
  return <Row gap={8}>
    <Dot color={props.stop ? ink() : toneColor(props.tone)} size={props.on ? 10 : 8} />
    <Label size="xs" bold={props.on} color={ink()}>{props.text}</Label>
    <Spacer />
    <Label size="xs" bold={props.on} color={ink()}>{props.word}</Label>
  </Row>;
}
