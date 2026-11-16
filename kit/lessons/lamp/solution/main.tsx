// 智能台灯, the UI. On the left the light in the room: the lux as the big
// number and the last minute as a chart with the two limits of automatic
// mode. On the right the lamp: a bulb that glows when the relay is closed, a
// large switch, and whether the light (自动) or the person (手动) is in charge.
import { createMemo, Show } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { Command, GAP, OFF_ABOVE, ON_BELOW, State } from "./protocol";
import { Button, Card, Chart, Chip, Col, Header, Label, Notice, Row, Screen, Spacer, Stat, mix, send, theme, useChannel, type Tone } from "./ui";

/** The lamp's light on the screen. */
const GLOW = "#ffc233";

/** The chart is drawn on a scale of tens: an eye judges light by ratios, and on a plain scale the
 *  two limits (50 and 150 lx) would lie flat at the bottom under a bright room's 600 lx. */
const scale = (lux: number) => Math.log10(Math.max(5, lux));

/** What a person would call this much light. */
function word(lux: number): { text: string; tone: Tone } {
  if (lux < 10) return { text: "一片漆黑", tone: "info" };
  if (lux < ON_BELOW) return { text: "天黑了", tone: "info" };
  if (lux <= OFF_ABOVE) return { text: "有点暗", tone: "warn" };
  if (lux < 1000) return { text: "明亮", tone: "good" };
  return { text: "非常亮", tone: "good" };
}

/** A limit of automatic mode across the chart: a hairline with its name, at the height the chart gives that many lux. */
function Limit(props: { lux: number; text: string; low: number; high: number; color: string }) {
  const share = () => Math.max(0, Math.min(1, (scale(props.lux) - props.low) / (props.high - props.low)));
  return <View class="absolute left-0 top-0 w-full h-full flex-col" style={{ paddingT: 4, paddingB: 4, hitPass: 1 }}>
    <View class="flex-col justify-end items-start" style={{ grow: 1 - share(), basis: 0, paddingL: 8 }}>
      <Label size="xs" color={props.color}>{props.text}</Label>
    </View>
    <View style={{ height: 1, bgColor: props.color, opacity: 0.7 }} />
    <View style={{ grow: share(), basis: 0 }} />
  </View>;
}

/** The desk lamp: a bulb on its socket, with a glow around it while it is on. */
function Bulb(props: { on: boolean; missing: boolean }) {
  const ring = (size: number, amount: number) =>
    <View class="absolute" style={{ insetL: 60 - size / 2, insetT: 48 - size / 2, width: size, height: size, radius: size / 2, bgColor: mix(theme().panel, GLOW, props.on ? amount : 0) }} />;
  return <View class="relative" style={{ width: 120, height: 104 }}>
    {ring(96, 0.12)}
    {ring(76, 0.26)}
    <View class="absolute" style={{ insetL: 32, insetT: 20, width: 56, height: 56, radius: 28, bgColor: props.on ? GLOW : props.missing ? theme().line : theme().raised, borderColor: props.on ? "#fff1c4" : theme().line, borderWidth: 2 }} />
    <View class="absolute" style={{ insetL: 49, insetT: 74, width: 22, height: 10, radius: 3, bgColor: theme().faint }} />
    <View class="absolute" style={{ insetL: 52, insetT: 86, width: 16, height: 6, radius: 3, bgColor: theme().line }} />
  </View>;
}

mount(() => {
  const state = useChannel("state", State);
  const lux = () => state().lux;
  const history = createMemo(() => state().history.map(value => value === GAP ? undefined : scale(value)));
  /** The chart's range, in tens: 5 lx to 1000 lx, further up when the light is stronger. */
  const range = createMemo(() => ({ low: scale(5), high: Math.max(3, ...history().map(value => (value ?? 0) + 0.15)) }));
  const lit = () => state().relay && state().on;
  /** One line about why the lamp is as it is. */
  const why = () => !state().relay ? "把『四路继电器』接到 Port A"
    : !state().auto ? (state().on ? "你亲手开的，一直亮着" : "你亲手关的，一直关着")
    : !state().sensor ? "等环境光模块来做决定"
    : lux() < ON_BELOW ? "天黑了，它自己亮的"
    : lux() > OFF_ABOVE ? "够亮了，它自己关着"
    // Between the two limits nothing changes: that gap is what keeps the lamp from flickering.
    : state().on ? "还不够亮，先接着亮" : "还不算暗，先不开灯";

  return <Screen>
    <Header title="智能台灯" subtitle="DLight + 4-Relay · Port A"
      status={!state().sensor && !state().relay ? "未连接" : lit() ? "台灯亮着" : "台灯关着"}
      tone={!state().sensor && !state().relay ? "neutral" : lit() ? "warn" : "neutral"} />
    <Row gap={12} grow align="stretch">
      <Show when={state().sensor} fallback={
        <Notice title="请插上环境光模块" lines={["把 DLight 模块接到 Port A（红色接口），", state().relay ? "在那之前，台灯只能手动开关。" : "再接上『四路继电器』，才能开关台灯。"]} />}>
        <Card title="环境亮度" grow gap={10}>
          <Row gap={10} align="end">
            <Stat value={lux().toFixed(0)} unit="lx" />
            <Spacer />
            <View style={{ paddingB: 12 }}><Chip tone={word(lux()).tone} dot>{word(lux()).text}</Chip></View>
          </Row>
          <View class="relative flex-col flex-1">
            <Chart values={history()} grow min={range().low} max={range().high} labels={false} color={lit() ? GLOW : theme().accent} />
            <Limit lux={OFF_ABOVE} text={`高于 ${OFF_ABOVE} lx 关灯`} low={range().low} high={range().high} color={theme().muted} />
            <Limit lux={ON_BELOW} text={`低于 ${ON_BELOW} lx 开灯`} low={range().low} high={range().high} color={GLOW} />
          </View>
          <Label size="xs" tone="faint">最近一分钟的亮度</Label>
        </Card>
      </Show>
      <Card w={216} justify="between" pad={12}
        color={lit() ? mix(theme().panel, GLOW, 0.08) : undefined} border={lit() ? mix(theme().panel, GLOW, 0.6) : undefined}>
        <Col gap={2} align="center">
          <Bulb on={lit()} missing={!state().relay} />
          <Label size="lg" bold color={lit() ? GLOW : theme().text}>{!state().relay ? "没接继电器" : state().on ? "台灯亮着" : "台灯关着"}</Label>
          <Label size="xs" tone="muted">{why()}</Label>
        </Col>
        <Col gap={8}>
          <Button label={state().on ? "关灯" : "开灯"} tone={state().on ? "neutral" : "warn"} h={52} size="xl" disabled={!state().relay}
            onPress={() => send("commands", Command.encode("toggle"))} />
          <Show when={state().auto} fallback={
            <Row gap={8}>
              <Chip tone="warn">手动</Chip>
              <Button label="切回自动" tone="ghost" grow size="sm" onPress={() => send("commands", Command.encode("auto"))} />
            </Row>}>
            <Row gap={8} h={44}>
              <Chip tone="good" dot>自动</Chip>
              <Label size="xs" tone="muted">暗了开灯，亮了关灯</Label>
            </Row>
          </Show>
        </Col>
      </Card>
    </Row>
  </Screen>;
});
