// 调光台, the UI: the mixed colour as a wide block with its numbers, and under
// it the Unit itself as nine columns: a fader for each knob with that knob's
// LED below it, and the switch at the far right. With the switch thrown the
// block goes dark and says 已熄灯.
import { Show } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { Knob, State, Status } from "./protocol";
import { Card, Col, Header, Label, Notice, Row, Screen, Spacer, mix, theme, useChannel } from "./ui";

/** The eight faders, left to right as the knobs are on the Unit. The first four are bytes
 *  (0..255), the other four are effects shown in percent. */
const FADERS = [
  { name: "红", colour: "#ff5d5d", percent: false },
  { name: "绿", colour: "#3ddc97", percent: false },
  { name: "蓝", colour: "#4c9dff", percent: false },
  { name: "白光", colour: "#f2f5f8", percent: false },
  { name: "渐变", colour: "#b79bff", percent: true },
  { name: "流动", colour: "#5ad1e6", percent: true },
  { name: "呼吸", colour: "#ffb020", percent: true },
  { name: "星光", colour: "#ff9ed0", percent: true },
];
const TRACK = { w: 30, h: 100 };

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(value => Math.round(value).toString(16).toUpperCase().padStart(2, "0")).join("")}`;

/** One knob: its number, a fader filled to the knob's position, and the LED under the knob. */
function Fader(props: { name: string; colour: string; value: number; percent: boolean; led: string; dark: boolean }) {
  const share = () => props.value / 255;
  return <View class="flex-col flex-1 items-center" style={{ gap: 5 }}>
    <Label size="sm" bold color={props.dark ? theme().faint : theme().text}>{props.percent ? `${Math.round(share() * 100)}%` : props.value}</Label>
    <View class="flex-col overflow-hidden" style={{ width: TRACK.w, height: TRACK.h, radius: 8, bgColor: theme().bg }}>
      <View style={{ grow: 1 - share(), basis: 0 }} />
      <View style={{ height: 3, bgColor: props.dark ? theme().faint : "#ffffff" }} />
      <View style={{ grow: share(), basis: 0, bgColor: props.dark ? theme().line : props.colour }} />
    </View>
    <Lamp colour={props.led} />
    <Label size="xs" color={props.dark ? theme().faint : theme().muted}>{props.name}</Label>
  </View>;
}

/** An LED of the Unit: a dot in the colour the worker last gave it, with a little of its glow around it. */
function Lamp(props: { colour: string }) {
  return <View class="flex-row items-center justify-center" style={{ width: 24, height: 24, radius: 12, bgColor: mix(theme().bg, props.colour, 0.3) }}>
    <View style={{ width: 14, height: 14, radius: 7, bgColor: props.colour }} />
  </View>;
}

/** A hairline between two groups of columns. */
function Divider() {
  return <View style={{ width: 1, bgColor: theme().line, marginL: 4, marginR: 4 }} />;
}

mount(() => {
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;
  const dark = () => state().dark;
  const led = (index: number) => { const at = index * 3, leds = state().leds; return hex(leds[at]!, leds[at + 1]!, leds[at + 2]!); };
  /** The colour the first four knobs mix: red, green and blue, washed towards white by the fourth. */
  const mixed = () => {
    const knobs = state().knobs, white = knobs[Knob.white]! / 255;
    return [knobs[Knob.red]!, knobs[Knob.green]!, knobs[Knob.blue]!].map(value => value + (255 - value) * white);
  };
  const block = () => hex(mixed()[0]!, mixed()[1]!, mixed()[2]!);
  /** Text on the block: dark on a light colour, white on a deep one. */
  const ink = () => dark() ? theme().muted : mixed()[0]! * 0.299 + mixed()[1]! * 0.587 + mixed()[2]! * 0.114 > 150 ? "#0b0f14" : "#ffffff";

  return <Screen>
    <Header title="调光台" subtitle="8Angle · Port A"
      status={!live() ? "未连接" : dark() ? "已熄灯" : "灯亮着"} tone={!live() ? "neutral" : dark() ? "warn" : "good"} />
    <Show when={live()} fallback={
      <Notice title="请插上 8Angle 模块" lines={["把『八旋钮』模块接到 Port A（红色接口），", "它的小灯会先亮起来，再拧旋钮调颜色。"]} />}>
      {/* The mixed colour. A see-through colour would let the screen show through: the block is always solid. */}
      <View class="flex-row items-center" style={{ height: 76, radius: 14, paddingL: 18, paddingR: 18, gap: 14, bgColor: dark() ? theme().panel : block(), borderColor: dark() ? theme().line : mix(block(), "#ffffff", 0.25), borderWidth: 2 }}>
        <Show when={!dark()} fallback={<>
          <Label size="2xl" bold tone="muted">已熄灯</Label>
          <Spacer />
          <Label size="sm" tone="faint">把开关拨回来，刚才的颜色原样回来</Label>
        </>}>
          <Col gap={0}>
            <Label size="xs" bold color={ink()}>混出的颜色</Label>
            <Label size="2xl" bold color={ink()}>{block()}</Label>
          </Col>
          <Spacer />
          <Label size="base" bold color={ink()}>红 {state().knobs[Knob.red]} · 绿 {state().knobs[Knob.green]} · 蓝 {state().knobs[Knob.blue]}</Label>
        </Show>
      </View>
      <Card grow pad={12} justify="center">
        <Row gap={0} align="stretch">
          {/* Four knobs for the colour, four for what the strip does with it. */}
          {FADERS.slice(0, 4).map((fader, index) => <Fader name={fader.name} colour={fader.colour} percent={fader.percent} value={state().knobs[index]!} led={led(index)} dark={dark()} />)}
          <Divider />
          {FADERS.slice(4).map((fader, index) => <Fader name={fader.name} colour={fader.colour} percent={fader.percent} value={state().knobs[index + 4]!} led={led(index + 4)} dark={dark()} />)}
          {/* The ninth column is the Unit's slide switch and the LED beside it. */}
          <Divider />
          <View class="flex-col flex-1 items-center" style={{ gap: 5 }}>
            <Label size="sm" bold tone={dark() ? "warn" : "good"}>{dark() ? "关" : "开"}</Label>
            <View class="flex-col items-center" style={{ width: TRACK.w, height: TRACK.h, radius: 8, bgColor: theme().bg, paddingT: 4, paddingB: 4 }}>
              <View style={{ grow: dark() ? 1 : 0, basis: 0 }} />
              <View style={{ width: TRACK.w - 8, height: 44, radius: 6, bgColor: dark() ? theme().line : theme().good }} />
              <View style={{ grow: dark() ? 0 : 1, basis: 0 }} />
            </View>
            <Lamp colour={led(8)} />
            <Label size="xs" color={dark() ? theme().faint : theme().muted}>总开关</Label>
          </View>
        </Row>
      </Card>
    </Show>
  </Screen>;
});
