// 厨房秤, the UI: the weight as a scale's display shows it, a 去皮 (tare)
// button, and the 凑重量 game: a ring that fills as the pan gets closer to
// 250 g and says 成功！ when it rests within 5 g of it.
import { Show } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { mount } from "@pocketjs/framework/solid";
import { Command, State, Status, TARGET, TOLERANCE } from "./protocol";
import { Button, Card, Chip, Col, Gauge, Header, Label, Notice, Row, Screen, mix, send, theme, useChannel } from "./ui";

/** Within this many grams of the target the ring turns amber: nearly there. */
const NEAR = 25;
/** The Unit's load cell is good for 5 kg. */
const LIMIT = 5000;

/** Grams with one decimal, and never "-0.0". */
function grams(value: number): string {
  const text = value.toFixed(1);
  return text === "-0.0" ? "0.0" : text;
}

mount(() => {
  const state = useChannel("state", State);
  const live = () => state().status === Status.live;
  const weight = () => state().grams;
  /** Grams still missing (above zero) or too many (below). */
  const missing = () => TARGET - weight();
  const stage = () => state().hit ? "hit" : missing() < -TOLERANCE ? "over" : Math.abs(missing()) <= NEAR ? "near" : weight() < 1 ? "empty" : "under";
  const colour = () => stage() === "hit" ? theme().good : stage() === "over" ? theme().bad : stage() === "near" ? theme().warn : theme().accent;
  const headline = () => {
    switch (stage()) {
      case "hit": return "成功！";
      case "over": return `多了 ${grams(-missing())} g`;
      case "empty": return "放上砝码试试";
      default: return `还差 ${grams(missing())} g`;
    }
  };
  const advice = () => {
    switch (stage()) {
      case "hit": return "稳稳停在目标上，LED 变绿了";
      case "over": return "拿掉一些，LED 还是红的";
      case "near": return "就差一点点了";
      case "empty": return "砝码可以叠着放";
      default: return "再加一些";
    }
  };
  const tare = () => send("commands", Command.encode("tare"));

  return <Screen>
    <Header title="厨房秤" subtitle="Mini Scales · Port A" status={live() ? "实时" : "未连接"} tone={live() ? "good" : "neutral"} />
    <Show when={live()} fallback={
      <Notice title="请插上迷你秤模块" lines={["把『迷你秤』（Mini Scales）接到 Port A（红色接口），", "秤盘朝上，读数会自己出现在这里。"]} />}>
      <Row gap={12} grow align="stretch">
        <Card title="重量" grow justify="between">
          <Col gap={12}>
            {/* The display of a kitchen scale: the number at the right, its unit after it. */}
            <View class="flex-row items-end justify-end" style={{ height: 116, radius: 10, bgColor: theme().bg, paddingL: 18, paddingR: 18, paddingB: 22, gap: 8 }}>
              <Label size="5xl" bold color={state().hit ? theme().good : weight() > LIMIT ? theme().bad : theme().text}>{grams(weight())}</Label>
              <View style={{ paddingB: 10 }}><Label size="xl" tone="muted">g</Label></View>
            </View>
            <Row gap={8} justify="between">
              <Show when={weight() <= LIMIT} fallback={<Chip tone="bad" solid>超出量程</Chip>}>
                <Chip tone={state().steady ? "good" : "neutral"} dot>{state().steady ? "稳定" : "称重中"}</Chip>
              </Show>
              {/* What 去皮 took away: the mug under the coffee. */}
              <Show when={Math.abs(state().tare) >= 0.5} fallback={<Label size="xs" tone="faint">未去皮</Label>}>
                <Chip tone="info">已去皮 {grams(state().tare)} g</Chip>
              </Show>
            </Row>
          </Col>
          <Button label="去皮" tone="accent" h={60} size="xl" onPress={tare} />
        </Card>
        <Card title="凑重量" w={252} align="center" justify="around"
          color={state().hit ? mix(theme().panel, theme().good, 0.14) : undefined} border={state().hit ? theme().good : undefined}>
          <Gauge value={weight() < 1 ? 0 : weight() / TARGET} size={176} thickness={14} sweep={300} color={colour()}>
            <Label size="xs" tone="muted">凑出</Label>
            <Label size="2xl" bold color={state().hit ? theme().good : theme().text}>{TARGET} g</Label>
            <Label size="xs" tone="faint">±{TOLERANCE} g</Label>
          </Gauge>
          <Col gap={2} align="center">
            <Label size="xl" bold color={colour()}>{headline()}</Label>
            <Label size="xs" tone="muted">{advice()}</Label>
          </Col>
        </Card>
      </Row>
    </Show>
  </Screen>;
});
